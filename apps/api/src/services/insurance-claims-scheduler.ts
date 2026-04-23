// Background scheduler for the insurance-claims reconciliation worker.
//
// Mirrors the pattern in `./retention-scheduler.ts`: expose a
// `start*` function that callers (app.ts) invoke once at boot. The interval
// handle is not exported because there is no shutdown path that needs it.

import { reconcilePendingClaims } from "./insurance-claims/reconciliation";

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Registers an hourly interval that reconciles still-open claims against
 * their TPA adapters. Call `startClaimsScheduler()` once at app startup.
 */
export function startClaimsScheduler(): void {
  setInterval(async () => {
    try {
      const result = await reconcilePendingClaims();
      console.log(
        `[ClaimsReconcile] Checked ${result.checked}, updated ${result.updated}, errors ${result.errors.length}`
      );
    } catch (err) {
      console.error("[ClaimsReconcile] Reconciliation run failed:", err);
    }
  }, ONE_HOUR_MS);
}
