import { Router, Request, Response, NextFunction } from "express";
import { tenantScopedPrisma as prisma } from "../services/tenant-prisma";
import { Role } from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { auditLog } from "../middleware/audit";
import { validateUuidParams } from "../middleware/validate-params";
import { evaluateThresholds } from "../services/chronic-care-scheduler";

function safeAudit(
  req: Request,
  action: string,
  entity: string,
  entityId: string | undefined,
  details?: Record<string, unknown>
): void {
  auditLog(req, action, entity, entityId, details).catch((err) => {
    console.warn(`[audit] ${action} failed (non-fatal):`, (err as Error)?.message ?? err);
  });
}

const router = Router();
router.use(authenticate);

const VALID_CONDITIONS = new Set([
  "DIABETES",
  "HYPERTENSION",
  "ASTHMA",
  "TB",
  "OTHER",
]);

const VALID_FREQUENCIES = new Set([1, 3, 7]);

// ── POST /api/v1/ai/coaching/enroll ───────────────────────────────────────────

router.post(
  "/enroll",
  authorize(Role.DOCTOR, Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId, condition, checkInFrequencyDays, thresholds } =
        (req.body ?? {}) as {
          patientId?: string;
          condition?: string;
          checkInFrequencyDays?: number;
          thresholds?: Record<string, unknown>;
        };

      if (!patientId || typeof patientId !== "string") {
        res.status(400).json({ success: false, data: null, error: "patientId is required" });
        return;
      }
      if (!condition || !VALID_CONDITIONS.has(condition)) {
        res.status(400).json({
          success: false,
          data: null,
          error: "condition must be one of DIABETES, HYPERTENSION, ASTHMA, TB, OTHER",
        });
        return;
      }
      const freq = Number(checkInFrequencyDays);
      if (!VALID_FREQUENCIES.has(freq)) {
        res.status(400).json({
          success: false,
          data: null,
          error: "checkInFrequencyDays must be 1, 3, or 7",
        });
        return;
      }

      const patient = await prisma.patient.findUnique({
        where: { id: patientId },
        select: { id: true },
      });
      if (!patient) {
        res.status(404).json({ success: false, data: null, error: "Patient not found" });
        return;
      }

      const plan = await prisma.chronicCarePlan.create({
        data: {
          patientId,
          condition: condition as any,
          checkInFrequencyDays: freq,
          thresholds: (thresholds ?? {}) as any,
          active: true,
          createdBy: req.user!.userId,
        },
      });

      await auditLog(req, "CHRONIC_CARE_ENROLL", "ChronicCarePlan", plan.id, {
        patientId,
        condition,
        checkInFrequencyDays: freq,
      });

      res.status(201).json({ success: true, data: plan, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// ── GET /api/v1/ai/coaching/plans/:patientId ──────────────────────────────────

router.get(
  "/plans/:patientId",
  validateUuidParams(["patientId"]),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { patientId } = req.params;

      // security: patient can only view their own plans; clinical staff can
      // view any
      const user = req.user!;
      const isPrivileged =
        user.role === Role.ADMIN ||
        user.role === Role.DOCTOR ||
        user.role === Role.NURSE;
      if (!isPrivileged) {
        const patient = await prisma.patient.findUnique({
          where: { id: patientId },
          select: { userId: true },
        });
        if (!patient || patient.userId !== user.userId) {
          res.status(403).json({ success: false, data: null, error: "Forbidden" });
          return;
        }
      }

      const plans = await prisma.chronicCarePlan.findMany({
        where: { patientId, active: true },
        orderBy: { createdAt: "desc" },
      });

      safeAudit(req, "CHRONIC_CARE_READ", "ChronicCarePlan", undefined, {
        patientId,
        count: plans.length,
      });

      res.json({ success: true, data: plans, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// ── POST /api/v1/ai/coaching/plans/:id/check-in ───────────────────────────────

router.post(
  "/plans/:id/check-in",
  validateUuidParams(["id"]),
  authorize(Role.PATIENT),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { responses } = (req.body ?? {}) as {
        responses?: Record<string, unknown>;
      };

      if (!responses || typeof responses !== "object" || Array.isArray(responses)) {
        res.status(400).json({
          success: false,
          data: null,
          error: "responses must be an object mapping metric -> value",
        });
        return;
      }

      const plan = await prisma.chronicCarePlan.findUnique({
        where: { id },
      });
      if (!plan) {
        res.status(404).json({ success: false, data: null, error: "Plan not found" });
        return;
      }

      // Verify caller owns the plan's patient
      const patient = await prisma.patient.findUnique({
        where: { id: plan.patientId },
        select: { userId: true },
      });
      if (!patient || patient.userId !== req.user!.userId) {
        res.status(403).json({ success: false, data: null, error: "Forbidden" });
        return;
      }

      const thresholds = (plan.thresholds as Record<string, number>) || {};
      const breaches = evaluateThresholds(thresholds, responses);

      const checkIn = await prisma.chronicCareCheckIn.create({
        data: {
          planId: plan.id,
          patientId: plan.patientId,
          responses: responses as any,
          thresholdsBreached: (breaches as any) ?? undefined,
        },
      });

      let alert: any = null;
      if (breaches && breaches.length > 0) {
        const severity =
          breaches.length >= 3
            ? "CRITICAL"
            : breaches.length === 2
            ? "HIGH"
            : "MEDIUM";
        const reason = breaches
          .map((b) => `${b.key} observed ${b.observed} (>= threshold ${b.threshold})`)
          .join("; ");
        alert = await prisma.chronicCareAlert.create({
          data: {
            planId: plan.id,
            patientId: plan.patientId,
            severity: severity as any,
            reason,
          },
        });
      }

      await auditLog(req, "CHRONIC_CARE_CHECKIN", "ChronicCareCheckIn", checkIn.id, {
        planId: plan.id,
        breachCount: breaches?.length ?? 0,
        alertCreated: !!alert,
      });

      res.status(201).json({
        success: true,
        data: { checkIn, alert },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

export { router as aiCoachingRouter };
