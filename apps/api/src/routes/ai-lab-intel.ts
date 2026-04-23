import { Router, Request, Response, NextFunction } from "express";
// Multi-tenant wiring: `tenantScopedPrisma` is a Prisma $extends wrapper that
// auto-injects tenantId on create and auto-filters on read for the 20
// tenant-scoped models (see services/tenant-prisma.ts). We alias it to
// `prisma` so every existing call site keeps working without edits.
import { tenantScopedPrisma as prisma } from "../services/tenant-prisma";
import { Role } from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { auditLog } from "../middleware/audit";
import { rateLimit } from "../middleware/rate-limit";
import { analyzeLabResult } from "../services/ai/lab-intel";

const router = Router();
router.use(authenticate);

// security(2026-04-23-med): F-LAB-INTEL-1 — LLM-backed; cap to 20/min/IP.
if (process.env.NODE_ENV !== "test") {
  router.use(rateLimit(20, 60_000));
}

// GET /api/v1/ai/lab-intel/:labResultId — compute (and return, ephemeral) analysis
router.get(
  "/:labResultId",
  authorize(Role.DOCTOR, Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { labResultId } = req.params;

      const existing = await prisma.labResult.findUnique({ where: { id: labResultId } });
      if (!existing) {
        res.status(404).json({ success: false, data: null, error: "LabResult not found" });
        return;
      }

      const analysis = await analyzeLabResult(labResultId);

      auditLog(req, "AI_LAB_INTEL_ANALYZE", "LabResult", labResultId, {
        urgency: analysis.urgency,
        trend: analysis.trend,
      }).catch((err) => {
        console.warn(`[audit] AI_LAB_INTEL_ANALYZE failed (non-fatal):`, (err as Error)?.message ?? err);
      });

      res.json({ success: true, data: { analysis }, error: null });
    } catch (err) {
      if ((err as any)?.statusCode === 404) {
        res.status(404).json({ success: false, data: null, error: "LabResult not found" });
        return;
      }
      next(err);
    }
  }
);

// POST /api/v1/ai/lab-intel/:labResultId/persist — store analysis on LabResult
router.post(
  "/:labResultId/persist",
  authorize(Role.DOCTOR, Role.ADMIN),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { labResultId } = req.params;

      const existing = await prisma.labResult.findUnique({ where: { id: labResultId } });
      if (!existing) {
        res.status(404).json({ success: false, data: null, error: "LabResult not found" });
        return;
      }

      // Allow caller to post a pre-computed analysis (e.g. from the GET call),
      // otherwise compute fresh. Both paths end up writing the same shape.
      const analysis = req.body?.analysis ?? (await analyzeLabResult(labResultId));

      // NOTE: `aiAnalysis` and `aiAnalyzedAt` columns are proposed in
      // services/.prisma-models-doctor-tools.md but not yet in schema.prisma.
      // Until they ship, we persist via the LabResult.notes field as a JSON
      // blob prefix so no schema change is required. Once the columns exist
      // the update() call should target them directly.
      const existingNotes = existing.notes ?? "";
      const serialised = `[AI_INTEL]${JSON.stringify(analysis)}[/AI_INTEL]`;
      const cleaned = existingNotes.replace(/\[AI_INTEL\][\s\S]*?\[\/AI_INTEL\]/, "").trim();
      const newNotes = [cleaned, serialised].filter(Boolean).join("\n");

      const updated = await prisma.labResult.update({
        where: { id: labResultId },
        data: { notes: newNotes },
      });

      auditLog(req, "AI_LAB_INTEL_PERSIST", "LabResult", labResultId, {
        urgency: analysis.urgency,
      }).catch((err) => {
        console.warn(`[audit] AI_LAB_INTEL_PERSIST failed (non-fatal):`, (err as Error)?.message ?? err);
      });

      res.status(201).json({
        success: true,
        data: { labResultId: updated.id, analysis, persistedAt: new Date().toISOString() },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

export { router as aiLabIntelRouter };
