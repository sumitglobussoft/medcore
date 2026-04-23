#!/usr/bin/env tsx
/**
 * migrate-insurance-claims-to-v2
 * ─────────────────────────────────────────────────────────────────────────────
 * Safe, idempotent data migration from the legacy `InsuranceClaim` table
 * (maps to `insurance_claims`) to the new `InsuranceClaim2` table
 * (maps to `insurance_claims_v2`).
 *
 * The legacy model is thin (insuranceProvider + policyNumber + amount + status)
 * while v2 is TPA-aware (tpaProvider enum, ICD-10 codes, admission/discharge
 * dates, denied reasons, rich status lifecycle). Most v2 required fields have
 * no legacy equivalent — we synthesise safe defaults and flag them in the log.
 *
 * Design notes
 * ─────────────
 * • Idempotency: v2 has a `providerClaimRef @unique` column. We synthesise
 *   `providerClaimRef = "LEGACY-<legacyId>"` so re-runs upsert instead of
 *   duplicating. This survives partial failures mid-batch.
 *
 * • Transactionality: each batch is wrapped in `prisma.$transaction([...])`
 *   so one bad row rolls back its batch only — earlier successful batches
 *   stay committed.
 *
 * • Status mapping: legacy `ClaimStatus` (SUBMITTED|APPROVED|REJECTED|SETTLED)
 *   ↦ v2 `NormalisedClaimStatus` via `mapStatus()`. Unknown values throw.
 *
 * • Relations: the legacy `InsuranceClaim` model has only `invoice` + `patient`
 *   relations in the Prisma schema. There is no `InsurancePreAuth` or
 *   "cashless workflow docs" relation on the legacy model — so step (e) in
 *   the brief is a documented no-op here. We still scan `PreAuthRequest`
 *   rows matching the same invoice/patient and copy a linkage hint into
 *   the v2 `preAuthRequestId` when a safe, unambiguous match is found.
 *
 * • Logging: everything is emitted on stderr (console.error). stdout is
 *   reserved for a single JSON summary line at the end so the caller can
 *   `... | jq '.'` for parsing.
 *
 * Usage
 * ─────
 *   # dry-run (DEFAULT — no writes):
 *   npx tsx scripts/migrate-insurance-claims-to-v2.ts
 *
 *   # apply (writes to DB):
 *   npx tsx scripts/migrate-insurance-claims-to-v2.ts --apply
 *
 *   # custom batch size:
 *   npx tsx scripts/migrate-insurance-claims-to-v2.ts --batch-size=50 --apply
 *
 *   # pipe the summary into jq:
 *   npx tsx scripts/migrate-insurance-claims-to-v2.ts --apply 2>/dev/null | jq '.'
 *
 * NEVER deletes legacy rows — that's a separate step performed only after
 * `scripts/verify-insurance-claims-migration.ts` confirms parity.
 */

import { config as loadEnv } from "dotenv";
import path from "path";
import { prisma } from "@medcore/db";
import type {
  InsuranceClaim as LegacyInsuranceClaim,
  Prisma,
} from "@prisma/client";

// ── Env loading ─────────────────────────────────────────────────────────────
// Try workspace-root .env first, then apps/api/.env, without overwriting vars
// that are already set in the calling shell.
loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), "apps/api/.env") });

if (!process.env.DATABASE_URL) {
  console.error(
    "[migrate] FATAL: DATABASE_URL is not set. Aborting before any DB work."
  );
  process.exit(2);
}

// ── CLI parsing ─────────────────────────────────────────────────────────────

interface CliArgs {
  apply: boolean;
  batchSize: number;
}

function parseArgs(argv: string[]): CliArgs {
  let apply = false;
  let batchSize = 100;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg.startsWith("--batch-size=")) {
      const raw = arg.slice("--batch-size=".length);
      const n = Number.parseInt(raw, 10);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`[migrate] invalid --batch-size=${raw}`);
        process.exit(2);
      }
      batchSize = n;
    } else if (arg === "--help" || arg === "-h") {
      console.error(
        "Usage: tsx scripts/migrate-insurance-claims-to-v2.ts [--apply] [--batch-size=N]"
      );
      process.exit(0);
    }
  }
  return { apply, batchSize };
}

const args = parseArgs(process.argv.slice(2));
const MODE: "DRY_RUN" | "APPLY" = args.apply ? "APPLY" : "DRY_RUN";

// ── Status mapping ──────────────────────────────────────────────────────────

// Legacy `ClaimStatus` (from enum in schema.prisma line ~69):
//   SUBMITTED | APPROVED | REJECTED | SETTLED
// v2 `NormalisedClaimStatus`:
//   SUBMITTED | IN_REVIEW | QUERY_RAISED | APPROVED | PARTIALLY_APPROVED |
//   DENIED | SETTLED | CANCELLED

// Explicit string union — using a string keyof approach to avoid a dep on the
// generated enum object in case it lands under a different name shape.
type LegacyStatus = "SUBMITTED" | "APPROVED" | "REJECTED" | "SETTLED";
type V2Status =
  | "SUBMITTED"
  | "IN_REVIEW"
  | "QUERY_RAISED"
  | "APPROVED"
  | "PARTIALLY_APPROVED"
  | "DENIED"
  | "SETTLED"
  | "CANCELLED";

function mapStatus(legacy: string): V2Status {
  switch (legacy as LegacyStatus) {
    case "SUBMITTED":
      return "SUBMITTED";
    case "APPROVED":
      return "APPROVED";
    case "REJECTED":
      return "DENIED"; // v2 uses DENIED; legacy REJECTED has the same semantics
    case "SETTLED":
      return "SETTLED";
    default:
      throw new Error(
        `[migrate] unknown legacy ClaimStatus=${JSON.stringify(
          legacy
        )} — refusing to guess. Add a case to mapStatus().`
      );
  }
}

// ── Transform ───────────────────────────────────────────────────────────────

interface TransformResult {
  /** v2 row payload (no id — upsert generates/keeps it). */
  data: Prisma.InsuranceClaim2UncheckedCreateInput;
  /** Fields that we synthesised a default for (no legacy source). */
  synthesisedFields: string[];
  /** Legacy-only fields we preserved in the `notes` JSON blob. */
  preservedFields: string[];
  /** Optional preAuthRequestId linkage inferred from PreAuthRequest table. */
  preAuthRequestId: string | null;
}

/**
 * Build the v2 payload from a legacy row. Pure — no DB calls. Takes an
 * optional already-resolved `preAuthRequestId` (caller does the lookup).
 */
function transform(
  legacy: LegacyInsuranceClaim,
  preAuthRequestId: string | null,
  migratedAt: Date
): TransformResult {
  const v2Status = mapStatus(legacy.status);
  const synthesised: string[] = [];
  const preserved: string[] = [];

  // providerClaimRef — synthetic & deterministic for idempotent upsert.
  const providerClaimRef = `LEGACY-${legacy.id}`;

  // tpaProvider — legacy only has `insuranceProvider` free text. We cannot
  // reliably map to the strict v2 enum, so default to MOCK and log it.
  // (Using MOCK over OTHER because the v2 TpaProvider enum has no OTHER —
  // see packages/db/prisma/schema.prisma `enum TpaProvider`.)
  const tpaProvider = "MOCK";
  synthesised.push("tpaProvider");

  // insurerName — take it from legacy.insuranceProvider (free text).
  const insurerName = legacy.insuranceProvider;

  // policyNumber — same.
  const policyNumber = legacy.policyNumber;

  // diagnosis — legacy has no diagnosis column. Synthesise.
  const diagnosis = "(migrated from legacy — diagnosis unknown)";
  synthesised.push("diagnosis");

  // createdBy — legacy has no audit author. Synthesise.
  const createdBy = "SYSTEM_MIGRATION";
  synthesised.push("createdBy");

  // Amounts.
  const amountClaimed = legacy.claimAmount;
  const amountApproved =
    legacy.approvedAmount === null || legacy.approvedAmount === undefined
      ? null
      : legacy.approvedAmount;

  // Dates — legacy has submittedAt (required) + resolvedAt (nullable). v2
  // has approvedAt, settledAt, cancelledAt — we route resolvedAt based on
  // the mapped status.
  const submittedAt = legacy.submittedAt;
  let approvedAt: Date | null = null;
  let settledAt: Date | null = null;
  if (legacy.resolvedAt) {
    if (v2Status === "APPROVED" || v2Status === "PARTIALLY_APPROVED") {
      approvedAt = legacy.resolvedAt;
    } else if (v2Status === "SETTLED") {
      // Settled implies earlier approved — populate both.
      approvedAt = legacy.resolvedAt;
      settledAt = legacy.resolvedAt;
    }
    // For DENIED / CANCELLED we don't have a distinct denied-at column in v2;
    // the status + lastSyncedAt carry the signal. Preserve the raw timestamp
    // in the notes blob for auditability.
    preserved.push("resolvedAt");
  }

  // Preserve every legacy column in the notes blob so nothing is silently
  // dropped. Consumed by the verifier script for parity checks.
  const legacyNotesBlob = {
    __migrated_from: "insurance_claims",
    __migrated_at: migratedAt.toISOString(),
    legacy: {
      id: legacy.id,
      invoiceId: legacy.invoiceId,
      patientId: legacy.patientId,
      insuranceProvider: legacy.insuranceProvider,
      policyNumber: legacy.policyNumber,
      claimAmount: legacy.claimAmount,
      approvedAmount: legacy.approvedAmount,
      status: legacy.status,
      submittedAt: legacy.submittedAt.toISOString(),
      resolvedAt: legacy.resolvedAt ? legacy.resolvedAt.toISOString() : null,
    },
  };
  const notes = `Migrated from legacy insurance_claims on ${migratedAt
    .toISOString()
    .slice(0, 10)} | ${JSON.stringify(legacyNotesBlob)}`;

  const data: Prisma.InsuranceClaim2UncheckedCreateInput = {
    billId: legacy.invoiceId,
    patientId: legacy.patientId,
    tpaProvider,
    providerClaimRef,
    insurerName,
    policyNumber,
    memberId: null,
    preAuthRequestId,
    diagnosis,
    icd10Codes: [] as unknown as Prisma.InputJsonValue,
    procedureName: null,
    admissionDate: null,
    dischargeDate: null,
    amountClaimed,
    amountApproved,
    status: v2Status,
    deniedReason: v2Status === "DENIED" ? "(migrated — reason unknown)" : null,
    notes,
    submittedAt,
    approvedAt,
    settledAt,
    cancelledAt: null,
    lastSyncedAt: null,
    createdBy,
  };

  return {
    data,
    synthesisedFields: synthesised,
    preservedFields: preserved,
    preAuthRequestId,
  };
}

// ── PreAuth linkage resolver ────────────────────────────────────────────────

/**
 * Try to find a PreAuthRequest that *unambiguously* belongs to this legacy
 * claim. Matching heuristic:
 *   - same patientId
 *   - policyNumber equals legacy.policyNumber
 *   - status in APPROVED/PARTIAL
 *   - exactly ONE match (zero or >1 means we don't link to avoid false joins)
 */
async function resolvePreAuthLinkage(
  legacy: LegacyInsuranceClaim
): Promise<string | null> {
  const candidates = await prisma.preAuthRequest.findMany({
    where: {
      patientId: legacy.patientId,
      policyNumber: legacy.policyNumber,
      status: { in: ["APPROVED", "PARTIAL"] },
    },
    select: { id: true },
    take: 2, // we only care whether it's 0, 1, or 2+
  });
  return candidates.length === 1 ? candidates[0].id : null;
}

// ── Migration driver ────────────────────────────────────────────────────────

interface BatchOutcome {
  migrated: number;
  skipped: Array<{ legacyId: string; reason: string }>;
  failed: Array<{ legacyId: string; error: string }>;
}

async function runBatch(
  rows: LegacyInsuranceClaim[],
  migratedAt: Date
): Promise<BatchOutcome> {
  const outcome: BatchOutcome = { migrated: 0, skipped: [], failed: [] };

  // Pre-resolve PreAuth linkages outside the transaction to keep the
  // transaction short.
  const transforms: Array<{
    legacy: LegacyInsuranceClaim;
    result: TransformResult;
  }> = [];
  for (const row of rows) {
    try {
      const preAuthId = await resolvePreAuthLinkage(row);
      const t = transform(row, preAuthId, migratedAt);
      transforms.push({ legacy: row, result: t });
    } catch (err) {
      outcome.failed.push({
        legacyId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (transforms.length === 0) return outcome;

  if (MODE === "DRY_RUN") {
    for (const { legacy, result } of transforms) {
      console.error(
        `[migrate:DRY] would upsert providerClaimRef=${result.data.providerClaimRef} ` +
          `billId=${legacy.invoiceId} status=${result.data.status} ` +
          `amount=${result.data.amountClaimed} ` +
          `synthesised=[${result.synthesisedFields.join(",")}] ` +
          `preserved=[${result.preservedFields.join(",")}] ` +
          `preAuthLinkage=${result.preAuthRequestId ?? "none"}`
      );
      outcome.migrated += 1;
    }
    return outcome;
  }

  // APPLY mode — one $transaction per batch so a bad row rolls back only
  // this batch.
  try {
    await prisma.$transaction(async (tx) => {
      for (const { legacy, result } of transforms) {
        const ref = result.data.providerClaimRef!;
        // Upsert keyed by the unique providerClaimRef (LEGACY-<id>) — makes
        // re-runs idempotent.
        const upserted = await tx.insuranceClaim2.upsert({
          where: { providerClaimRef: ref },
          create: result.data,
          update: {
            // On re-run we only refresh the volatile fields. We deliberately
            // do NOT overwrite the notes blob so the original migration
            // timestamp is preserved.
            status: result.data.status,
            amountApproved: result.data.amountApproved,
            approvedAt: result.data.approvedAt,
            settledAt: result.data.settledAt,
            deniedReason: result.data.deniedReason,
          },
        });

        // Record a status event — skip if one already exists for this claim
        // with a matching migration note (idempotency across re-runs).
        const alreadyLogged = await tx.claimStatusEvent.findFirst({
          where: {
            claimId: upserted.id,
            note: { startsWith: "Migrated from legacy insurance_claims on" },
          },
          select: { id: true },
        });
        if (!alreadyLogged) {
          // `result.data.status` is non-null by construction in transform()
          // but Prisma's generated type marks it optional (it has a DB
          // default). Fall back to "SUBMITTED" so the type-checker is happy.
          await tx.claimStatusEvent.create({
            data: {
              claimId: upserted.id,
              status: result.data.status ?? "SUBMITTED",
              note: `Migrated from legacy insurance_claims on ${migratedAt
                .toISOString()
                .slice(0, 10)}`,
              source: "MANUAL",
              createdBy: "SYSTEM_MIGRATION",
              timestamp: migratedAt,
            },
          });
        }

        outcome.migrated += 1;
        console.error(
          `[migrate:APPLY] upserted id=${upserted.id} providerClaimRef=${ref} ` +
            `legacyId=${legacy.id}`
        );
      }
    });
  } catch (err) {
    // Whole batch rolled back — all rows in `transforms` are "failed" for
    // reporting purposes.
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[migrate:APPLY] BATCH ROLLED BACK: ${msg}`);
    outcome.migrated = 0;
    for (const { legacy } of transforms) {
      outcome.failed.push({
        legacyId: legacy.id,
        error: `batch rollback: ${msg}`,
      });
    }
  }

  return outcome;
}

async function main() {
  const migratedAt = new Date();
  console.error(
    `[migrate] mode=${MODE} batchSize=${args.batchSize} startedAt=${migratedAt.toISOString()}`
  );

  // (a) count legacy rows
  const total = await prisma.insuranceClaim.count();
  console.error(`[migrate] legacy insurance_claims rows: ${total}`);

  if (total === 0) {
    const summary = {
      mode: MODE,
      total: 0,
      migrated: 0,
      skipped: 0,
      failed: 0,
      startedAt: migratedAt.toISOString(),
      finishedAt: new Date().toISOString(),
    };
    console.log(JSON.stringify(summary));
    await prisma.$disconnect();
    return;
  }

  // (b) paginate by createdAt (legacy has no createdAt — fall back to submittedAt,
  // which is the only sortable timestamp on the legacy model).
  const aggregate: BatchOutcome = { migrated: 0, skipped: [], failed: [] };
  let cursor: { id: string } | undefined = undefined;

  // Loop until we page through the full table. We use take+cursor instead of
  // skip so we don't re-fetch rows if a re-sort happens mid-run.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const batch: LegacyInsuranceClaim[] = await prisma.insuranceClaim.findMany({
      take: args.batchSize,
      ...(cursor ? { cursor, skip: 1 } : {}),
      orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
    });
    if (batch.length === 0) break;

    console.error(
      `[migrate] processing batch of ${batch.length} (firstId=${batch[0].id})`
    );
    const outcome = await runBatch(batch, migratedAt);
    aggregate.migrated += outcome.migrated;
    aggregate.skipped.push(...outcome.skipped);
    aggregate.failed.push(...outcome.failed);

    cursor = { id: batch[batch.length - 1].id };
    if (batch.length < args.batchSize) break;
  }

  const finishedAt = new Date();
  const summary = {
    mode: MODE,
    total,
    migrated: aggregate.migrated,
    skipped: aggregate.skipped.length,
    failed: aggregate.failed.length,
    skippedSample: aggregate.skipped.slice(0, 10),
    failedSample: aggregate.failed.slice(0, 10),
    startedAt: migratedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - migratedAt.getTime(),
  };

  console.error(
    `[migrate] done mode=${MODE} total=${total} migrated=${aggregate.migrated} ` +
      `skipped=${aggregate.skipped.length} failed=${aggregate.failed.length}`
  );
  // Single JSON line on stdout — consumable by `jq`.
  console.log(JSON.stringify(summary));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[migrate] FATAL:", err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
