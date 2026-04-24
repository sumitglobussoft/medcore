import { Router, Request, Response } from "express";
import { prisma } from "@medcore/db";
import { Role } from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { getSchedulerStatus } from "../services/scheduled-tasks";

// ─── /api/health and /api/health/deep (Gap 3) ───────────────────────────────
//
// Two endpoints:
//
//   GET  /api/health        — public; shallow { status, timestamp,
//                             rateLimitsEnabled } payload. Cheap and
//                             safe for load-balancer probes.
//   GET  /api/health/deep   — ADMIN; full payload including DB
//                             connectivity, scheduler last-run timestamps,
//                             and prompt-registry cache age.
//
// WIRING NOTE: `app.ts` currently defines `GET /api/health` inline. To pick
// up the richer payload from this router you MUST mount it in app.ts BEFORE
// the inline handler (Express matches the first registered route). See the
// report in apps/api/src/routes/health.ts for the exact lines to add.

const router = Router();

export function isRateLimitsEnabled(): boolean {
  // Rate limits are ON whenever DISABLE_RATE_LIMITS is anything other than
  // the literal string "true". Tests set NODE_ENV=test which bypasses at
  // the middleware layer, but we report rate-limit config independently so
  // a probe in CI still shows the intended prod posture.
  return process.env.DISABLE_RATE_LIMITS !== "true";
}

// ─── Shallow health (public) ───────────────────────────

router.get("/", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    rateLimitsEnabled: isRateLimitsEnabled(),
  });
});

// ─── Deep health (ADMIN) ────────────────────────────────

router.get(
  "/deep",
  authenticate,
  authorize(Role.ADMIN),
  async (_req: Request, res: Response) => {
    const started = Date.now();

    // DB connectivity — a single $queryRaw round-trip; fast and reliable.
    let dbOk = false;
    let dbLatencyMs: number | null = null;
    try {
      const t0 = Date.now();
      await prisma.$queryRawUnsafe("SELECT 1");
      dbLatencyMs = Date.now() - t0;
      dbOk = true;
    } catch (err) {
      console.error("[health/deep] DB probe failed:", err);
    }

    // Scheduler freshness: last-run timestamps for the retention / claims /
    // chronic-care / audit-archival / rate-limit-bypass tasks.
    let schedulers: Awaited<ReturnType<typeof getSchedulerStatus>> = [];
    try {
      schedulers = await getSchedulerStatus();
    } catch (err) {
      console.error("[health/deep] scheduler status fetch failed:", err);
    }

    // Prompt-registry cache age: peek at when the active-prompt cache was
    // last populated. Importing lazily keeps the heavy AI code out of the
    // shallow health path.
    let promptCacheAgeSeconds: number | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const reg = require("../services/ai/prompt-registry") as {
        getOldestPromptCacheAgeSeconds?: () => number;
      };
      if (typeof reg.getOldestPromptCacheAgeSeconds === "function") {
        const age = reg.getOldestPromptCacheAgeSeconds();
        // `0` means empty cache — surface that as null for the consumer so
        // they can render "cache empty" rather than "0s old".
        promptCacheAgeSeconds = age > 0 ? Math.floor(age) : null;
      }
    } catch {
      // prompt-registry optional — leave null if unavailable
    }

    res.json({
      status: dbOk ? "ok" : "degraded",
      timestamp: new Date().toISOString(),
      rateLimitsEnabled: isRateLimitsEnabled(),
      disableRateLimitsEnv: process.env.DISABLE_RATE_LIMITS ?? null,
      database: {
        reachable: dbOk,
        latencyMs: dbLatencyMs,
      },
      schedulers: schedulers.map((s) => ({
        name: s.name,
        intervalMinutes: s.intervalMinutes,
        lastRunAt: s.lastRunAt,
        minutesSinceLastRun: s.minutesSinceLastRun,
      })),
      promptRegistry: {
        cacheAgeSeconds: promptCacheAgeSeconds,
      },
      elapsedMs: Date.now() - started,
    });
  }
);

export const healthRouter = router;
