import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import { Role, doctorScheduleSchema, scheduleOverrideSchema, DEFAULT_SLOT_DURATION_MINUTES } from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";

const router = Router();
router.use(authenticate);

// GET /api/v1/doctors — list all doctors
router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const doctors = await prisma.doctor.findMany({
      include: {
        user: {
          select: { id: true, name: true, email: true, phone: true, isActive: true },
        },
        schedules: true,
      },
    });

    res.json({ success: true, data: doctors, error: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/doctors/:id/slots?date=YYYY-MM-DD — get available slots
router.get(
  "/:id/slots",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { date } = req.query;
      if (!date) {
        res.status(400).json({ success: false, data: null, error: "date query param required" });
        return;
      }

      const dateObj = new Date(date as string);
      const dayOfWeek = dateObj.getDay();

      // Check for override
      const override = await prisma.scheduleOverride.findUnique({
        where: {
          doctorId_date: {
            doctorId: req.params.id,
            date: dateObj,
          },
        },
      });

      if (override?.isBlocked) {
        res.json({
          success: true,
          data: { date, slots: [], blocked: true, reason: override.reason },
          error: null,
        });
        return;
      }

      // Get schedule for day of week
      const schedules = await prisma.doctorSchedule.findMany({
        where: { doctorId: req.params.id, dayOfWeek },
      });

      if (schedules.length === 0) {
        res.json({
          success: true,
          data: { date, slots: [], blocked: false, reason: "No schedule for this day" },
          error: null,
        });
        return;
      }

      // Get existing appointments for this date
      const existingAppointments = await prisma.appointment.findMany({
        where: {
          doctorId: req.params.id,
          date: dateObj,
          status: { notIn: ["CANCELLED", "NO_SHOW"] },
        },
        select: { slotStart: true },
      });
      const bookedSlots = new Set(existingAppointments.map((a) => a.slotStart));

      // Generate slots
      const slots: Array<{
        startTime: string;
        endTime: string;
        isAvailable: boolean;
      }> = [];

      for (const schedule of schedules) {
        const startTime = override?.startTime || schedule.startTime;
        const endTime = override?.endTime || schedule.endTime;
        const duration = schedule.slotDurationMinutes || DEFAULT_SLOT_DURATION_MINUTES;
        const buffer = schedule.bufferMinutes || 0;
        const step = duration + buffer;

        const [startH, startM] = startTime.split(":").map(Number);
        const [endH, endM] = endTime.split(":").map(Number);
        const startMinutes = startH * 60 + startM;
        const endMinutes = endH * 60 + endM;

        for (let m = startMinutes; m + duration <= endMinutes; m += step) {
          const slotStart = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
          const slotEndMin = m + duration;
          const slotEnd = `${String(Math.floor(slotEndMin / 60)).padStart(2, "0")}:${String(slotEndMin % 60).padStart(2, "0")}`;

          slots.push({
            startTime: slotStart,
            endTime: slotEnd,
            isAvailable: !bookedSlots.has(slotStart),
          });
        }
      }

      res.json({
        success: true,
        data: { date, slots, blocked: false },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/doctors/:id/schedule — set schedule
router.post(
  "/:id/schedule",
  authorize(Role.ADMIN, Role.DOCTOR),
  validate(doctorScheduleSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const schedule = await prisma.doctorSchedule.upsert({
        where: {
          doctorId_dayOfWeek_startTime: {
            doctorId: req.params.id,
            dayOfWeek: req.body.dayOfWeek,
            startTime: req.body.startTime,
          },
        },
        update: {
          endTime: req.body.endTime,
          slotDurationMinutes: req.body.slotDurationMinutes,
          bufferMinutes: req.body.bufferMinutes ?? 0,
        },
        create: {
          doctorId: req.params.id,
          dayOfWeek: req.body.dayOfWeek,
          startTime: req.body.startTime,
          endTime: req.body.endTime,
          slotDurationMinutes: req.body.slotDurationMinutes,
          bufferMinutes: req.body.bufferMinutes ?? 0,
        },
      });

      res.json({ success: true, data: schedule, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/doctors/:id/override — block date or modify hours
router.post(
  "/:id/override",
  authorize(Role.ADMIN, Role.DOCTOR, Role.RECEPTION),
  validate(scheduleOverrideSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const override = await prisma.scheduleOverride.upsert({
        where: {
          doctorId_date: {
            doctorId: req.params.id,
            date: new Date(req.body.date),
          },
        },
        update: {
          isBlocked: req.body.isBlocked,
          startTime: req.body.startTime,
          endTime: req.body.endTime,
          reason: req.body.reason,
        },
        create: {
          doctorId: req.params.id,
          date: new Date(req.body.date),
          isBlocked: req.body.isBlocked,
          startTime: req.body.startTime,
          endTime: req.body.endTime,
          reason: req.body.reason,
        },
      });

      res.json({ success: true, data: override, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as doctorRouter };
