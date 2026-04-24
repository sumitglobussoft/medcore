#!/usr/bin/env tsx
/**
 * dedup-active-admissions
 * ─────────────────────────────────────────────────────────────────────────────
 * Remediate Issue #37 (same patient marked ADMITTED on two different beds
 * simultaneously) on prod data.
 *
 * Scope:
 *   Finds every patient with 2+ `status='ADMITTED'` admission rows. Keeps the
 *   most recent admission (by `admittedAt`, then by `createdAt`) as ADMITTED.
 *   Every older duplicate is flipped to DISCHARGED with:
 *     - dischargedAt = now
 *     - conditionAtDischarge = "UNCHANGED"
 *     - dischargeNotes prefixed
 *       "[Auto-closed: duplicate admission detected, see ticket #37]"
 *     - the bed freed back to AVAILABLE (unless another ADMITTED row still
 *       references it, in which case we leave it alone to avoid corrupting
 *       the kept admission).
 *
 *   Note on status label: the task brief asks for
 *   `DISCHARGE_AGAINST_MEDICAL_ADVICE`, but `AdmissionStatus` enum only
 *   has ADMITTED / DISCHARGED / TRANSFERRED. We use DISCHARGED + the notes
 *   marker so audit trails stay intact; see
 *   apps/api/src/services/.prisma-models-admission-unique.md for the enum
 *   extension follow-up.
 *
 * Design notes
 * ─────────────
 * - Dry-run by default (same pattern as scripts/backfill-patient-ages.ts).
 *   Pass `--apply` to write.
 * - Uses raw `prisma` from @medcore/db (NOT tenantScopedPrisma) so the
 *   script sees every tenant. Tenant filtering would be wrong here —
 *   cleanup runs cross-tenant for operators.
 * - Emits per-duplicate rows to stderr for operator spot-check, plus a
 *   single JSON summary to stdout so CI can capture it.
 * - Each duplicate is closed in its own transaction so a mid-run failure
 *   never leaves bed+admission out of sync.
 *
 * Usage
 * ─────
 *   # dry-run (DEFAULT — safe, zero writes):
 *   npx tsx scripts/dedup-active-admissions.ts
 *
 *   # apply:
 *   npx tsx scripts/dedup-active-admissions.ts --apply
 */

import { config as loadEnv } from "dotenv";
import path from "path";
import { prisma } from "@medcore/db";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), "apps/api/.env") });

if (!process.env.DATABASE_URL) {
  console.error(
    "[dedup-admissions] FATAL: DATABASE_URL is not set. Aborting before any DB work."
  );
  process.exit(2);
}

// ── CLI parsing ─────────────────────────────────────────────────────────────

interface CliArgs {
  apply: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--help" || arg === "-h") {
      console.error(
        "Usage: tsx scripts/dedup-active-admissions.ts [--apply]\n" +
          "\n" +
          "Closes duplicate ADMITTED admissions for the same patient,\n" +
          "keeping the most recent. Frees the orphaned beds. Dry-run by default."
      );
      process.exit(0);
    }
  }
  return { apply };
}

const args = parseArgs(process.argv.slice(2));
const MODE: "DRY_RUN" | "APPLY" = args.apply ? "APPLY" : "DRY_RUN";

const CLOSE_NOTE =
  "[Auto-closed: duplicate admission detected, see ticket #37]";

interface PerAction {
  patientId: string;
  keptAdmissionId: string;
  keptBedId: string;
  closedAdmissionId: string;
  closedBedId: string;
  admittedAt: string;
  freedBed: boolean;
  applied: boolean;
}

async function main() {
  const startedAt = new Date();
  console.error(
    `[dedup-admissions] mode=${MODE} startedAt=${startedAt.toISOString()}`
  );

  // Load every ADMITTED admission (across tenants). We keep this simple and
  // in-memory rather than a GROUP BY — datasets here are small (active
  // admissions are bounded by bed count).
  const active = await prisma.admission.findMany({
    where: { status: "ADMITTED" },
    select: {
      id: true,
      patientId: true,
      bedId: true,
      admittedAt: true,
      createdAt: true,
      tenantId: true,
      dischargeNotes: true,
    },
    orderBy: [{ admittedAt: "desc" }, { createdAt: "desc" }],
  });

  console.error(
    `[dedup-admissions] loaded ${active.length} ADMITTED admission rows`
  );

  // Group by patientId
  const byPatient = new Map<string, typeof active>();
  for (const a of active) {
    const arr = byPatient.get(a.patientId) || [];
    arr.push(a);
    byPatient.set(a.patientId, arr);
  }

  const duplicates = [...byPatient.entries()].filter(
    ([, rows]) => rows.length > 1
  );
  console.error(
    `[dedup-admissions] patients with 2+ ACTIVE admissions: ${duplicates.length}`
  );

  const perAction: PerAction[] = [];
  let closedCount = 0;
  let freedBedCount = 0;
  let keptBedCollisionCount = 0;

  for (const [patientId, rows] of duplicates) {
    // rows is already sorted DESC by (admittedAt, createdAt) — index 0 is the
    // keeper, everything after is a duplicate.
    const [keeper, ...others] = rows;
    console.error(
      `[dedup-admissions:${MODE}] patient=${patientId} keeping=${keeper.id} ` +
        `(bed=${keeper.bedId} admittedAt=${keeper.admittedAt.toISOString()}) ` +
        `closing=${others.length}`
    );

    for (const dup of others) {
      // Only free the bed if no OTHER admission still claims it. In the
      // observed duplicate case the two admissions sit on different beds so
      // this is usually safe, but guard anyway.
      const bedStillClaimedByKeeper = keeper.bedId === dup.bedId;
      let freedBed = false;

      console.error(
        `[dedup-admissions:${MODE}]   closing=${dup.id} bed=${dup.bedId} ` +
          `admittedAt=${dup.admittedAt.toISOString()}` +
          (bedStillClaimedByKeeper
            ? " (bed shared with keeper — will NOT free)"
            : "")
      );

      if (MODE === "APPLY") {
        await prisma.$transaction(async (tx) => {
          const existingNotes = dup.dischargeNotes || "";
          const newNotes = existingNotes
            ? `${CLOSE_NOTE} ${existingNotes}`
            : CLOSE_NOTE;
          await tx.admission.update({
            where: { id: dup.id },
            data: {
              status: "DISCHARGED",
              dischargedAt: new Date(),
              conditionAtDischarge: "UNCHANGED",
              dischargeNotes: newNotes,
            },
          });
          if (!bedStillClaimedByKeeper) {
            // Only flip the bed back to AVAILABLE if it's currently
            // OCCUPIED and no OTHER ADMITTED row references it.
            const stillClaimed = await tx.admission.findFirst({
              where: {
                bedId: dup.bedId,
                status: "ADMITTED",
                id: { not: dup.id },
              },
              select: { id: true },
            });
            if (!stillClaimed) {
              await tx.bed.update({
                where: { id: dup.bedId },
                data: { status: "AVAILABLE" },
              });
              freedBed = true;
            }
          }
        });
        closedCount++;
        if (freedBed) freedBedCount++;
      } else {
        // Dry-run — predict the bed-free decision without touching DB.
        if (!bedStillClaimedByKeeper) {
          const stillClaimed = await prisma.admission.findFirst({
            where: {
              bedId: dup.bedId,
              status: "ADMITTED",
              id: { not: dup.id },
            },
            select: { id: true },
          });
          freedBed = !stillClaimed;
          if (!freedBed) keptBedCollisionCount++;
        }
      }

      perAction.push({
        patientId,
        keptAdmissionId: keeper.id,
        keptBedId: keeper.bedId,
        closedAdmissionId: dup.id,
        closedBedId: dup.bedId,
        admittedAt: dup.admittedAt.toISOString(),
        freedBed,
        applied: MODE === "APPLY",
      });
    }
  }

  // Post-run invariant check: after APPLY this should be 0.
  const remainingCheck = await prisma.admission.groupBy({
    by: ["patientId"],
    where: { status: "ADMITTED" },
    _count: { _all: true },
    having: { patientId: { _count: { gt: 1 } } },
  });
  const duplicatesRemaining = remainingCheck.length;

  const finishedAt = new Date();
  const summary = {
    mode: MODE,
    patientsWithDuplicates: duplicates.length,
    wouldClose: perAction.length,
    closed: closedCount,
    freedBeds: freedBedCount,
    keptBedCollisions: keptBedCollisionCount,
    duplicatesRemaining,
    actions: perAction,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };

  console.error(
    `[dedup-admissions] done mode=${MODE} ` +
      `patientsWithDuplicates=${duplicates.length} ` +
      `wouldClose=${perAction.length} closed=${closedCount} ` +
      `freedBeds=${freedBedCount} duplicatesRemaining=${duplicatesRemaining}`
  );
  console.log(JSON.stringify(summary));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[dedup-admissions] FATAL:", err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
