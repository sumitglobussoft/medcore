import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import { Role, waitlistEntrySchema } from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { auditLog } from "../middleware/audit";
import { notifyNextInWaitlist } from "../services/waitlist";

const router = Router();
router.use(authenticate);

// POST /api/v1/waitlist — patient (or reception) joins waitlist for a doctor
router.post(
  "/",
  validate(waitlistEntrySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, doctorId, preferredDate, reason } = req.body as {
        patientId: string;
        doctorId: string;
        preferredDate?: string;
        reason?: string;
      };

      // If the caller is a PATIENT, restrict them to joining for themselves only
      if (req.user!.role === Role.PATIENT) {
        const self = await prisma.patient.findUnique({
          where: { userId: req.user!.userId },
        });
        if (!self || self.id !== patientId) {
          res.status(403).json({
            success: false,
            data: null,
            error: "Patients can only join the waitlist for themselves",
          });
          return;
        }
      }

      // Don't allow duplicate WAITING entries for same patient + doctor
      const existing = await prisma.waitlistEntry.findFirst({
        where: { patientId, doctorId, status: { in: ["WAITING", "NOTIFIED"] } },
      });
      if (existing) {
        res.status(409).json({
          success: false,
          data: null,
          error: "Patient is already on the waitlist for this doctor",
        });
        return;
      }

      const entry = await prisma.waitlistEntry.create({
        data: {
          patientId,
          doctorId,
          preferredDate: preferredDate ? new Date(preferredDate) : null,
          reason,
        },
        include: {
          patient: { include: { user: { select: { name: true, phone: true } } } },
          doctor: { include: { user: { select: { name: true } } } },
        },
      });

      auditLog(req, "JOIN_WAITLIST", "waitlistEntry", entry.id, {
        patientId,
        doctorId,
      }).catch(console.error);

      res.status(201).json({ success: true, data: entry, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/waitlist — list
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { doctorId, patientId, status } = req.query;
    const where: Record<string, unknown> = {};
    if (doctorId) where.doctorId = doctorId;
    if (patientId) where.patientId = patientId;
    if (status) where.status = status;

    // Patients only see their own
    if (req.user!.role === Role.PATIENT) {
      const self = await prisma.patient.findUnique({
        where: { userId: req.user!.userId },
      });
      if (self) where.patientId = self.id;
    }

    const entries = await prisma.waitlistEntry.findMany({
      where,
      include: {
        patient: { include: { user: { select: { name: true, phone: true } } } },
        doctor: { include: { user: { select: { name: true } } } },
      },
      orderBy: [{ status: "asc" }, { createdAt: "asc" }],
      take: 500,
    });

    res.json({ success: true, data: entries, error: null });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/waitlist/:id/cancel — cancel entry
router.patch(
  "/:id/cancel",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const entry = await prisma.waitlistEntry.findUnique({
        where: { id: req.params.id },
        include: { patient: true },
      });
      if (!entry) {
        res
          .status(404)
          .json({ success: false, data: null, error: "Waitlist entry not found" });
        return;
      }

      // Patients can only cancel their own
      if (req.user!.role === Role.PATIENT) {
        const self = await prisma.patient.findUnique({
          where: { userId: req.user!.userId },
        });
        if (!self || self.id !== entry.patientId) {
          res.status(403).json({
            success: false,
            data: null,
            error: "You cannot cancel this entry",
          });
          return;
        }
      }

      const updated = await prisma.waitlistEntry.update({
        where: { id: req.params.id },
        data: { status: "CANCELLED" },
      });

      auditLog(req, "CANCEL_WAITLIST", "waitlistEntry", req.params.id).catch(
        console.error
      );

      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/waitlist/notify-next/:doctorId — manually trigger notify (admin/reception)
router.post(
  "/notify-next/:doctorId",
  authorize(Role.ADMIN, Role.RECEPTION, Role.DOCTOR),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await notifyNextInWaitlist(req.params.doctorId);
      auditLog(req, "NOTIFY_WAITLIST_NEXT", "doctor", req.params.doctorId).catch(
        console.error
      );
      res.json({ success: true, data: { notified: true }, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as waitlistRouter };
