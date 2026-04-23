#!/usr/bin/env tsx
/**
 * verify-insurance-claims-migration
 * ─────────────────────────────────────────────────────────────────────────────
 * Companion to `migrate-insurance-claims-to-v2.ts`. Read-only — never writes.
 *
 * Checks:
 *   1. Row counts: legacy `insurance_claims` vs migrated v2 rows
 *      (those with providerClaimRef starting "LEGACY-").
 *   2. Random sample of 10 migrated v2 rows — compare each field back to
 *      its legacy source for parity.
 *   3. Any v2 row whose notes blob we embedded is unparseable — flagged.
 *
 * Output:
 *   • Human-readable report on stderr.
 *   • Single JSON summary on stdout (pipe to `jq`).
 *
 * Usage:
 *   npx tsx scripts/verify-insurance-claims-migration.ts
 *   npx tsx scripts/verify-insurance-claims-migration.ts --sample=25
 */

import { config as loadEnv } from "dotenv";
import path from "path";
import { prisma } from "@medcore/db";
import type { InsuranceClaim as LegacyInsuranceClaim } from "@prisma/client";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), "apps/api/.env") });

if (!process.env.DATABASE_URL) {
  console.error("[verify] FATAL: DATABASE_URL is not set.");
  process.exit(2);
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): { sample: number } {
  let sample = 10;
  for (const arg of argv) {
    if (arg.startsWith("--sample=")) {
      const n = Number.parseInt(arg.slice("--sample=".length), 10);
      if (Number.isFinite(n) && n > 0) sample = n;
    }
  }
  return { sample };
}

const args = parseArgs(process.argv.slice(2));

// ── Status mapping (mirror of the migration script) ─────────────────────────

function expectedV2Status(legacy: string): string {
  switch (legacy) {
    case "SUBMITTED":
      return "SUBMITTED";
    case "APPROVED":
      return "APPROVED";
    case "REJECTED":
      return "DENIED";
    case "SETTLED":
      return "SETTLED";
    default:
      return "__UNKNOWN__";
  }
}

// ── Diff helper ─────────────────────────────────────────────────────────────

interface FieldDiff {
  field: string;
  legacy: unknown;
  v2: unknown;
  expected?: unknown;
}

function compareRow(
  legacy: LegacyInsuranceClaim,
  v2: {
    id: string;
    billId: string;
    patientId: string;
    insurerName: string;
    policyNumber: string;
    amountClaimed: number;
    amountApproved: number | null;
    status: string;
    submittedAt: Date;
    providerClaimRef: string | null;
  }
): FieldDiff[] {
  const diffs: FieldDiff[] = [];

  if (v2.billId !== legacy.invoiceId) {
    diffs.push({ field: "billId", legacy: legacy.invoiceId, v2: v2.billId });
  }
  if (v2.patientId !== legacy.patientId) {
    diffs.push({ field: "patientId", legacy: legacy.patientId, v2: v2.patientId });
  }
  if (v2.insurerName !== legacy.insuranceProvider) {
    diffs.push({
      field: "insurerName",
      legacy: legacy.insuranceProvider,
      v2: v2.insurerName,
    });
  }
  if (v2.policyNumber !== legacy.policyNumber) {
    diffs.push({
      field: "policyNumber",
      legacy: legacy.policyNumber,
      v2: v2.policyNumber,
    });
  }
  if (Number(v2.amountClaimed) !== Number(legacy.claimAmount)) {
    diffs.push({
      field: "amountClaimed",
      legacy: legacy.claimAmount,
      v2: v2.amountClaimed,
    });
  }
  const legacyApproved =
    legacy.approvedAmount === null || legacy.approvedAmount === undefined
      ? null
      : Number(legacy.approvedAmount);
  const v2Approved =
    v2.amountApproved === null || v2.amountApproved === undefined
      ? null
      : Number(v2.amountApproved);
  if (legacyApproved !== v2Approved) {
    diffs.push({
      field: "amountApproved",
      legacy: legacyApproved,
      v2: v2Approved,
    });
  }
  const expectStatus = expectedV2Status(legacy.status);
  if (v2.status !== expectStatus) {
    diffs.push({
      field: "status",
      legacy: legacy.status,
      v2: v2.status,
      expected: expectStatus,
    });
  }
  if (v2.submittedAt.getTime() !== legacy.submittedAt.getTime()) {
    diffs.push({
      field: "submittedAt",
      legacy: legacy.submittedAt.toISOString(),
      v2: v2.submittedAt.toISOString(),
    });
  }
  if (v2.providerClaimRef !== `LEGACY-${legacy.id}`) {
    diffs.push({
      field: "providerClaimRef",
      legacy: legacy.id,
      v2: v2.providerClaimRef,
      expected: `LEGACY-${legacy.id}`,
    });
  }

  return diffs;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date();
  console.error(
    `[verify] startedAt=${startedAt.toISOString()} sampleSize=${args.sample}`
  );

  const legacyCount = await prisma.insuranceClaim.count();
  const migratedCount = await prisma.insuranceClaim2.count({
    where: { providerClaimRef: { startsWith: "LEGACY-" } },
  });
  const v2TotalCount = await prisma.insuranceClaim2.count();

  console.error(
    `[verify] counts: legacy=${legacyCount} migrated_v2=${migratedCount} ` +
      `all_v2=${v2TotalCount}`
  );

  // Sample: take N random migrated v2 rows (ORDER BY random() is DB-specific —
  // Postgres-only via $queryRawUnsafe would be faster, but we stay portable
  // by doing two-pass sampling in app code).
  const migratedIds = await prisma.insuranceClaim2.findMany({
    where: { providerClaimRef: { startsWith: "LEGACY-" } },
    select: { id: true },
  });

  const pickCount = Math.min(args.sample, migratedIds.length);
  const picks = new Set<string>();
  while (picks.size < pickCount) {
    picks.add(migratedIds[Math.floor(Math.random() * migratedIds.length)].id);
  }

  const mismatches: Array<{
    v2Id: string;
    legacyId: string | null;
    diffs: FieldDiff[];
  }> = [];
  const unparseableNotes: string[] = [];
  let spotChecked = 0;

  for (const v2Id of picks) {
    const v2 = await prisma.insuranceClaim2.findUnique({ where: { id: v2Id } });
    if (!v2 || !v2.providerClaimRef) continue;

    const legacyId = v2.providerClaimRef.replace(/^LEGACY-/, "");
    const legacy = await prisma.insuranceClaim.findUnique({
      where: { id: legacyId },
    });

    if (!legacy) {
      mismatches.push({
        v2Id: v2.id,
        legacyId,
        diffs: [
          {
            field: "__existence__",
            legacy: null,
            v2: "present",
            expected: "legacy row should still exist",
          },
        ],
      });
      spotChecked += 1;
      continue;
    }

    // Sanity-check that the embedded notes blob round-trips.
    if (v2.notes) {
      const jsonStart = v2.notes.indexOf("{");
      if (jsonStart >= 0) {
        try {
          JSON.parse(v2.notes.slice(jsonStart));
        } catch {
          unparseableNotes.push(v2.id);
        }
      }
    }

    const diffs = compareRow(legacy, v2);
    if (diffs.length > 0) {
      mismatches.push({ v2Id: v2.id, legacyId: legacy.id, diffs });
    }
    spotChecked += 1;
  }

  const finishedAt = new Date();
  const summary = {
    counts: {
      legacy: legacyCount,
      migrated_v2: migratedCount,
      all_v2: v2TotalCount,
      missing: Math.max(legacyCount - migratedCount, 0),
    },
    spotCheck: {
      sampleRequested: args.sample,
      sampled: spotChecked,
      mismatches: mismatches.length,
      unparseableNotes: unparseableNotes.length,
    },
    mismatches,
    unparseableNotes,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };

  if (mismatches.length > 0) {
    console.error(
      `[verify] FAIL: ${mismatches.length} of ${spotChecked} sampled rows ` +
        `had field-level mismatches.`
    );
  } else {
    console.error(
      `[verify] OK: ${spotChecked} sampled rows matched legacy 1:1.`
    );
  }

  console.log(JSON.stringify(summary));
  await prisma.$disconnect();

  // Exit non-zero if parity failed so CI can block on this.
  if (mismatches.length > 0 || legacyCount > migratedCount) {
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error("[verify] FATAL:", err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
