// Insurance TPA claims reconciliation worker.
//
// Claims are submitted to a TPA asynchronously: the adapter returns a
// `providerClaimRef` immediately, but the actual adjudication outcome
// (APPROVED / DENIED / SETTLED / QUERY_RAISED / ...) lands on the TPA side at
// some later point. MedCore originally relied only on the manual
// `GET /claims/:id?sync=1` path to pick those changes up, which meant a claim
// could sit at `SUBMITTED` in our DB indefinitely.
//
// This module walks every claim in a "still-open" status whose `lastSyncedAt`
// is older than the configured staleness window, asks the adapter for the
// latest status, and — if it changed — writes a `ClaimStatusEvent` row plus
// patches the claim itself. It's intentionally a plain function: the
// scheduler (`../insurance-claims-scheduler.ts`) wraps it in a `setInterval`
// and ops can also trigger it on demand via `POST /api/v1/claims/reconcile`.

import { prisma } from "@medcore/db";
import { getAdapter } from "./registry";
import { NormalisedClaimStatus, TpaProvider } from "./adapter";

/**
 * Statuses we consider "still open" — anything else (APPROVED, DENIED,
 * SETTLED, CANCELLED, PARTIALLY_APPROVED) is terminal from our point of view
 * and doesn't warrant polling the TPA again.
 *
 * NOTE: the adapter layer's `NormalisedClaimStatus` does not have a
 * `UNDER_REVIEW` / `PENDING_INFO` pair — it uses `IN_REVIEW` and
 * `QUERY_RAISED` for the same concepts. The brief mentions the older names;
 * we map to the ones that actually exist in the Prisma enum so we don't feed
 * bad filter values into `findMany`.
 */
export const PENDING_STATUSES: readonly NormalisedClaimStatus[] = [
  "SUBMITTED",
  "IN_REVIEW",
  "QUERY_RAISED",
] as const;

/** Default: only re-sync a claim if its last sync was more than 1 hour ago. */
export const DEFAULT_STALENESS_MS = 60 * 60 * 1000;

export interface ReconcileError {
  claimId: string;
  error: string;
}

export interface ReconcileResult {
  checked: number;
  updated: number;
  errors: ReconcileError[];
}

export interface ReconcileOptions {
  /**
   * Override the "how stale is stale" cutoff (defaults to 1 hour). Tests use
   * a 0-ms value so they don't have to backdate rows manually.
   */
  stalenessMs?: number;
  /** Override the clock so tests can be deterministic. */
  now?: Date;
}

/**
 * Walk pending claims, poll each TPA for latest status, persist any changes.
 *
 * Intentionally swallows per-claim errors so a single flaky TPA can't poison
 * the whole run — errors are collected and returned to the caller.
 */
export async function reconcilePendingClaims(
  opts: ReconcileOptions = {}
): Promise<ReconcileResult> {
  const now = opts.now ?? new Date();
  const stalenessMs = opts.stalenessMs ?? DEFAULT_STALENESS_MS;
  const cutoff = new Date(now.getTime() - stalenessMs);

  // Pull candidates: open status + (never synced OR synced before the cutoff).
  // We exclude rows without a providerClaimRef: if we never got one back from
  // the TPA there's nothing to poll with.
  const candidates = await prisma.insuranceClaim2.findMany({
    where: {
      status: { in: [...PENDING_STATUSES] },
      providerClaimRef: { not: null },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }],
    },
    orderBy: { submittedAt: "asc" },
  });

  const result: ReconcileResult = {
    checked: candidates.length,
    updated: 0,
    errors: [],
  };

  for (const claim of candidates) {
    try {
      const adapter = getAdapter(claim.tpaProvider as TpaProvider);
      const ref = claim.providerClaimRef;
      if (!ref) {
        // Filter guarantees this can't happen, but TS doesn't know that.
        continue;
      }
      const statusRes = await adapter.getClaimStatus(ref);
      if (!statusRes.ok) {
        result.errors.push({
          claimId: claim.id,
          error: `${statusRes.error.code}: ${statusRes.error.message}`,
        });
        continue;
      }

      const tpaStatus = statusRes.data.status;
      const statusChanged = tpaStatus !== claim.status;
      const amountChanged =
        statusRes.data.amountApproved !== undefined &&
        statusRes.data.amountApproved !== null &&
        Number(statusRes.data.amountApproved) !==
          (claim.amountApproved === null ? null : Number(claim.amountApproved));
      const deniedReasonChanged =
        statusRes.data.deniedReason !== undefined &&
        statusRes.data.deniedReason !== null &&
        statusRes.data.deniedReason !== claim.deniedReason;

      if (!statusChanged && !amountChanged && !deniedReasonChanged) {
        // Nothing to record, but we still bump lastSyncedAt so we don't
        // re-poll this claim on the next tick.
        await prisma.insuranceClaim2.update({
          where: { id: claim.id },
          data: { lastSyncedAt: now },
        });
        continue;
      }

      // Atomic status flip + event write. Only add an event when the status
      // actually changed — pure amount/reason updates aren't an event.
      await prisma.$transaction(async (tx) => {
        const patch: {
          status?: NormalisedClaimStatus;
          amountApproved?: number | null;
          deniedReason?: string | null;
          lastSyncedAt: Date;
          approvedAt?: Date;
          settledAt?: Date;
        } = { lastSyncedAt: now };
        if (statusChanged) patch.status = tpaStatus;
        if (amountChanged)
          patch.amountApproved = statusRes.data.amountApproved ?? null;
        if (deniedReasonChanged)
          patch.deniedReason = statusRes.data.deniedReason ?? null;
        if (statusChanged && tpaStatus === "APPROVED" && !claim.approvedAt)
          patch.approvedAt = now;
        if (statusChanged && tpaStatus === "SETTLED" && !claim.settledAt)
          patch.settledAt = now;

        await tx.insuranceClaim2.update({ where: { id: claim.id }, data: patch });

        if (statusChanged) {
          await tx.claimStatusEvent.create({
            data: {
              claimId: claim.id,
              status: tpaStatus,
              note: `Reconciled from ${claim.tpaProvider}`,
              source: "API",
              createdBy: null,
              timestamp: now,
            },
          });
        }
      });

      if (statusChanged) result.updated += 1;
    } catch (err) {
      result.errors.push({
        claimId: claim.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
