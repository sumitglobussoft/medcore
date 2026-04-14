import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import { Role } from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";

const router = Router();
router.use(authenticate);
router.use(authorize(Role.ADMIN, Role.RECEPTION));

// ─── Helpers ───────────────────────────────────────

function parseRange(req: Request): { from: Date; to: Date } {
  const fromStr = req.query.from as string | undefined;
  const toStr = req.query.to as string | undefined;

  const now = new Date();
  const defaultFrom = new Date(now);
  defaultFrom.setDate(defaultFrom.getDate() - 30);
  defaultFrom.setHours(0, 0, 0, 0);

  const from = fromStr ? new Date(fromStr) : defaultFrom;
  from.setHours(0, 0, 0, 0);

  const to = toStr ? new Date(toStr) : now;
  to.setHours(23, 59, 59, 999);

  return { from, to };
}

function parseGroupBy(req: Request): "day" | "week" | "month" {
  const g = (req.query.groupBy as string) || "day";
  if (g === "week" || g === "month") return g;
  return "day";
}

function calcAge(dob: Date | null | undefined, fallback: number | null | undefined): number | null {
  if (!dob) return fallback ?? null;
  const diff = Date.now() - new Date(dob).getTime();
  const ageDate = new Date(diff);
  return Math.abs(ageDate.getUTCFullYear() - 1970);
}

// ─── GET /analytics/overview ───────────────────────

router.get("/overview", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = parseRange(req);

    const [
      totalPatients,
      newPatientsInPeriod,
      totalAppointments,
      apptStatusGrouped,
      payments,
      pendingBills,
      currentlyAdmitted,
      consultations,
    ] = await Promise.all([
      prisma.patient.count(),
      prisma.patient.count({
        where: {
          user: { createdAt: { gte: from, lte: to } },
        },
      }),
      prisma.appointment.count({ where: { date: { gte: from, lte: to } } }),
      prisma.appointment.groupBy({
        by: ["status"],
        where: { date: { gte: from, lte: to } },
        _count: { _all: true },
      }),
      prisma.payment.findMany({
        where: { paidAt: { gte: from, lte: to } },
        select: { amount: true, mode: true },
      }),
      prisma.invoice.count({
        where: { paymentStatus: { in: ["PENDING", "PARTIAL"] } },
      }),
      prisma.admission.count({ where: { status: "ADMITTED" } }),
      prisma.consultation.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { createdAt: true, updatedAt: true },
      }),
    ]);

    const appointmentsByStatus: Record<string, number> = {
      BOOKED: 0,
      CHECKED_IN: 0,
      IN_CONSULTATION: 0,
      COMPLETED: 0,
      CANCELLED: 0,
      NO_SHOW: 0,
    };
    apptStatusGrouped.forEach((s) => {
      appointmentsByStatus[s.status] = s._count._all;
    });

    const revenueByMode: Record<string, number> = {
      CASH: 0,
      CARD: 0,
      UPI: 0,
      ONLINE: 0,
      INSURANCE: 0,
    };
    let totalRevenue = 0;
    payments.forEach((p) => {
      totalRevenue += p.amount;
      revenueByMode[p.mode] = (revenueByMode[p.mode] || 0) + p.amount;
    });

    let avgConsultationTime = 0;
    if (consultations.length > 0) {
      const totalMs = consultations.reduce(
        (sum, c) => sum + (new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime()),
        0
      );
      avgConsultationTime = Math.round(totalMs / consultations.length / 60000);
    }

    res.json({
      success: true,
      data: {
        totalPatients,
        newPatientsInPeriod,
        totalAppointments,
        appointmentsByStatus,
        totalRevenue,
        revenueByMode,
        pendingBills,
        currentlyAdmitted,
        avgConsultationTime,
      },
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/appointments (time series) ─────

router.get("/appointments", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = parseRange(req);
    const groupBy = parseGroupBy(req);

    const appointments = await prisma.appointment.findMany({
      where: { date: { gte: from, lte: to } },
      select: { date: true, type: true },
    });

    const bucketKey = (d: Date): string => {
      const dt = new Date(d);
      if (groupBy === "month") {
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-01`;
      }
      if (groupBy === "week") {
        const day = dt.getUTCDay();
        const diff = dt.getUTCDate() - day;
        const weekStart = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), diff));
        return weekStart.toISOString().split("T")[0];
      }
      return dt.toISOString().split("T")[0];
    };

    const buckets = new Map<string, { date: string; count: number; scheduled: number; walkin: number }>();
    appointments.forEach((a) => {
      const key = bucketKey(a.date);
      if (!buckets.has(key)) {
        buckets.set(key, { date: key, count: 0, scheduled: 0, walkin: 0 });
      }
      const b = buckets.get(key)!;
      b.count++;
      if (a.type === "WALK_IN") b.walkin++;
      else b.scheduled++;
    });

    const data = Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));

    res.json({ success: true, data, error: null });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/revenue (time series) ──────────

router.get("/revenue", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = parseRange(req);
    const groupBy = parseGroupBy(req);

    const payments = await prisma.payment.findMany({
      where: { paidAt: { gte: from, lte: to } },
      select: { amount: true, mode: true, paidAt: true },
    });

    const bucketKey = (d: Date): string => {
      const dt = new Date(d);
      if (groupBy === "month") {
        return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-01`;
      }
      if (groupBy === "week") {
        const day = dt.getUTCDay();
        const diff = dt.getUTCDate() - day;
        const weekStart = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), diff));
        return weekStart.toISOString().split("T")[0];
      }
      return dt.toISOString().split("T")[0];
    };

    const buckets = new Map<
      string,
      { date: string; total: number; cash: number; card: number; upi: number; online: number; insurance: number }
    >();

    payments.forEach((p) => {
      const key = bucketKey(p.paidAt);
      if (!buckets.has(key)) {
        buckets.set(key, {
          date: key,
          total: 0,
          cash: 0,
          card: 0,
          upi: 0,
          online: 0,
          insurance: 0,
        });
      }
      const b = buckets.get(key)!;
      b.total += p.amount;
      switch (p.mode) {
        case "CASH":
          b.cash += p.amount;
          break;
        case "CARD":
          b.card += p.amount;
          break;
        case "UPI":
          b.upi += p.amount;
          break;
        case "ONLINE":
          b.online += p.amount;
          break;
        case "INSURANCE":
          b.insurance += p.amount;
          break;
      }
    });

    const data = Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
    res.json({ success: true, data, error: null });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/doctors ────────────────────────

router.get("/doctors", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = parseRange(req);

    const doctors = await prisma.doctor.findMany({
      include: {
        user: { select: { name: true } },
        appointments: {
          where: { date: { gte: from, lte: to } },
          include: {
            consultation: { select: { createdAt: true, updatedAt: true } },
            invoice: { include: { payments: true } },
          },
        },
      },
    });

    const data = doctors.map((doc) => {
      const appts = doc.appointments;
      const appointmentCount = appts.length;
      const completedCount = appts.filter((a) => a.status === "COMPLETED").length;
      const patientIds = new Set(appts.map((a) => a.patientId));

      const consultationDurations = appts
        .map((a) => a.consultation)
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => new Date(c.updatedAt).getTime() - new Date(c.createdAt).getTime());

      const avgDurationMin =
        consultationDurations.length > 0
          ? Math.round(
              consultationDurations.reduce((sum, d) => sum + d, 0) /
                consultationDurations.length /
                60000
            )
          : 0;

      let revenue = 0;
      appts.forEach((a) => {
        if (a.invoice) {
          a.invoice.payments.forEach((p) => {
            if (p.paidAt >= from && p.paidAt <= to) revenue += p.amount;
          });
        }
      });

      return {
        doctorId: doc.id,
        doctorName: doc.user.name,
        appointmentCount,
        completedCount,
        avgDurationMin,
        revenue,
        patientCount: patientIds.size,
      };
    });

    data.sort((a, b) => b.appointmentCount - a.appointmentCount);

    res.json({ success: true, data, error: null });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/top-diagnoses ──────────────────

router.get("/top-diagnoses", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = parseRange(req);
    const limit = Math.min(parseInt((req.query.limit as string) || "10"), 50);

    const prescriptions = await prisma.prescription.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { diagnosis: true },
    });

    const counts = new Map<string, number>();
    prescriptions.forEach((p) => {
      const key = (p.diagnosis || "").trim();
      if (!key) return;
      counts.set(key, (counts.get(key) || 0) + 1);
    });

    const data = Array.from(counts.entries())
      .map(([diagnosis, count]) => ({ diagnosis, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    res.json({ success: true, data, error: null });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/patient-demographics ───────────

router.get("/patient-demographics", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const patients = await prisma.patient.findMany({
      select: { gender: true, dateOfBirth: true, age: true },
    });

    const byGender: Record<string, number> = { MALE: 0, FEMALE: 0, OTHER: 0 };
    const byAgeGroup: Record<string, number> = {
      "0-18": 0,
      "19-35": 0,
      "36-55": 0,
      "56+": 0,
    };

    patients.forEach((p) => {
      byGender[p.gender] = (byGender[p.gender] || 0) + 1;
      const age = calcAge(p.dateOfBirth, p.age);
      if (age === null) return;
      if (age <= 18) byAgeGroup["0-18"]++;
      else if (age <= 35) byAgeGroup["19-35"]++;
      else if (age <= 55) byAgeGroup["36-55"]++;
      else byAgeGroup["56+"]++;
    });

    res.json({ success: true, data: { byGender, byAgeGroup }, error: null });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/ipd/occupancy ──────────────────

router.get("/ipd/occupancy", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const wards = await prisma.ward.findMany({
      include: { beds: true },
    });

    let totalBeds = 0;
    let occupied = 0;

    const byWard = wards.map((w) => {
      const total = w.beds.length;
      const occ = w.beds.filter((b) => b.status === "OCCUPIED").length;
      totalBeds += total;
      occupied += occ;
      return { wardName: w.name, total, occupied: occ };
    });

    res.json({
      success: true,
      data: {
        totalBeds,
        occupied,
        available: totalBeds - occupied,
        byWard,
      },
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/ipd/adls ───────────────────────

router.get("/ipd/adls", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { from, to } = parseRange(req);

    const admissions = await prisma.admission.findMany({
      where: {
        admittedAt: { gte: from, lte: to },
      },
      select: {
        status: true,
        admittedAt: true,
        dischargedAt: true,
      },
    });

    const totalAdmissions = admissions.length;
    const discharged = admissions.filter((a) => a.status === "DISCHARGED" && a.dischargedAt);
    const dischargeRate = totalAdmissions > 0 ? (discharged.length / totalAdmissions) * 100 : 0;

    let avgLengthOfStay = 0;
    if (discharged.length > 0) {
      const totalMs = discharged.reduce(
        (sum, a) =>
          sum + (new Date(a.dischargedAt!).getTime() - new Date(a.admittedAt).getTime()),
        0
      );
      avgLengthOfStay = +(totalMs / discharged.length / (1000 * 60 * 60 * 24)).toFixed(1);
    }

    res.json({
      success: true,
      data: {
        totalAdmissions,
        discharged: discharged.length,
        dischargeRate: +dischargeRate.toFixed(1),
        avgLengthOfStayDays: avgLengthOfStay,
      },
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/pharmacy/low-stock ─────────────

router.get("/pharmacy/low-stock", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const items = await prisma.inventoryItem.findMany({
      include: { medicine: { select: { name: true } } },
    });

    const lowStock = items.filter((i) => i.quantity <= i.reorderLevel);

    res.json({
      success: true,
      data: {
        count: lowStock.length,
        items: lowStock.slice(0, 20).map((i) => ({
          id: i.id,
          medicineName: i.medicine.name,
          quantity: i.quantity,
          reorderLevel: i.reorderLevel,
          batchNumber: i.batchNumber,
        })),
      },
      error: null,
    });
  } catch (err) {
    next(err);
  }
});

// ─── GET /analytics/pharmacy/top-dispensed ─────────

router.get("/pharmacy/top-dispensed", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) || "10"), 50);

    const movements = await prisma.stockMovement.findMany({
      where: { type: "DISPENSED" },
      include: {
        inventoryItem: {
          include: { medicine: { select: { name: true } } },
        },
      },
    });

    const counts = new Map<string, number>();
    movements.forEach((m) => {
      const name = m.inventoryItem.medicine.name;
      counts.set(name, (counts.get(name) || 0) + Math.abs(m.quantity));
    });

    const data = Array.from(counts.entries())
      .map(([medicineName, dispensed]) => ({ medicineName, dispensed }))
      .sort((a, b) => b.dispensed - a.dispensed)
      .slice(0, limit);

    res.json({ success: true, data, error: null });
  } catch (err) {
    next(err);
  }
});

export { router as analyticsRouter };
