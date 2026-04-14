import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import {
  Role,
  createInvoiceSchema,
  recordPaymentSchema,
  insuranceClaimSchema,
  updateClaimStatusSchema,
  refundSchema,
  addInvoiceItemSchema,
  applyDiscountSchema,
  bulkPaymentSchema,
  INVOICE_NUMBER_PREFIX,
} from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createPaymentOrder, verifyPayment } from "../services/razorpay";
import { onBillGenerated, onPaymentReceived } from "../services/notification-triggers";
import { auditLog } from "../middleware/audit";

const router = Router();
router.use(authenticate);

// POST /api/v1/billing/invoices — create invoice
router.post(
  "/invoices",
  authorize(Role.RECEPTION, Role.ADMIN),
  validate(createInvoiceSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { appointmentId, patientId, items, taxPercentage, discountAmount, notes } = req.body;

      // Generate invoice number
      const config = await prisma.systemConfig.findUnique({
        where: { key: "next_invoice_number" },
      });
      const invSeq = config ? parseInt(config.value) : 1;
      const invoiceNumber = `${INVOICE_NUMBER_PREFIX}${String(invSeq).padStart(6, "0")}`;

      // Calculate totals
      const subtotal = items.reduce(
        (sum: number, item: { quantity: number; unitPrice: number }) =>
          sum + item.quantity * item.unitPrice,
        0
      );
      const taxAmount = (subtotal * (taxPercentage || 0)) / 100;
      const totalAmount = subtotal + taxAmount - (discountAmount || 0);

      const invoice = await prisma.$transaction(async (tx) => {
        const inv = await tx.invoice.create({
          data: {
            invoiceNumber,
            appointmentId,
            patientId,
            subtotal,
            taxAmount,
            discountAmount: discountAmount || 0,
            totalAmount,
            notes,
            items: {
              create: items.map(
                (item: {
                  description: string;
                  category: string;
                  quantity: number;
                  unitPrice: number;
                }) => ({
                  description: item.description,
                  category: item.category,
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  amount: item.quantity * item.unitPrice,
                })
              ),
            },
          },
          include: { items: true },
        });

        await tx.systemConfig.update({
          where: { key: "next_invoice_number" },
          data: { value: String(invSeq + 1) },
        });

        return inv;
      });

      // Fire-and-forget notification
      onBillGenerated(invoice).catch(console.error);
      auditLog(req, "CREATE_INVOICE", "invoice", invoice.id, { invoiceNumber, patientId, totalAmount }).catch(console.error);

      res.status(201).json({ success: true, data: invoice, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/billing/invoices
router.get(
  "/invoices",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, status, page = "1", limit = "20" } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const take = Math.min(parseInt(limit as string), 100);

      const where: Record<string, unknown> = {};
      if (patientId) where.patientId = patientId;
      if (status) where.paymentStatus = status;

      // Patients can only see their own invoices
      if (req.user!.role === "PATIENT") {
        const patient = await prisma.patient.findUnique({
          where: { userId: req.user!.userId },
        });
        if (patient) where.patientId = patient.id;
      }

      const [invoices, total] = await Promise.all([
        prisma.invoice.findMany({
          where,
          include: {
            items: true,
            payments: true,
            patient: {
              include: { user: { select: { name: true, phone: true } } },
            },
          },
          skip,
          take,
          orderBy: { createdAt: "desc" },
        }),
        prisma.invoice.count({ where }),
      ]);

      res.json({
        success: true,
        data: invoices,
        error: null,
        meta: { page: parseInt(page as string), limit: take, total },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/billing/invoices/:id
router.get(
  "/invoices/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: req.params.id },
        include: {
          items: true,
          payments: true,
          patient: {
            include: { user: { select: { name: true, phone: true, email: true } } },
          },
          appointment: {
            include: {
              doctor: { include: { user: { select: { name: true } } } },
            },
          },
          insuranceClaims: true,
        },
      });

      if (!invoice) {
        res.status(404).json({ success: false, data: null, error: "Invoice not found" });
        return;
      }

      res.json({ success: true, data: invoice, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/billing/payments — record payment
router.post(
  "/payments",
  authorize(Role.RECEPTION, Role.ADMIN),
  validate(recordPaymentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { invoiceId, amount, mode, transactionId } = req.body;

      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { payments: true },
      });

      if (!invoice) {
        res.status(404).json({ success: false, data: null, error: "Invoice not found" });
        return;
      }

      const totalPaid =
        invoice.payments.reduce((sum, p) => sum + p.amount, 0) + amount;

      const result = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: { invoiceId, amount, mode, transactionId },
        });

        // Update invoice payment status
        const newStatus =
          totalPaid >= invoice.totalAmount ? "PAID" : "PARTIAL";
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { paymentStatus: newStatus },
        });

        return payment;
      });

      // Fire-and-forget notification
      onPaymentReceived(result, invoice).catch(console.error);
      auditLog(req, "RECORD_PAYMENT", "payment", result.id, { invoiceId, amount, mode }).catch(console.error);

      res.status(201).json({ success: true, data: result, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/billing/claims — submit insurance claim
router.post(
  "/claims",
  authorize(Role.RECEPTION, Role.ADMIN),
  validate(insuranceClaimSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const claim = await prisma.insuranceClaim.create({
        data: req.body,
      });

      res.status(201).json({ success: true, data: claim, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/billing/claims/:id — update claim status
router.patch(
  "/claims/:id",
  authorize(Role.RECEPTION, Role.ADMIN),
  validate(updateClaimStatusSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const claim = await prisma.insuranceClaim.update({
        where: { id: req.params.id },
        data: {
          status: req.body.status,
          approvedAmount: req.body.approvedAmount,
          resolvedAt:
            req.body.status === "SETTLED" || req.body.status === "REJECTED"
              ? new Date()
              : undefined,
        },
      });

      res.json({ success: true, data: claim, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/billing/reports/daily — daily collection summary
router.get(
  "/reports/daily",
  authorize(Role.ADMIN, Role.RECEPTION),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { date } = req.query;
      const dateObj = date ? new Date(date as string) : new Date();
      const startOfDay = new Date(dateObj);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(dateObj);
      endOfDay.setHours(23, 59, 59, 999);

      const payments = await prisma.payment.findMany({
        where: {
          paidAt: { gte: startOfDay, lte: endOfDay },
        },
        include: {
          invoice: {
            include: {
              patient: {
                include: { user: { select: { name: true } } },
              },
            },
          },
        },
      });

      const totalCollection = payments.reduce((sum, p) => sum + p.amount, 0);
      const byMode = payments.reduce(
        (acc, p) => {
          acc[p.mode] = (acc[p.mode] || 0) + p.amount;
          return acc;
        },
        {} as Record<string, number>
      );

      const pendingInvoices = await prisma.invoice.count({
        where: {
          createdAt: { gte: startOfDay, lte: endOfDay },
          paymentStatus: { in: ["PENDING", "PARTIAL"] },
        },
      });

      res.json({
        success: true,
        data: {
          date: dateObj.toISOString().split("T")[0],
          totalCollection,
          byMode,
          transactionCount: payments.length,
          pendingInvoices,
          payments,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/billing/pay-online — create Razorpay order for an invoice
router.post(
  "/pay-online",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { invoiceId } = req.body;

      if (!invoiceId) {
        res.status(400).json({ success: false, data: null, error: "invoiceId is required" });
        return;
      }

      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { payments: true },
      });

      if (!invoice) {
        res.status(404).json({ success: false, data: null, error: "Invoice not found" });
        return;
      }

      if (invoice.paymentStatus === "PAID") {
        res.status(400).json({ success: false, data: null, error: "Invoice is already paid" });
        return;
      }

      // Calculate remaining amount
      const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
      const remaining = invoice.totalAmount - totalPaid;

      if (remaining <= 0) {
        res.status(400).json({ success: false, data: null, error: "No balance due" });
        return;
      }

      const order = await createPaymentOrder(invoiceId, remaining);

      res.json({
        success: true,
        data: {
          orderId: order.orderId,
          amount: order.amount,
          currency: order.currency,
          keyId: order.keyId,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/billing/verify-payment — verify Razorpay payment and record it
router.post(
  "/verify-payment",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { razorpayOrderId, razorpayPaymentId, razorpaySignature, invoiceId } =
        req.body;

      if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !invoiceId) {
        res.status(400).json({
          success: false,
          data: null,
          error: "razorpayOrderId, razorpayPaymentId, razorpaySignature, and invoiceId are required",
        });
        return;
      }

      const isValid = verifyPayment(razorpayOrderId, razorpayPaymentId, razorpaySignature);

      if (!isValid) {
        res.status(400).json({
          success: false,
          data: null,
          error: "Payment verification failed — invalid signature",
        });
        return;
      }

      // Record the payment
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { payments: true },
      });

      if (!invoice) {
        res.status(404).json({ success: false, data: null, error: "Invoice not found" });
        return;
      }

      const totalPaid = invoice.payments.reduce((sum, p) => sum + p.amount, 0);
      const remaining = invoice.totalAmount - totalPaid;

      const result = await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.create({
          data: {
            invoiceId,
            amount: remaining,
            mode: "ONLINE",
            transactionId: razorpayPaymentId,
          },
        });

        const newTotalPaid = totalPaid + remaining;
        const newStatus = newTotalPaid >= invoice.totalAmount ? "PAID" : "PARTIAL";

        await tx.invoice.update({
          where: { id: invoiceId },
          data: { paymentStatus: newStatus },
        });

        return payment;
      });

      res.json({ success: true, data: result, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// ─── REFUNDS ──────────────────────────────────────────────
// Refunds stored as negative-amount Payment records with a transactionId
// prefixed "REFUND:<reason>" so we can distinguish them from normal payments.

const REFUND_PREFIX = "REFUND:";

// POST /api/v1/billing/refunds — issue a refund
router.post(
  "/refunds",
  authorize(Role.ADMIN, Role.RECEPTION),
  validate(refundSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { invoiceId, amount, reason, mode } = req.body;

      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: { payments: true },
      });

      if (!invoice) {
        res.status(404).json({ success: false, data: null, error: "Invoice not found" });
        return;
      }

      const totalPaid = invoice.payments.reduce((s, p) => s + p.amount, 0);
      if (amount > totalPaid) {
        res.status(400).json({
          success: false,
          data: null,
          error: `Refund amount (${amount}) exceeds total paid (${totalPaid})`,
        });
        return;
      }

      const result = await prisma.$transaction(async (tx) => {
        const refund = await tx.payment.create({
          data: {
            invoiceId,
            amount: -Math.abs(amount),
            mode,
            transactionId: `${REFUND_PREFIX}${reason}`,
          },
        });

        const netPaid = totalPaid - amount;
        let newStatus: "PENDING" | "PARTIAL" | "PAID" | "REFUNDED";
        if (netPaid <= 0) {
          newStatus = netPaid === 0 && totalPaid > 0 ? "REFUNDED" : "PENDING";
        } else if (netPaid >= invoice.totalAmount) {
          newStatus = "PAID";
        } else {
          newStatus = "PARTIAL";
        }

        await tx.invoice.update({
          where: { id: invoiceId },
          data: { paymentStatus: newStatus },
        });

        return refund;
      });

      auditLog(req, "ISSUE_REFUND", "payment", result.id, {
        invoiceId,
        amount,
        reason,
        mode,
      }).catch(console.error);

      res.status(201).json({ success: true, data: result, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/billing/reports/refunds — list refunds issued
router.get(
  "/reports/refunds",
  authorize(Role.ADMIN, Role.RECEPTION),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from, to } = req.query;
      const where: Record<string, unknown> = {
        amount: { lt: 0 },
      };
      if (from || to) {
        where.paidAt = {
          ...(from ? { gte: new Date(from as string) } : {}),
          ...(to ? { lte: new Date(to as string) } : {}),
        };
      }

      const refunds = await prisma.payment.findMany({
        where,
        include: {
          invoice: {
            include: {
              patient: {
                include: { user: { select: { name: true, phone: true } } },
              },
            },
          },
        },
        orderBy: { paidAt: "desc" },
      });

      const totalRefunded = refunds.reduce((s, r) => s + Math.abs(r.amount), 0);

      res.json({
        success: true,
        data: {
          refunds: refunds.map((r) => ({
            id: r.id,
            paidAt: r.paidAt,
            amount: Math.abs(r.amount),
            mode: r.mode,
            reason: r.transactionId?.startsWith(REFUND_PREFIX)
              ? r.transactionId.slice(REFUND_PREFIX.length)
              : "",
            invoice: {
              id: r.invoice.id,
              invoiceNumber: r.invoice.invoiceNumber,
              totalAmount: r.invoice.totalAmount,
              patient: r.invoice.patient,
            },
          })),
          totalRefunded,
          count: refunds.length,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── INVOICE ITEMS (add / remove on pending invoices) ────
// Recalculate subtotal/tax/total from current items.
// Preserves originally-applied tax % by deriving it from snapshot (taxAmount / subtotal).

// POST /api/v1/billing/invoices/:id/items
router.post(
  "/invoices/:id/items",
  authorize(Role.ADMIN, Role.RECEPTION),
  validate(addInvoiceItemSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invoice = await prisma.invoice.findUnique({
        where: { id: req.params.id },
      });
      if (!invoice) {
        res.status(404).json({ success: false, data: null, error: "Invoice not found" });
        return;
      }
      if (invoice.paymentStatus !== "PENDING") {
        res.status(400).json({
          success: false,
          data: null,
          error: "Line items can only be added to PENDING invoices",
        });
        return;
      }

      const { description, category, quantity, unitPrice } = req.body;

      const taxPercentage =
        invoice.subtotal > 0 ? (invoice.taxAmount / invoice.subtotal) * 100 : 0;

      const updated = await prisma.$transaction(async (tx) => {
        await tx.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            description,
            category,
            quantity,
            unitPrice,
            amount: quantity * unitPrice,
          },
        });
        const current = await tx.invoice.findUnique({
          where: { id: invoice.id },
          include: { items: true },
        });
        if (!current) return null;
        const subtotal = current.items.reduce((s, i) => s + i.amount, 0);
        const taxAmount = (subtotal * taxPercentage) / 100;
        const totalAmount = subtotal + taxAmount - current.discountAmount;
        return tx.invoice.update({
          where: { id: invoice.id },
          data: { subtotal, taxAmount, totalAmount },
          include: { items: true, payments: true },
        });
      });

      auditLog(req, "ADD_INVOICE_ITEM", "invoice", invoice.id, {
        description,
        quantity,
        unitPrice,
      }).catch(console.error);

      res.status(201).json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// DELETE /api/v1/billing/invoices/:id/items/:itemId
router.delete(
  "/invoices/:id/items/:itemId",
  authorize(Role.ADMIN, Role.RECEPTION),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id, itemId } = req.params;

      const invoice = await prisma.invoice.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!invoice) {
        res.status(404).json({ success: false, data: null, error: "Invoice not found" });
        return;
      }
      if (invoice.paymentStatus !== "PENDING") {
        res.status(400).json({
          success: false,
          data: null,
          error: "Line items can only be removed from PENDING invoices",
        });
        return;
      }
      const exists = invoice.items.find((i) => i.id === itemId);
      if (!exists) {
        res.status(404).json({ success: false, data: null, error: "Item not found" });
        return;
      }
      if (invoice.items.length <= 1) {
        res.status(400).json({
          success: false,
          data: null,
          error: "Cannot remove the only line item from an invoice",
        });
        return;
      }

      const taxPercentage =
        invoice.subtotal > 0 ? (invoice.taxAmount / invoice.subtotal) * 100 : 0;

      const updated = await prisma.$transaction(async (tx) => {
        await tx.invoiceItem.delete({ where: { id: itemId } });
        const current = await tx.invoice.findUnique({
          where: { id },
          include: { items: true },
        });
        if (!current) return null;
        const subtotal = current.items.reduce((s, i) => s + i.amount, 0);
        const taxAmount = (subtotal * taxPercentage) / 100;
        const totalAmount = subtotal + taxAmount - current.discountAmount;
        return tx.invoice.update({
          where: { id },
          data: { subtotal, taxAmount, totalAmount },
          include: { items: true, payments: true },
        });
      });

      auditLog(req, "REMOVE_INVOICE_ITEM", "invoice", id, { itemId }).catch(
        console.error
      );

      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/billing/invoices/:id/discount
router.post(
  "/invoices/:id/discount",
  authorize(Role.ADMIN, Role.RECEPTION),
  validate(applyDiscountSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { percentage, flatAmount, reason } = req.body;

      const invoice = await prisma.invoice.findUnique({
        where: { id: req.params.id },
        include: { payments: true },
      });
      if (!invoice) {
        res.status(404).json({ success: false, data: null, error: "Invoice not found" });
        return;
      }
      if (invoice.paymentStatus === "PAID" || invoice.paymentStatus === "REFUNDED") {
        res.status(400).json({
          success: false,
          data: null,
          error: "Cannot apply discount to a paid or refunded invoice",
        });
        return;
      }

      const gross = invoice.subtotal + invoice.taxAmount;
      let discountAmount = 0;
      if (flatAmount !== undefined) {
        discountAmount = flatAmount;
      } else if (percentage !== undefined) {
        discountAmount = (gross * percentage) / 100;
      }
      if (discountAmount > gross) {
        res.status(400).json({
          success: false,
          data: null,
          error: "Discount cannot exceed gross amount",
        });
        return;
      }

      const newTotal = gross - discountAmount;
      const totalPaid = invoice.payments.reduce((s, p) => s + p.amount, 0);
      const newStatus =
        totalPaid >= newTotal && newTotal > 0
          ? "PAID"
          : totalPaid > 0
            ? "PARTIAL"
            : "PENDING";

      const discountNote = `[DISCOUNT ${new Date().toISOString()}] ${
        percentage !== undefined ? `${percentage}%` : `Rs.${flatAmount}`
      } — ${reason}`;

      const updated = await prisma.invoice.update({
        where: { id: invoice.id },
        data: {
          discountAmount,
          totalAmount: newTotal,
          paymentStatus: newStatus,
          notes: invoice.notes
            ? `${invoice.notes}\n${discountNote}`
            : discountNote,
        },
        include: { items: true, payments: true },
      });

      auditLog(req, "APPLY_DISCOUNT", "invoice", invoice.id, {
        percentage,
        flatAmount,
        discountAmount,
        reason,
      }).catch(console.error);

      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// ─── BULK PAYMENTS ────────────────────────────────────────
// POST /api/v1/billing/payments/bulk — apply payments across multiple invoices
router.post(
  "/payments/bulk",
  authorize(Role.ADMIN, Role.RECEPTION),
  validate(bulkPaymentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, payments } = req.body;

      // Validate all invoices belong to this patient
      const invoiceIds = payments.map(
        (p: { invoiceId: string }) => p.invoiceId
      );
      const invoices = await prisma.invoice.findMany({
        where: { id: { in: invoiceIds } },
        include: { payments: true },
      });
      const mismatched = invoices.find((i) => i.patientId !== patientId);
      if (mismatched) {
        res.status(400).json({
          success: false,
          data: null,
          error: `Invoice ${mismatched.invoiceNumber} does not belong to patient ${patientId}`,
        });
        return;
      }
      if (invoices.length !== invoiceIds.length) {
        res.status(400).json({
          success: false,
          data: null,
          error: "One or more invoices not found",
        });
        return;
      }

      const results = await prisma.$transaction(async (tx) => {
        const created = [];
        for (const p of payments as Array<{
          invoiceId: string;
          amount: number;
          mode: "CASH" | "CARD" | "UPI" | "ONLINE" | "INSURANCE";
          transactionId?: string;
        }>) {
          const inv = invoices.find((i) => i.id === p.invoiceId)!;
          const pay = await tx.payment.create({
            data: {
              invoiceId: p.invoiceId,
              amount: p.amount,
              mode: p.mode,
              transactionId: p.transactionId,
            },
          });
          const totalPaid =
            inv.payments.reduce((s, x) => s + x.amount, 0) + p.amount;
          const newStatus =
            totalPaid >= inv.totalAmount ? "PAID" : "PARTIAL";
          await tx.invoice.update({
            where: { id: p.invoiceId },
            data: { paymentStatus: newStatus },
          });
          created.push(pay);
        }
        return created;
      });

      auditLog(req, "BULK_PAYMENT", "patient", patientId, {
        count: results.length,
        total: results.reduce((s, r) => s + r.amount, 0),
      }).catch(console.error);

      res.status(201).json({ success: true, data: results, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// ─── OUTSTANDING REPORTS ──────────────────────────────────

// GET /api/v1/billing/patients/:patientId/outstanding
router.get(
  "/patients/:patientId/outstanding",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.params;

      // Patient can only see their own
      if (req.user!.role === "PATIENT") {
        const me = await prisma.patient.findUnique({
          where: { userId: req.user!.userId },
        });
        if (!me || me.id !== patientId) {
          res.status(403).json({ success: false, data: null, error: "Forbidden" });
          return;
        }
      }

      const invoices = await prisma.invoice.findMany({
        where: {
          patientId,
          paymentStatus: { in: ["PENDING", "PARTIAL"] },
        },
        include: {
          items: true,
          payments: true,
          patient: {
            include: { user: { select: { name: true, phone: true, email: true } } },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      const enriched = invoices.map((inv) => {
        const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
        const balance = Math.max(0, inv.totalAmount - paid);
        const daysOverdue = Math.floor(
          (Date.now() - new Date(inv.createdAt).getTime()) / 86400000
        );
        return { ...inv, totalPaid: paid, balance, daysOverdue };
      });

      const totalOutstanding = enriched.reduce((s, i) => s + i.balance, 0);

      res.json({
        success: true,
        data: {
          patientId,
          totalOutstanding,
          invoiceCount: enriched.length,
          invoices: enriched,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/billing/reports/outstanding?from=&to=&minAmount=
router.get(
  "/reports/outstanding",
  authorize(Role.ADMIN, Role.RECEPTION),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from, to, minAmount } = req.query;
      const min = minAmount ? parseFloat(minAmount as string) : 0;

      const where: Record<string, unknown> = {
        paymentStatus: { in: ["PENDING", "PARTIAL"] },
      };
      if (from || to) {
        where.createdAt = {
          ...(from ? { gte: new Date(from as string) } : {}),
          ...(to ? { lte: new Date(to as string) } : {}),
        };
      }

      const invoices = await prisma.invoice.findMany({
        where,
        include: {
          payments: true,
          patient: {
            include: { user: { select: { name: true, phone: true, email: true } } },
          },
        },
        orderBy: { createdAt: "asc" },
      });

      const rows = invoices
        .map((inv) => {
          const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
          const balance = Math.max(0, inv.totalAmount - paid);
          const daysOverdue = Math.floor(
            (Date.now() - new Date(inv.createdAt).getTime()) / 86400000
          );
          return {
            invoiceId: inv.id,
            invoiceNumber: inv.invoiceNumber,
            patientId: inv.patientId,
            patient: inv.patient,
            totalAmount: inv.totalAmount,
            paid,
            balance,
            daysOverdue,
            paymentStatus: inv.paymentStatus,
            createdAt: inv.createdAt,
          };
        })
        .filter((r) => r.balance >= min);

      const totalOutstanding = rows.reduce((s, r) => s + r.balance, 0);

      res.json({
        success: true,
        data: {
          rows,
          totalOutstanding,
          count: rows.length,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/billing/reports/revenue?from=&to=&groupBy=day|month&doctorId=
router.get(
  "/reports/revenue",
  authorize(Role.ADMIN, Role.RECEPTION),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        from,
        to,
        groupBy = "day",
        doctorId,
      } = req.query as {
        from?: string;
        to?: string;
        groupBy?: "day" | "month";
        doctorId?: string;
      };

      const start = from ? new Date(from) : new Date(Date.now() - 30 * 86400000);
      const end = to ? new Date(to) : new Date();

      const payments = await prisma.payment.findMany({
        where: {
          paidAt: { gte: start, lte: end },
          ...(doctorId
            ? { invoice: { appointment: { doctorId } } }
            : {}),
        },
        include: {
          invoice: {
            include: {
              appointment: { select: { doctorId: true } },
            },
          },
        },
      });

      const buckets: Record<string, { inflow: number; refunds: number; net: number }> = {};
      for (const p of payments) {
        const d = new Date(p.paidAt);
        const key =
          groupBy === "month"
            ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
            : d.toISOString().slice(0, 10);
        if (!buckets[key]) buckets[key] = { inflow: 0, refunds: 0, net: 0 };
        if (p.amount >= 0) buckets[key].inflow += p.amount;
        else buckets[key].refunds += Math.abs(p.amount);
        buckets[key].net += p.amount;
      }

      const series = Object.entries(buckets)
        .map(([date, v]) => ({ date, ...v }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const totals = series.reduce(
        (acc, s) => ({
          inflow: acc.inflow + s.inflow,
          refunds: acc.refunds + s.refunds,
          net: acc.net + s.net,
        }),
        { inflow: 0, refunds: 0, net: 0 }
      );

      res.json({
        success: true,
        data: { series, totals, groupBy, from: start, to: end },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

export { router as billingRouter };
