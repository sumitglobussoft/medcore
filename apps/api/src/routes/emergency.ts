import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import {
  Role,
  createEmergencyCaseSchema,
  triageSchema,
  assignEmergencyDoctorSchema,
  updateEmergencyStatusSchema,
} from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { auditLog } from "../middleware/audit";

const router = Router();
router.use(authenticate);

async function nextCaseNumber(): Promise<string> {
  const last = await prisma.emergencyCase.findFirst({
    orderBy: { caseNumber: "desc" },
    select: { caseNumber: true },
  });
  let n = 1;
  if (last?.caseNumber) {
    const m = last.caseNumber.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `ER${String(n).padStart(6, "0")}`;
}

const CLOSED_STATUSES: (
  | "DISCHARGED"
  | "TRANSFERRED"
  | "LEFT_WITHOUT_BEING_SEEN"
  | "DECEASED"
)[] = ["DISCHARGED", "TRANSFERRED", "LEFT_WITHOUT_BEING_SEEN", "DECEASED"];

// POST /api/v1/emergency/cases — register
router.post(
  "/cases",
  authorize(Role.ADMIN, Role.NURSE, Role.RECEPTION, Role.DOCTOR),
  validate(createEmergencyCaseSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        patientId,
        unknownName,
        unknownAge,
        unknownGender,
        arrivalMode,
        chiefComplaint,
      } = req.body;

      if (patientId) {
        const patient = await prisma.patient.findUnique({ where: { id: patientId } });
        if (!patient) {
          res.status(404).json({ success: false, data: null, error: "Patient not found" });
          return;
        }
      } else if (!unknownName) {
        res.status(400).json({
          success: false,
          data: null,
          error: "Either patientId or unknownName is required",
        });
        return;
      }

      const caseNumber = await nextCaseNumber();

      const emergencyCase = await prisma.emergencyCase.create({
        data: {
          caseNumber,
          patientId: patientId || null,
          unknownName,
          unknownAge,
          unknownGender,
          arrivalMode,
          chiefComplaint,
          arrivedAt: new Date(),
          status: "WAITING",
        },
        include: {
          patient: { include: { user: { select: { name: true, phone: true } } } },
          attendingDoctor: { include: { user: { select: { name: true } } } },
        },
      });

      auditLog(req, "REGISTER_EMERGENCY_CASE", "emergencyCase", emergencyCase.id, {
        caseNumber,
        patientId: patientId || null,
      }).catch(console.error);

      res.status(201).json({ success: true, data: emergencyCase, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/emergency/cases — list
router.get("/cases", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      status,
      triageLevel,
      from,
      to,
      page = "1",
      limit = "20",
      includeClosed,
    } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = Math.min(parseInt(limit as string), 100);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (triageLevel) where.triageLevel = triageLevel;
    if (from || to) {
      const range: Record<string, Date> = {};
      if (from) range.gte = new Date(from as string);
      if (to) range.lte = new Date(to as string);
      where.arrivedAt = range;
    }
    if (!status && !includeClosed) {
      where.status = { notIn: CLOSED_STATUSES };
    }

    const [cases, total] = await Promise.all([
      prisma.emergencyCase.findMany({
        where,
        include: {
          patient: { include: { user: { select: { name: true, phone: true } } } },
          attendingDoctor: { include: { user: { select: { name: true } } } },
        },
        skip,
        take,
        orderBy: [{ triageLevel: "asc" }, { arrivedAt: "asc" }],
      }),
      prisma.emergencyCase.count({ where }),
    ]);

    res.json({
      success: true,
      data: cases,
      error: null,
      meta: { page: parseInt(page as string), limit: take, total },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/emergency/cases/active — currently in ER
router.get(
  "/cases/active",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const cases = await prisma.emergencyCase.findMany({
        where: { status: { notIn: CLOSED_STATUSES } },
        include: {
          patient: { include: { user: { select: { name: true, phone: true } } } },
          attendingDoctor: { include: { user: { select: { name: true } } } },
        },
        orderBy: [{ arrivedAt: "asc" }],
      });
      res.json({ success: true, data: cases, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/emergency/stats
router.get(
  "/stats",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const active = await prisma.emergencyCase.findMany({
        where: { status: { notIn: CLOSED_STATUSES } },
        select: {
          triageLevel: true,
          arrivedAt: true,
          seenAt: true,
          status: true,
        },
      });

      const byTriage: Record<string, number> = {
        RESUSCITATION: 0,
        EMERGENT: 0,
        URGENT: 0,
        LESS_URGENT: 0,
        NON_URGENT: 0,
        UNTRIAGED: 0,
      };
      let waitingCount = 0;
      let totalWaitMs = 0;
      let waitedSamples = 0;
      const now = Date.now();

      for (const c of active) {
        if (c.triageLevel) byTriage[c.triageLevel]++;
        else byTriage.UNTRIAGED++;

        if (c.status === "WAITING" || c.status === "TRIAGED") {
          waitingCount++;
          totalWaitMs += now - new Date(c.arrivedAt).getTime();
          waitedSamples++;
        }
      }

      const avgWaitMin =
        waitedSamples > 0 ? Math.round(totalWaitMs / waitedSamples / 60000) : 0;

      // Bed availability from beds model
      const availableBeds = await prisma.bed.count({
        where: { status: "AVAILABLE" },
      });

      res.json({
        success: true,
        data: {
          totalActive: active.length,
          totalWaiting: waitingCount,
          byTriage,
          avgWaitMin,
          availableBeds,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/emergency/cases/:id
router.get(
  "/cases/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ecase = await prisma.emergencyCase.findUnique({
        where: { id: req.params.id },
        include: {
          patient: {
            include: {
              user: { select: { name: true, phone: true, email: true } },
            },
          },
          attendingDoctor: {
            include: { user: { select: { name: true } } },
          },
        },
      });
      if (!ecase) {
        res.status(404).json({ success: false, data: null, error: "Case not found" });
        return;
      }
      res.json({ success: true, data: ecase, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/emergency/cases/:id/triage
router.patch(
  "/cases/:id/triage",
  authorize(Role.ADMIN, Role.NURSE, Role.DOCTOR),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = { ...req.body, caseId: req.params.id };
      const parsed = triageSchema.safeParse(body);
      if (!parsed.success) {
        res.status(400).json({
          success: false,
          data: null,
          error: "Validation failed",
          details: parsed.error.flatten(),
        });
        return;
      }

      const existing = await prisma.emergencyCase.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        res.status(404).json({ success: false, data: null, error: "Case not found" });
        return;
      }

      const updated = await prisma.emergencyCase.update({
        where: { id: req.params.id },
        data: {
          triageLevel: parsed.data.triageLevel,
          triagedAt: new Date(),
          triagedBy: req.user!.userId,
          vitalsBP: parsed.data.vitalsBP,
          vitalsPulse: parsed.data.vitalsPulse,
          vitalsResp: parsed.data.vitalsResp,
          vitalsSpO2: parsed.data.vitalsSpO2,
          vitalsTemp: parsed.data.vitalsTemp,
          glasgowComa: parsed.data.glasgowComa,
          mewsScore: parsed.data.mewsScore,
          status: existing.status === "WAITING" ? "TRIAGED" : existing.status,
        },
        include: {
          patient: { include: { user: { select: { name: true, phone: true } } } },
          attendingDoctor: { include: { user: { select: { name: true } } } },
        },
      });

      auditLog(req, "TRIAGE_EMERGENCY_CASE", "emergencyCase", updated.id, {
        triageLevel: parsed.data.triageLevel,
      }).catch(console.error);

      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/emergency/cases/:id/assign
router.patch(
  "/cases/:id/assign",
  authorize(Role.ADMIN, Role.DOCTOR, Role.NURSE, Role.RECEPTION),
  validate(assignEmergencyDoctorSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.emergencyCase.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        res.status(404).json({ success: false, data: null, error: "Case not found" });
        return;
      }

      const doctor = await prisma.doctor.findUnique({
        where: { id: req.body.attendingDoctorId },
      });
      if (!doctor) {
        res.status(404).json({ success: false, data: null, error: "Doctor not found" });
        return;
      }

      const updated = await prisma.emergencyCase.update({
        where: { id: req.params.id },
        data: {
          attendingDoctorId: req.body.attendingDoctorId,
          seenAt: existing.seenAt ?? new Date(),
          status: "IN_TREATMENT",
        },
        include: {
          patient: { include: { user: { select: { name: true, phone: true } } } },
          attendingDoctor: { include: { user: { select: { name: true } } } },
        },
      });

      auditLog(req, "ASSIGN_EMERGENCY_DOCTOR", "emergencyCase", updated.id, {
        doctorId: req.body.attendingDoctorId,
      }).catch(console.error);

      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/emergency/cases/:id/close
router.patch(
  "/cases/:id/close",
  authorize(Role.ADMIN, Role.DOCTOR),
  validate(updateEmergencyStatusSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.emergencyCase.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        res.status(404).json({ success: false, data: null, error: "Case not found" });
        return;
      }

      const terminal = [
        "DISCHARGED",
        "ADMITTED",
        "TRANSFERRED",
        "LEFT_WITHOUT_BEING_SEEN",
        "DECEASED",
      ];
      if (!terminal.includes(req.body.status)) {
        res.status(400).json({
          success: false,
          data: null,
          error: "Close requires a terminal status (DISCHARGED, ADMITTED, TRANSFERRED, LEFT_WITHOUT_BEING_SEEN, DECEASED)",
        });
        return;
      }

      const updated = await prisma.emergencyCase.update({
        where: { id: req.params.id },
        data: {
          status: req.body.status,
          disposition: req.body.disposition,
          outcomeNotes: req.body.outcomeNotes,
          attendingDoctorId:
            req.body.attendingDoctorId ?? existing.attendingDoctorId,
          closedAt: new Date(),
        },
        include: {
          patient: { include: { user: { select: { name: true, phone: true } } } },
          attendingDoctor: { include: { user: { select: { name: true } } } },
        },
      });

      auditLog(req, "CLOSE_EMERGENCY_CASE", "emergencyCase", updated.id, {
        status: req.body.status,
        disposition: req.body.disposition,
      }).catch(console.error);

      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as emergencyRouter };
