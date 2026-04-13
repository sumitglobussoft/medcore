import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import { authenticate } from "../middleware/auth";

const router = Router();

// GET /api/v1/queue/:doctorId?date=YYYY-MM-DD — get doctor's queue for a date
// Public endpoint for token display
router.get(
  "/:doctorId",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { date } = req.query;
      const dateObj = date ? new Date(date as string) : new Date();
      dateObj.setHours(0, 0, 0, 0);

      const appointments = await prisma.appointment.findMany({
        where: {
          doctorId: req.params.doctorId,
          date: dateObj,
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
        include: {
          patient: {
            include: { user: { select: { name: true } } },
          },
          vitals: true,
        },
        orderBy: [
          { priority: "desc" },
          { tokenNumber: "asc" },
        ],
      });

      const currentPatient = appointments.find(
        (a) => a.status === "IN_CONSULTATION"
      );
      const avgConsultTime = 15; // minutes — can be made dynamic later

      const queue = appointments.map((a, idx) => {
        let estimatedWaitMinutes = 0;
        if (a.status === "BOOKED" || a.status === "CHECKED_IN") {
          const ahead = appointments
            .slice(0, idx)
            .filter(
              (ap) =>
                ap.status === "BOOKED" ||
                ap.status === "CHECKED_IN" ||
                ap.status === "IN_CONSULTATION"
            ).length;
          estimatedWaitMinutes = ahead * avgConsultTime;
        }

        return {
          tokenNumber: a.tokenNumber,
          patientName: a.patient.user.name,
          patientId: a.patientId,
          appointmentId: a.id,
          type: a.type,
          status: a.status,
          priority: a.priority,
          slotTime: a.slotStart,
          hasVitals: !!a.vitals,
          estimatedWaitMinutes,
        };
      });

      res.json({
        success: true,
        data: {
          doctorId: req.params.doctorId,
          date: dateObj.toISOString().split("T")[0],
          currentToken: currentPatient?.tokenNumber ?? null,
          totalInQueue: queue.filter(
            (q) =>
              q.status === "BOOKED" ||
              q.status === "CHECKED_IN" ||
              q.status === "IN_CONSULTATION"
          ).length,
          queue,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/queue — all doctors' current tokens (for display board)
router.get(
  "/",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const doctors = await prisma.doctor.findMany({
        include: {
          user: { select: { name: true } },
        },
      });

      const display = await Promise.all(
        doctors.map(async (doc) => {
          const current = await prisma.appointment.findFirst({
            where: {
              doctorId: doc.id,
              date: today,
              status: "IN_CONSULTATION",
            },
          });

          const waitingCount = await prisma.appointment.count({
            where: {
              doctorId: doc.id,
              date: today,
              status: { in: ["BOOKED", "CHECKED_IN"] },
            },
          });

          return {
            doctorId: doc.id,
            doctorName: doc.user.name,
            specialization: doc.specialization,
            currentToken: current?.tokenNumber ?? null,
            waitingCount,
          };
        })
      );

      res.json({ success: true, data: display, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as queueRouter };
