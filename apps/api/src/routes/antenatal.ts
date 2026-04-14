import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import {
  Role,
  createAncCaseSchema,
  updateAncCaseSchema,
  createAncVisitSchema,
  deliveryOutcomeSchema,
} from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { auditLog } from "../middleware/audit";

const router = Router();
router.use(authenticate);

// Generate next ANC case number like ANC000001
async function nextAncCaseNumber(): Promise<string> {
  const last = await prisma.antenatalCase.findFirst({
    orderBy: { caseNumber: "desc" },
    select: { caseNumber: true },
  });
  let n = 1;
  if (last?.caseNumber) {
    const m = last.caseNumber.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `ANC${String(n).padStart(6, "0")}`;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

// ─── DASHBOARD ──────────────────────────────────────
router.get(
  "/dashboard",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const now = new Date();
      const in30 = addDays(now, 30);
      const in7 = addDays(now, 7);

      const [activeCases, highRiskCases, upcomingDeliveries, overdueDeliveries, dueVisits] =
        await Promise.all([
          prisma.antenatalCase.count({ where: { deliveredAt: null } }),
          prisma.antenatalCase.count({
            where: { deliveredAt: null, isHighRisk: true },
          }),
          prisma.antenatalCase.count({
            where: {
              deliveredAt: null,
              eddDate: { gte: now, lte: in30 },
            },
          }),
          prisma.antenatalCase.count({
            where: {
              deliveredAt: null,
              eddDate: { lt: now },
            },
          }),
          prisma.antenatalCase.findMany({
            where: {
              deliveredAt: null,
              visits: {
                some: {
                  nextVisitDate: {
                    gte: now,
                    lte: in7,
                  },
                },
              },
            },
            include: {
              patient: {
                include: { user: { select: { name: true, phone: true } } },
              },
              visits: {
                orderBy: { visitDate: "desc" },
                take: 1,
              },
            },
            take: 50,
          }),
        ]);

      res.json({
        success: true,
        data: {
          activeCases,
          highRiskCases,
          upcomingDeliveries,
          overdueDeliveries,
          visitsDueThisWeek: dueVisits,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── ANC CASES ──────────────────────────────────────

// POST /antenatal/cases
router.post(
  "/cases",
  authorize(Role.ADMIN, Role.DOCTOR, Role.NURSE),
  validate(createAncCaseSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        patientId,
        doctorId,
        lmpDate,
        gravida,
        parity,
        bloodGroup,
        isHighRisk,
        riskFactors,
      } = req.body;

      // Ensure patient exists and is female
      const patient = await prisma.patient.findUnique({
        where: { id: patientId },
        include: { user: { select: { name: true } } },
      });
      if (!patient) {
        res
          .status(404)
          .json({ success: false, data: null, error: "Patient not found" });
        return;
      }
      if (patient.gender !== "FEMALE") {
        res.status(400).json({
          success: false,
          data: null,
          error: "ANC cases can only be created for female patients",
        });
        return;
      }

      // Check no existing ANC case
      const existing = await prisma.antenatalCase.findUnique({
        where: { patientId },
      });
      if (existing) {
        res.status(409).json({
          success: false,
          data: null,
          error: `Patient already has an ANC case (${existing.caseNumber})`,
        });
        return;
      }

      const lmp = new Date(`${lmpDate}T00:00:00.000Z`);
      const edd = addDays(lmp, 280);
      const caseNumber = await nextAncCaseNumber();

      const created = await prisma.antenatalCase.create({
        data: {
          caseNumber,
          patientId,
          doctorId,
          lmpDate: lmp,
          eddDate: edd,
          gravida: gravida ?? 1,
          parity: parity ?? 0,
          bloodGroup,
          isHighRisk: isHighRisk ?? false,
          riskFactors,
        },
        include: {
          patient: {
            include: { user: { select: { name: true, phone: true } } },
          },
          doctor: { include: { user: { select: { name: true } } } },
        },
      });

      auditLog(req, "CREATE_ANC_CASE", "antenatalCase", created.id, {
        caseNumber,
        patientId,
      }).catch(console.error);

      res.status(201).json({ success: true, data: created, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /antenatal/cases
router.get(
  "/cases",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        doctorId,
        isHighRisk,
        delivered,
        page = "1",
        limit = "20",
      } = req.query;
      const pageN = parseInt(page as string) || 1;
      const takeN = Math.min(parseInt(limit as string) || 20, 100);
      const skip = (pageN - 1) * takeN;

      const where: Record<string, unknown> = {};
      if (doctorId) where.doctorId = doctorId;
      if (isHighRisk !== undefined)
        where.isHighRisk = isHighRisk === "true";
      if (delivered === "true") where.deliveredAt = { not: null };
      if (delivered === "false") where.deliveredAt = null;

      const [cases, total] = await Promise.all([
        prisma.antenatalCase.findMany({
          where,
          include: {
            patient: {
              include: { user: { select: { name: true, phone: true } } },
            },
            doctor: { include: { user: { select: { name: true } } } },
            visits: {
              orderBy: { visitDate: "desc" },
              take: 1,
            },
          },
          skip,
          take: takeN,
          orderBy: { createdAt: "desc" },
        }),
        prisma.antenatalCase.count({ where }),
      ]);

      res.json({
        success: true,
        data: cases,
        error: null,
        meta: { page: pageN, limit: takeN, total },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /antenatal/cases/:id
router.get(
  "/cases/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const c = await prisma.antenatalCase.findUnique({
        where: { id: req.params.id },
        include: {
          patient: {
            include: {
              user: { select: { name: true, phone: true, email: true } },
            },
          },
          doctor: { include: { user: { select: { name: true } } } },
          visits: { orderBy: { visitDate: "asc" } },
        },
      });
      if (!c) {
        res
          .status(404)
          .json({ success: false, data: null, error: "ANC case not found" });
        return;
      }
      res.json({ success: true, data: c, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /antenatal/cases/:id
router.patch(
  "/cases/:id",
  authorize(Role.ADMIN, Role.DOCTOR, Role.NURSE),
  validate(updateAncCaseSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.antenatalCase.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        res
          .status(404)
          .json({ success: false, data: null, error: "ANC case not found" });
        return;
      }

      const updated = await prisma.antenatalCase.update({
        where: { id: req.params.id },
        data: req.body,
        include: {
          patient: {
            include: { user: { select: { name: true, phone: true } } },
          },
          doctor: { include: { user: { select: { name: true } } } },
        },
      });

      auditLog(req, "UPDATE_ANC_CASE", "antenatalCase", updated.id, req.body)
        .catch(console.error);

      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /antenatal/cases/:id/delivery
router.patch(
  "/cases/:id/delivery",
  authorize(Role.ADMIN, Role.DOCTOR),
  validate(deliveryOutcomeSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.antenatalCase.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        res
          .status(404)
          .json({ success: false, data: null, error: "ANC case not found" });
        return;
      }
      if (existing.deliveredAt) {
        res.status(409).json({
          success: false,
          data: null,
          error: "Delivery already recorded for this case",
        });
        return;
      }

      const updated = await prisma.antenatalCase.update({
        where: { id: req.params.id },
        data: {
          deliveredAt: new Date(),
          deliveryType: req.body.deliveryType,
          babyGender: req.body.babyGender,
          babyWeight: req.body.babyWeight,
          outcomeNotes: req.body.outcomeNotes,
        },
        include: {
          patient: {
            include: { user: { select: { name: true, phone: true } } },
          },
          doctor: { include: { user: { select: { name: true } } } },
        },
      });

      auditLog(req, "RECORD_DELIVERY", "antenatalCase", updated.id, {
        deliveryType: req.body.deliveryType,
      }).catch(console.error);

      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// ─── ANC VISITS ─────────────────────────────────────

// POST /antenatal/visits
router.post(
  "/visits",
  authorize(Role.ADMIN, Role.DOCTOR, Role.NURSE),
  validate(createAncVisitSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ancCaseId, nextVisitDate, ...rest } = req.body;

      const ancCase = await prisma.antenatalCase.findUnique({
        where: { id: ancCaseId },
      });
      if (!ancCase) {
        res
          .status(404)
          .json({ success: false, data: null, error: "ANC case not found" });
        return;
      }

      const visit = await prisma.ancVisit.create({
        data: {
          ancCaseId,
          ...rest,
          nextVisitDate: nextVisitDate
            ? new Date(`${nextVisitDate}T00:00:00.000Z`)
            : null,
        },
      });

      auditLog(req, "ADD_ANC_VISIT", "ancVisit", visit.id, {
        ancCaseId,
        type: visit.type,
      }).catch(console.error);

      res.status(201).json({ success: true, data: visit, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /antenatal/visits?ancCaseId=
router.get(
  "/visits",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ancCaseId } = req.query;
      const where: Record<string, unknown> = {};
      if (ancCaseId) where.ancCaseId = ancCaseId;

      const visits = await prisma.ancVisit.findMany({
        where,
        orderBy: { visitDate: "asc" },
      });
      res.json({ success: true, data: visits, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as antenatalRouter };
