import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import { createPatientSchema, updatePatientSchema, recordVitalsSchema, Role } from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";

const router = Router();

// All patient routes require authentication
router.use(authenticate);

// GET /api/v1/patients — search/list patients
router.get(
  "/",
  authorize(Role.ADMIN, Role.DOCTOR, Role.RECEPTION, Role.NURSE),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { search, page = "1", limit = "20" } = req.query;
      const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
      const take = Math.min(parseInt(limit as string), 100);

      const where: any = search
        ? {
            OR: [
              { mrNumber: { contains: search as string, mode: "insensitive" } },
              { user: { name: { contains: search as string, mode: "insensitive" } } },
              { user: { phone: { contains: search as string } } },
            ],
          }
        : {};

      const [patients, total] = await Promise.all([
        prisma.patient.findMany({
          where,
          include: {
            user: {
              select: { id: true, name: true, email: true, phone: true },
            },
          },
          skip,
          take,
          orderBy: { user: { name: "asc" } },
        }),
        prisma.patient.count({ where }),
      ]);

      res.json({
        success: true,
        data: patients,
        error: null,
        meta: { page: parseInt(page as string), limit: take, total },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/patients/:id
router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const patient = await prisma.patient.findUnique({
        where: { id: req.params.id },
        include: {
          user: {
            select: { id: true, name: true, email: true, phone: true },
          },
          appointments: {
            orderBy: { date: "desc" },
            take: 20,
            include: {
              doctor: { include: { user: { select: { name: true } } } },
            },
          },
          vitals: { orderBy: { recordedAt: "desc" }, take: 10 },
          prescriptions: {
            orderBy: { createdAt: "desc" },
            take: 10,
            include: { items: true },
          },
        },
      });

      if (!patient) {
        res.status(404).json({ success: false, data: null, error: "Patient not found" });
        return;
      }

      res.json({ success: true, data: patient, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/patients — register new patient (reception)
router.post(
  "/",
  authorize(Role.ADMIN, Role.RECEPTION),
  validate(createPatientSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = req.body;

      // Auto-generate MR number
      const config = await prisma.systemConfig.findUnique({
        where: { key: "next_mr_number" },
      });
      const mrSeq = config ? parseInt(config.value) : 1;
      const mrNumber = `MR${String(mrSeq).padStart(6, "0")}`;

      // Create user + patient in transaction
      const result = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: data.name,
            email: data.email || `patient_${mrSeq}@medcore.local`,
            phone: data.phone,
            passwordHash: "", // walk-in patients may not need login
            role: "PATIENT",
          },
        });

        const patient = await tx.patient.create({
          data: {
            userId: user.id,
            mrNumber,
            dateOfBirth: data.dateOfBirth
              ? new Date(data.dateOfBirth)
              : undefined,
            age: data.age,
            gender: data.gender,
            address: data.address,
            bloodGroup: data.bloodGroup,
            emergencyContactName: data.emergencyContactName,
            emergencyContactPhone: data.emergencyContactPhone,
            insuranceProvider: data.insuranceProvider,
            insurancePolicyNumber: data.insurancePolicyNumber,
          },
        });

        await tx.systemConfig.update({
          where: { key: "next_mr_number" },
          data: { value: String(mrSeq + 1) },
        });

        return { ...patient, user: { id: user.id, name: user.name, email: user.email, phone: user.phone } };
      });

      res.status(201).json({ success: true, data: result, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/patients/:id
router.patch(
  "/:id",
  authorize(Role.ADMIN, Role.RECEPTION),
  validate(updatePatientSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name, phone, email, ...patientData } = req.body;

      const patient = await prisma.patient.findUnique({
        where: { id: req.params.id },
      });
      if (!patient) {
        res.status(404).json({ success: false, data: null, error: "Patient not found" });
        return;
      }

      await prisma.$transaction(async (tx) => {
        if (name || phone || email) {
          await tx.user.update({
            where: { id: patient.userId },
            data: {
              ...(name && { name }),
              ...(phone && { phone }),
              ...(email && { email }),
            },
          });
        }

        if (Object.keys(patientData).length > 0) {
          await tx.patient.update({
            where: { id: req.params.id },
            data: patientData,
          });
        }
      });

      const updated = await prisma.patient.findUnique({
        where: { id: req.params.id },
        include: {
          user: { select: { id: true, name: true, email: true, phone: true } },
        },
      });

      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/patients/:id/vitals — record vitals (nurse)
router.post(
  "/:id/vitals",
  authorize(Role.NURSE, Role.DOCTOR, Role.ADMIN),
  validate(recordVitalsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const vitals = await prisma.vitals.create({
        data: {
          ...req.body,
          patientId: req.params.id,
          nurseId: req.user!.userId,
        },
      });

      res.status(201).json({ success: true, data: vitals, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/patients/:id/history — visit history
router.get(
  "/:id/history",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const appointments = await prisma.appointment.findMany({
        where: { patientId: req.params.id },
        orderBy: { date: "desc" },
        include: {
          doctor: { include: { user: { select: { name: true } } } },
          vitals: true,
          consultation: true,
          prescription: { include: { items: true } },
          invoice: { include: { payments: true } },
        },
      });

      res.json({ success: true, data: appointments, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as patientRouter };
