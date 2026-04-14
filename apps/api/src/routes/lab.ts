import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import {
  Role,
  createLabTestSchema,
  updateLabTestSchema,
  createLabOrderSchema,
  updateLabOrderStatusSchema,
  recordLabResultSchema,
} from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { auditLog } from "../middleware/audit";

const router = Router();
router.use(authenticate);

// ───────────────────────────────────────────────────────
// LAB TEST CATALOG
// ───────────────────────────────────────────────────────

// GET /api/v1/lab/tests
router.get("/tests", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, category } = req.query as Record<string, string | undefined>;
    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: "insensitive" } },
        { name: { contains: search, mode: "insensitive" } },
      ];
    }
    const tests = await prisma.labTest.findMany({
      where,
      orderBy: { name: "asc" },
    });
    res.json({ success: true, data: tests, error: null });
  } catch (err) {
    next(err);
  }
});

// POST /api/v1/lab/tests — admin only
router.post(
  "/tests",
  authorize(Role.ADMIN),
  validate(createLabTestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const test = await prisma.labTest.create({ data: req.body });
      auditLog(req, "CREATE_LAB_TEST", "lab_test", test.id, {
        code: test.code,
        name: test.name,
      }).catch(console.error);
      res.status(201).json({ success: true, data: test, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/lab/tests/:id
router.patch(
  "/tests/:id",
  authorize(Role.ADMIN),
  validate(updateLabTestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const test = await prisma.labTest.update({
        where: { id: req.params.id },
        data: req.body,
      });
      auditLog(req, "UPDATE_LAB_TEST", "lab_test", test.id, req.body).catch(
        console.error
      );
      res.json({ success: true, data: test, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// ───────────────────────────────────────────────────────
// LAB ORDERS
// ───────────────────────────────────────────────────────

// GET /api/v1/lab/orders?patientId=&status=
router.get(
  "/orders",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        patientId,
        doctorId,
        status,
        page = "1",
        limit = "20",
      } = req.query as Record<string, string | undefined>;

      const skip = (parseInt(page || "1") - 1) * parseInt(limit || "20");
      const take = Math.min(parseInt(limit || "20"), 100);

      const where: Record<string, unknown> = {};
      if (patientId) where.patientId = patientId;
      if (doctorId) where.doctorId = doctorId;
      if (status) where.status = status;

      // Patients see only their own
      if (req.user!.role === "PATIENT") {
        const patient = await prisma.patient.findUnique({
          where: { userId: req.user!.userId },
        });
        if (patient) where.patientId = patient.id;
      }

      const [orders, total] = await Promise.all([
        prisma.labOrder.findMany({
          where,
          include: {
            items: { include: { test: true } },
            patient: {
              include: { user: { select: { name: true, phone: true } } },
            },
            doctor: { include: { user: { select: { name: true } } } },
          },
          skip,
          take,
          orderBy: { orderedAt: "desc" },
        }),
        prisma.labOrder.count({ where }),
      ]);

      res.json({
        success: true,
        data: orders,
        error: null,
        meta: { page: parseInt(page || "1"), limit: take, total },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/lab/orders/:id — full detail
router.get(
  "/orders/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const order = await prisma.labOrder.findUnique({
        where: { id: req.params.id },
        include: {
          items: {
            include: {
              test: true,
              results: { orderBy: { reportedAt: "desc" } },
            },
          },
          patient: {
            include: {
              user: { select: { name: true, phone: true, email: true } },
            },
          },
          doctor: {
            include: { user: { select: { name: true, email: true } } },
          },
        },
      });

      if (!order) {
        res
          .status(404)
          .json({ success: false, data: null, error: "Lab order not found" });
        return;
      }

      res.json({ success: true, data: order, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// Helper: generate LAB order number
async function generateOrderNumber(): Promise<string> {
  const last = await prisma.labOrder.findFirst({
    orderBy: { orderedAt: "desc" },
    select: { orderNumber: true },
  });
  let next = 1;
  if (last?.orderNumber) {
    const m = last.orderNumber.match(/LAB(\d+)/);
    if (m) next = parseInt(m[1]) + 1;
  }
  return "LAB" + String(next).padStart(6, "0");
}

// POST /api/v1/lab/orders — doctor creates order
router.post(
  "/orders",
  authorize(Role.DOCTOR, Role.ADMIN),
  validate(createLabOrderSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, doctorId, admissionId, testIds, notes } = req.body;

      const orderNumber = await generateOrderNumber();

      const order = await prisma.labOrder.create({
        data: {
          orderNumber,
          patientId,
          doctorId,
          admissionId,
          notes,
          items: {
            create: testIds.map((testId: string) => ({ testId })),
          },
        },
        include: {
          items: { include: { test: true } },
          patient: { include: { user: { select: { name: true } } } },
          doctor: { include: { user: { select: { name: true } } } },
        },
      });

      auditLog(req, "CREATE_LAB_ORDER", "lab_order", order.id, {
        orderNumber,
        testCount: testIds.length,
      }).catch(console.error);

      res.status(201).json({ success: true, data: order, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/lab/orders/:id/status
router.patch(
  "/orders/:id/status",
  authorize(Role.ADMIN, Role.DOCTOR, Role.NURSE),
  validate(updateLabOrderStatusSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = req.body;
      const data: Record<string, unknown> = { status };

      if (status === "SAMPLE_COLLECTED") data.collectedAt = new Date();
      if (status === "COMPLETED") data.completedAt = new Date();

      const order = await prisma.labOrder.update({
        where: { id: req.params.id },
        data,
        include: { items: true },
      });

      // Also propagate status to items (if not already completed)
      if (status === "COMPLETED" || status === "CANCELLED") {
        await prisma.labOrderItem.updateMany({
          where: { orderId: order.id },
          data: { status },
        });
      }

      auditLog(req, "UPDATE_LAB_ORDER_STATUS", "lab_order", order.id, {
        status,
      }).catch(console.error);

      res.json({ success: true, data: order, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/lab/results — record a result
router.post(
  "/results",
  authorize(Role.NURSE, Role.DOCTOR, Role.ADMIN),
  validate(recordLabResultSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { orderItemId, parameter, value, unit, normalRange, flag, notes } =
        req.body;

      const orderItem = await prisma.labOrderItem.findUnique({
        where: { id: orderItemId },
      });
      if (!orderItem) {
        res.status(404).json({
          success: false,
          data: null,
          error: "Lab order item not found",
        });
        return;
      }

      const result = await prisma.labResult.create({
        data: {
          orderItemId,
          parameter,
          value,
          unit,
          normalRange,
          flag: flag ?? "NORMAL",
          notes,
          enteredBy: req.user!.userId,
        },
      });

      // Mark this order item as completed
      await prisma.labOrderItem.update({
        where: { id: orderItemId },
        data: { status: "COMPLETED" },
      });

      // If all items of the order are completed, mark order COMPLETED
      const siblings = await prisma.labOrderItem.findMany({
        where: { orderId: orderItem.orderId },
        select: { status: true },
      });
      const allDone = siblings.every((s) => s.status === "COMPLETED");
      if (allDone) {
        await prisma.labOrder.update({
          where: { id: orderItem.orderId },
          data: { status: "COMPLETED", completedAt: new Date() },
        });
      } else {
        // If order is still ORDERED, bump to IN_PROGRESS
        await prisma.labOrder.updateMany({
          where: {
            id: orderItem.orderId,
            status: { in: ["ORDERED", "SAMPLE_COLLECTED"] },
          },
          data: { status: "IN_PROGRESS" },
        });
      }

      auditLog(req, "RECORD_LAB_RESULT", "lab_result", result.id, {
        orderItemId,
        parameter,
        flag: flag ?? "NORMAL",
      }).catch(console.error);

      res.status(201).json({ success: true, data: result, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/lab/results/:orderItemId
router.get(
  "/results/:orderItemId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const results = await prisma.labResult.findMany({
        where: { orderItemId: req.params.orderItemId },
        orderBy: { reportedAt: "desc" },
      });
      res.json({ success: true, data: results, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as labRouter };
