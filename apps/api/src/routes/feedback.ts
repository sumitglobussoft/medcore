import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "@medcore/db";
import {
  Role,
  createFeedbackSchema,
  createComplaintSchema,
  updateComplaintSchema,
} from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { auditLog } from "../middleware/audit";

const feedbackRouter = Router();

// POST /api/v1/feedback — public endpoint for patient feedback forms (SMS/WhatsApp link).
// If authenticated as PATIENT, restrict to own patient record.
feedbackRouter.post(
  "/",
  validate(createFeedbackSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, category, rating, nps, comment } = req.body;

      // Verify patient exists (prevents spam with random UUIDs)
      const patient = await prisma.patient.findUnique({
        where: { id: patientId },
      });
      if (!patient) {
        res
          .status(404)
          .json({ success: false, data: null, error: "Patient not found" });
        return;
      }

      // If authenticated as PATIENT, must match
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        try {
          const payload = jwt.verify(
            authHeader.split(" ")[1],
            process.env.JWT_SECRET || "dev-secret"
          ) as { userId: string; role: string };
          if (payload.role === "PATIENT" && patient.userId !== payload.userId) {
            res.status(403).json({
              success: false,
              data: null,
              error: "Patients can only submit feedback for themselves",
            });
            return;
          }
        } catch {
          // Invalid token — treat as anonymous public submission
        }
      }

      const fb = await prisma.patientFeedback.create({
        data: { patientId, category, rating, nps, comment },
      });

      res.status(201).json({ success: true, data: fb, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// Authenticated routes below
feedbackRouter.use(authenticate);

// GET /api/v1/feedback — list
feedbackRouter.get(
  "/",
  authorize(Role.ADMIN, Role.RECEPTION, Role.DOCTOR, Role.NURSE),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        patientId,
        category,
        from,
        to,
        page = "1",
        limit = "20",
      } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const take = Math.min(parseInt(limit as string), 100);

      const where: Record<string, unknown> = {};
      if (patientId) where.patientId = patientId;
      if (category) where.category = category;
      if (from || to) {
        const range: Record<string, Date> = {};
        if (from) range.gte = new Date(from as string);
        if (to) range.lte = new Date(to as string);
        where.submittedAt = range;
      }

      const [items, total] = await Promise.all([
        prisma.patientFeedback.findMany({
          where,
          include: {
            patient: {
              include: { user: { select: { name: true, phone: true } } },
            },
          },
          skip,
          take,
          orderBy: { submittedAt: "desc" },
        }),
        prisma.patientFeedback.count({ where }),
      ]);

      res.json({
        success: true,
        data: items,
        error: null,
        meta: { page: parseInt(page as string), limit: take, total },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/feedback/summary
feedbackRouter.get(
  "/summary",
  authorize(Role.ADMIN, Role.RECEPTION),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { from, to } = req.query;
      const where: Record<string, unknown> = {};
      if (from || to) {
        const range: Record<string, Date> = {};
        if (from) range.gte = new Date(from as string);
        if (to) range.lte = new Date(to as string);
        where.submittedAt = range;
      }

      const all = await prisma.patientFeedback.findMany({
        where,
        select: {
          category: true,
          rating: true,
          nps: true,
          submittedAt: true,
        },
      });

      // avgRating per category
      const cats: Record<string, { sum: number; count: number }> = {};
      for (const f of all) {
        if (!cats[f.category]) cats[f.category] = { sum: 0, count: 0 };
        cats[f.category].sum += f.rating;
        cats[f.category].count++;
      }
      const avgRatingByCategory: Record<string, number> = {};
      for (const [c, v] of Object.entries(cats)) {
        avgRatingByCategory[c] = v.count > 0 ? +(v.sum / v.count).toFixed(2) : 0;
      }

      // NPS: need entries with nps set
      const withNps = all.filter((f) => f.nps !== null && f.nps !== undefined);
      let promoters = 0;
      let detractors = 0;
      for (const f of withNps) {
        if ((f.nps as number) >= 9) promoters++;
        else if ((f.nps as number) <= 6) detractors++;
      }
      const npsScore =
        withNps.length > 0
          ? Math.round(((promoters - detractors) / withNps.length) * 100)
          : 0;

      // Overall avg
      const overallAvg =
        all.length > 0
          ? +(all.reduce((a, f) => a + f.rating, 0) / all.length).toFixed(2)
          : 0;

      // Trend: last 12 months monthly avg
      const now = new Date();
      const trend: Array<{ month: string; avgRating: number; count: number }> = [];
      for (let i = 11; i >= 0; i--) {
        const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
        const monthItems = await prisma.patientFeedback.findMany({
          where: { submittedAt: { gte: start, lt: end } },
          select: { rating: true },
        });
        const count = monthItems.length;
        const avg =
          count > 0
            ? +(monthItems.reduce((a, m) => a + m.rating, 0) / count).toFixed(2)
            : 0;
        trend.push({
          month: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`,
          avgRating: avg,
          count,
        });
      }

      res.json({
        success: true,
        data: {
          totalCount: all.length,
          overallAvg,
          avgRatingByCategory,
          npsScore,
          npsSampleSize: withNps.length,
          promoters,
          detractors,
          passives: withNps.length - promoters - detractors,
          trend,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

export { feedbackRouter };

// ═══════════════════════════════════════════════════════
// COMPLAINTS
// ═══════════════════════════════════════════════════════

const complaintsRouter = Router();
complaintsRouter.use(authenticate);

async function nextTicketNumber(): Promise<string> {
  const last = await prisma.complaint.findFirst({
    orderBy: { ticketNumber: "desc" },
    select: { ticketNumber: true },
  });
  let n = 1;
  if (last?.ticketNumber) {
    const m = last.ticketNumber.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `CMP${String(n).padStart(6, "0")}`;
}

// POST /api/v1/complaints
complaintsRouter.post(
  "/",
  validate(createComplaintSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        patientId,
        name,
        phone,
        category,
        description,
        priority,
      } = req.body;

      const ticketNumber = await nextTicketNumber();

      const complaint = await prisma.complaint.create({
        data: {
          ticketNumber,
          patientId,
          name,
          phone,
          category,
          description,
          priority: priority || "MEDIUM",
          status: "OPEN",
        },
        include: {
          patient: {
            include: { user: { select: { name: true, phone: true } } },
          },
        },
      });

      auditLog(req, "CREATE_COMPLAINT", "complaint", complaint.id, {
        ticketNumber,
        priority,
      }).catch(console.error);

      res.status(201).json({ success: true, data: complaint, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/complaints
complaintsRouter.get(
  "/",
  authorize(Role.ADMIN, Role.RECEPTION, Role.DOCTOR, Role.NURSE),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        status,
        priority,
        assignedTo,
        page = "1",
        limit = "20",
      } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const take = Math.min(parseInt(limit as string), 100);

      const where: Record<string, unknown> = {};
      if (status) where.status = status;
      if (priority) where.priority = priority;
      if (assignedTo) where.assignedTo = assignedTo;

      const [items, total] = await Promise.all([
        prisma.complaint.findMany({
          where,
          include: {
            patient: {
              include: { user: { select: { name: true, phone: true } } },
            },
          },
          skip,
          take,
          orderBy: { createdAt: "desc" },
        }),
        prisma.complaint.count({ where }),
      ]);

      res.json({
        success: true,
        data: items,
        error: null,
        meta: { page: parseInt(page as string), limit: take, total },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/complaints/stats
complaintsRouter.get(
  "/stats",
  authorize(Role.ADMIN, Role.RECEPTION),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const all = await prisma.complaint.findMany({
        select: {
          status: true,
          priority: true,
          createdAt: true,
          resolvedAt: true,
        },
      });

      const byStatus: Record<string, number> = {
        OPEN: 0,
        UNDER_REVIEW: 0,
        RESOLVED: 0,
        ESCALATED: 0,
        CLOSED: 0,
      };
      const byPriority: Record<string, number> = {
        LOW: 0,
        MEDIUM: 0,
        HIGH: 0,
        CRITICAL: 0,
      };

      let totalResolutionMs = 0;
      let resolvedCount = 0;
      let overdueCount = 0;
      const now = Date.now();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

      for (const c of all) {
        byStatus[c.status] = (byStatus[c.status] || 0) + 1;
        byPriority[c.priority] = (byPriority[c.priority] || 0) + 1;

        if (c.resolvedAt) {
          totalResolutionMs +=
            new Date(c.resolvedAt).getTime() - new Date(c.createdAt).getTime();
          resolvedCount++;
        }
        if (
          c.status === "OPEN" &&
          now - new Date(c.createdAt).getTime() > sevenDaysMs
        ) {
          overdueCount++;
        }
      }

      const avgResolutionHours =
        resolvedCount > 0
          ? +(totalResolutionMs / resolvedCount / (60 * 60 * 1000)).toFixed(1)
          : 0;

      res.json({
        success: true,
        data: {
          total: all.length,
          byStatus,
          byPriority,
          avgResolutionHours,
          overdueCount,
          criticalOpen: all.filter(
            (c) => c.priority === "CRITICAL" && c.status !== "RESOLVED" && c.status !== "CLOSED"
          ).length,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/complaints/:id
complaintsRouter.get(
  "/:id",
  authorize(Role.ADMIN, Role.RECEPTION, Role.DOCTOR, Role.NURSE),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = await prisma.complaint.findUnique({
        where: { id: req.params.id },
        include: {
          patient: {
            include: { user: { select: { name: true, phone: true, email: true } } },
          },
        },
      });
      if (!c) {
        res
          .status(404)
          .json({ success: false, data: null, error: "Complaint not found" });
        return;
      }
      res.json({ success: true, data: c, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/complaints/:id
complaintsRouter.patch(
  "/:id",
  authorize(Role.ADMIN, Role.RECEPTION),
  validate(updateComplaintSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data: Record<string, unknown> = { ...req.body };
      if (req.body.status === "RESOLVED") {
        data.resolvedAt = new Date();
      }

      const updated = await prisma.complaint.update({
        where: { id: req.params.id },
        data,
        include: {
          patient: {
            include: { user: { select: { name: true, phone: true } } },
          },
        },
      });

      auditLog(req, "UPDATE_COMPLAINT", "complaint", updated.id, req.body).catch(
        console.error
      );

      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { complaintsRouter };
