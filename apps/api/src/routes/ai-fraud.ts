import { Router, Request, Response, NextFunction } from "express";
import { tenantScopedPrisma as prisma } from "../services/tenant-prisma";
import { Role } from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { auditLog } from "../middleware/audit";
import { detectBillingAnomalies } from "../services/ai/fraud-detection";

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

export const aiFraudRouter = Router();

aiFraudRouter.use(authenticate);
aiFraudRouter.use(authorize(Role.ADMIN));

/**
 * Returns the FraudAlert delegate when the model has been migrated. Until
 * then the routes return 503 so callers can register the router eagerly.
 */
function fraudAlertDelegate(): { ok: true; delegate: any } | { ok: false } {
  const delegate = (prisma as unknown as { fraudAlert?: any }).fraudAlert;
  if (!delegate?.findMany) return { ok: false };
  return { ok: true, delegate };
}

function modelUnavailable(res: Response): void {
  res.status(503).json({
    success: false,
    data: null,
    error:
      "FraudAlert model is not yet migrated. See apps/api/src/services/.prisma-models-ops-quality.md",
  });
}

// ─── POST /scan ───────────────────────────────────────────────────────────

aiFraudRouter.post(
  "/scan",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const windowDays = Math.max(
        1,
        Math.min(365, parseInt(String(req.body?.windowDays ?? 30), 10) || 30)
      );
      const llmReview = Boolean(req.body?.llmReview);

      const result = await detectBillingAnomalies({ windowDays, llmReview, persist: true });

      safeAudit(req, "AI_FRAUD_SCAN", "FraudAlert", undefined, {
        windowDays,
        llmReview,
        hits: result.hits.length,
        persisted: result.persisted,
      });

      res.json({
        success: true,
        data: {
          alertCount: result.persisted,
          hitCount: result.hits.length,
          windowDays: result.windowDays,
          scannedAt: result.scannedAt,
          llmReview,
        },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /alerts ──────────────────────────────────────────────────────────

aiFraudRouter.get(
  "/alerts",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const d = fraudAlertDelegate();
      if (!d.ok) {
        modelUnavailable(res);
        return;
      }

      const { severity, status, type, from, to } = req.query as Record<string, string | undefined>;
      const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
      const limit = Math.max(1, Math.min(200, parseInt(String(req.query.limit ?? "50"), 10) || 50));

      const where: Record<string, unknown> = {};
      if (severity) where.severity = severity;
      if (status) where.status = status;
      if (type) where.type = type;
      if (from || to) {
        const range: Record<string, Date> = {};
        if (from) range.gte = new Date(from);
        if (to) range.lte = new Date(to);
        where.detectedAt = range;
      }

      const [items, total] = await Promise.all([
        d.delegate.findMany({
          where,
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { detectedAt: "desc" },
        }),
        d.delegate.count({ where }),
      ]);

      res.json({
        success: true,
        data: items,
        error: null,
        meta: { page, limit, total },
      });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /alerts/:id ──────────────────────────────────────────────────────

aiFraudRouter.get(
  "/alerts/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const d = fraudAlertDelegate();
      if (!d.ok) {
        modelUnavailable(res);
        return;
      }
      const alert = await d.delegate.findUnique({ where: { id: req.params.id } });
      if (!alert) {
        res.status(404).json({ success: false, data: null, error: "Alert not found" });
        return;
      }
      res.json({ success: true, data: alert, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /alerts/:id/acknowledge ─────────────────────────────────────────

aiFraudRouter.post(
  "/alerts/:id/acknowledge",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const d = fraudAlertDelegate();
      if (!d.ok) {
        modelUnavailable(res);
        return;
      }
      const newStatus = String(req.body?.status ?? "ACKNOWLEDGED");
      if (!["ACKNOWLEDGED", "DISMISSED", "ESCALATED"].includes(newStatus)) {
        res.status(400).json({
          success: false,
          data: null,
          error: "status must be one of ACKNOWLEDGED, DISMISSED, ESCALATED",
        });
        return;
      }
      const existing = await d.delegate.findUnique({ where: { id: req.params.id } });
      if (!existing) {
        res.status(404).json({ success: false, data: null, error: "Alert not found" });
        return;
      }
      const userId = (req as Request & { user?: { userId?: string } }).user?.userId;
      const updated = await d.delegate.update({
        where: { id: req.params.id },
        data: {
          status: newStatus,
          acknowledgedBy: userId ?? "SYSTEM",
          acknowledgedAt: new Date(),
          resolutionNote: req.body?.resolutionNote ?? undefined,
        },
      });
      safeAudit(req, "AI_FRAUD_ALERT_UPDATE", "FraudAlert", req.params.id, {
        newStatus,
      });
      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// ─── Scheduler-invoked entry (exported so scheduled-tasks can call it) ────

export async function runDailyFraudScan(): Promise<void> {
  try {
    const result = await detectBillingAnomalies({ windowDays: 1, llmReview: false, persist: true });
    console.log(
      `[ai-fraud] daily scan: ${result.persisted} alerts persisted from ${result.hits.length} hits`
    );
  } catch (err) {
    console.error("[ai-fraud] daily scan failed", err);
  }
}
