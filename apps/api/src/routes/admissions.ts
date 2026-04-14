import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import {
  Role,
  admitPatientSchema,
  dischargeSchema,
  transferBedSchema,
  recordIpdVitalsSchema,
} from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { auditLog } from "../middleware/audit";

const router = Router();
router.use(authenticate);

// Generate next admission number like IPD000001
async function nextAdmissionNumber(): Promise<string> {
  const last = await prisma.admission.findFirst({
    orderBy: { admissionNumber: "desc" },
    select: { admissionNumber: true },
  });
  let n = 1;
  if (last?.admissionNumber) {
    const m = last.admissionNumber.match(/(\d+)$/);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `IPD${String(n).padStart(6, "0")}`;
}

// GET /api/v1/admissions — list admissions with filters
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, patientId, doctorId, page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = Math.min(parseInt(limit as string), 100);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (patientId) where.patientId = patientId;
    if (doctorId) where.doctorId = doctorId;

    // If patient role, only show own admissions
    if (req.user!.role === Role.PATIENT) {
      const patient = await prisma.patient.findUnique({
        where: { userId: req.user!.userId },
      });
      if (patient) where.patientId = patient.id;
      else {
        res.json({ success: true, data: [], error: null, meta: { page: 1, limit: take, total: 0 } });
        return;
      }
    }

    const [admissions, total] = await Promise.all([
      prisma.admission.findMany({
        where,
        include: {
          patient: {
            include: { user: { select: { name: true, phone: true } } },
          },
          doctor: {
            include: { user: { select: { name: true } } },
          },
          bed: {
            include: { ward: true },
          },
        },
        skip,
        take,
        orderBy: { admittedAt: "desc" },
      }),
      prisma.admission.count({ where }),
    ]);

    res.json({
      success: true,
      data: admissions,
      error: null,
      meta: { page: parseInt(page as string), limit: take, total },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/admissions/:id — admission detail
router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const admission = await prisma.admission.findUnique({
        where: { id: req.params.id },
        include: {
          patient: {
            include: { user: { select: { name: true, phone: true, email: true } } },
          },
          doctor: {
            include: { user: { select: { name: true } } },
          },
          bed: {
            include: { ward: true },
          },
          ipdVitals: {
            orderBy: { recordedAt: "desc" },
            take: 20,
          },
          medicationOrders: {
            orderBy: { createdAt: "desc" },
            include: {
              administrations: {
                orderBy: { scheduledAt: "asc" },
                take: 10,
              },
            },
          },
          nurseRounds: {
            orderBy: { performedAt: "desc" },
            take: 20,
            include: {
              nurse: { select: { id: true, name: true } },
            },
          },
        },
      });

      if (!admission) {
        res.status(404).json({ success: false, data: null, error: "Admission not found" });
        return;
      }

      res.json({ success: true, data: admission, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/admissions — admit patient
router.post(
  "/",
  authorize(Role.ADMIN, Role.DOCTOR, Role.RECEPTION),
  validate(admitPatientSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, doctorId, bedId, reason, diagnosis } = req.body;

      const bed = await prisma.bed.findUnique({ where: { id: bedId } });
      if (!bed) {
        res.status(404).json({ success: false, data: null, error: "Bed not found" });
        return;
      }
      if (bed.status !== "AVAILABLE") {
        res.status(409).json({
          success: false,
          data: null,
          error: `Bed is not available (current status: ${bed.status})`,
        });
        return;
      }

      const admissionNumber = await nextAdmissionNumber();

      const admission = await prisma.$transaction(async (tx) => {
        const created = await tx.admission.create({
          data: {
            admissionNumber,
            patientId,
            doctorId,
            bedId,
            reason,
            diagnosis,
            status: "ADMITTED",
          },
          include: {
            patient: {
              include: { user: { select: { name: true, phone: true } } },
            },
            doctor: {
              include: { user: { select: { name: true } } },
            },
            bed: { include: { ward: true } },
          },
        });
        await tx.bed.update({
          where: { id: bedId },
          data: { status: "OCCUPIED" },
        });
        return created;
      });

      auditLog(req, "ADMIT_PATIENT", "admission", admission.id, {
        admissionNumber,
        patientId,
        doctorId,
        bedId,
      }).catch(console.error);

      res.status(201).json({ success: true, data: admission, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/admissions/:id/discharge
router.patch(
  "/:id/discharge",
  authorize(Role.ADMIN, Role.DOCTOR),
  validate(dischargeSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.admission.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        res.status(404).json({ success: false, data: null, error: "Admission not found" });
        return;
      }
      if (existing.status === "DISCHARGED") {
        res.status(409).json({ success: false, data: null, error: "Admission already discharged" });
        return;
      }

      const admission = await prisma.$transaction(async (tx) => {
        const updated = await tx.admission.update({
          where: { id: req.params.id },
          data: {
            status: "DISCHARGED",
            dischargedAt: new Date(),
            dischargeSummary: req.body.dischargeSummary,
            dischargeNotes: req.body.dischargeNotes,
          },
          include: {
            patient: {
              include: { user: { select: { name: true, phone: true } } },
            },
            doctor: { include: { user: { select: { name: true } } } },
            bed: { include: { ward: true } },
          },
        });
        await tx.bed.update({
          where: { id: existing.bedId },
          data: { status: "AVAILABLE" },
        });
        // deactivate remaining medication orders
        await tx.medicationOrder.updateMany({
          where: { admissionId: existing.id, isActive: true },
          data: { isActive: false },
        });
        return updated;
      });

      auditLog(req, "DISCHARGE_PATIENT", "admission", admission.id, {
        admissionNumber: admission.admissionNumber,
      }).catch(console.error);

      res.json({ success: true, data: admission, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/admissions/:id/transfer — transfer to new bed
router.patch(
  "/:id/transfer",
  authorize(Role.ADMIN, Role.DOCTOR, Role.NURSE),
  validate(transferBedSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const existing = await prisma.admission.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) {
        res.status(404).json({ success: false, data: null, error: "Admission not found" });
        return;
      }
      if (existing.status !== "ADMITTED") {
        res.status(409).json({ success: false, data: null, error: "Only ADMITTED admissions can be transferred" });
        return;
      }

      const newBed = await prisma.bed.findUnique({ where: { id: req.body.newBedId } });
      if (!newBed) {
        res.status(404).json({ success: false, data: null, error: "Target bed not found" });
        return;
      }
      if (newBed.status !== "AVAILABLE") {
        res.status(409).json({
          success: false,
          data: null,
          error: `Target bed is not available (status: ${newBed.status})`,
        });
        return;
      }

      const oldBedId = existing.bedId;

      const admission = await prisma.$transaction(async (tx) => {
        await tx.bed.update({ where: { id: oldBedId }, data: { status: "AVAILABLE" } });
        await tx.bed.update({ where: { id: newBed.id }, data: { status: "OCCUPIED" } });
        const updated = await tx.admission.update({
          where: { id: req.params.id },
          data: {
            bedId: newBed.id,
            status: "TRANSFERRED",
          },
          include: {
            patient: { include: { user: { select: { name: true, phone: true } } } },
            doctor: { include: { user: { select: { name: true } } } },
            bed: { include: { ward: true } },
          },
        });
        // Re-set status to ADMITTED after transfer move recorded
        return tx.admission.update({
          where: { id: updated.id },
          data: { status: "ADMITTED" },
          include: {
            patient: { include: { user: { select: { name: true, phone: true } } } },
            doctor: { include: { user: { select: { name: true } } } },
            bed: { include: { ward: true } },
          },
        });
      });

      auditLog(req, "TRANSFER_BED", "admission", admission.id, {
        fromBedId: oldBedId,
        toBedId: newBed.id,
        reason: req.body.reason,
      }).catch(console.error);

      res.json({ success: true, data: admission, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/admissions/:id/vitals — record IPD vitals
router.post(
  "/:id/vitals",
  authorize(Role.ADMIN, Role.DOCTOR, Role.NURSE),
  validate(recordIpdVitalsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const admissionId = req.params.id;
      const admission = await prisma.admission.findUnique({ where: { id: admissionId } });
      if (!admission) {
        res.status(404).json({ success: false, data: null, error: "Admission not found" });
        return;
      }

      const vitals = await prisma.ipdVitals.create({
        data: {
          admissionId,
          recordedBy: req.user!.userId,
          bloodPressureSystolic: req.body.bloodPressureSystolic,
          bloodPressureDiastolic: req.body.bloodPressureDiastolic,
          temperature: req.body.temperature,
          pulseRate: req.body.pulseRate,
          respiratoryRate: req.body.respiratoryRate,
          spO2: req.body.spO2,
          painScore: req.body.painScore,
          bloodSugar: req.body.bloodSugar,
          notes: req.body.notes,
        },
      });

      auditLog(req, "RECORD_IPD_VITALS", "ipdVitals", vitals.id, { admissionId }).catch(console.error);
      res.status(201).json({ success: true, data: vitals, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/admissions/:id/vitals — list vitals
router.get(
  "/:id/vitals",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const vitals = await prisma.ipdVitals.findMany({
        where: { admissionId: req.params.id },
        orderBy: { recordedAt: "desc" },
      });
      res.json({ success: true, data: vitals, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as admissionRouter };
