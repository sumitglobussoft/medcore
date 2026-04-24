#!/usr/bin/env tsx
/**
 * fix-stale-immunizations
 * ─────────────────────────────────────────────────────────────────────────────
 * Remediate Issue #46 ("Saanvi Joshi DPT 3375 days overdue") on prod/demo data.
 *
 * Scope:
 *   Walks every PENDING Immunization row whose `nextDueDate` is more than
 *   365 days in the past. A row is "PENDING" when `administeredBy` is either
 *   null, empty, or the sentinel "Not given" — i.e. the record represents an
 *   upcoming/overdue dose rather than a completed one.
 *
 *   For each candidate:
 *     - ADULT patient (DOB > 18y ago) + known pediatric vaccine → MISSED
 *         (null out nextDueDate, prepend "MISSED —" to notes). Too late to
 *         administer; record stays for audit, but the overdue dashboard no
 *         longer shows years-old entries.
 *     - CHILD patient OR adult-appropriate vaccine → RECOMPUTE
 *         nextDueDate based on DOB + UIP age offset when that lands within a
 *         sensible window, else clamp to 7-60 days overdue so the dashboard
 *         shows a realistic demo value.
 *
 * What this does NOT do:
 *   - Does NOT touch rows that are already up-to-date (nextDueDate within
 *     the last 365 days or in the future).
 *   - Does NOT touch completed doses (administeredBy = a user id).
 *
 * Design notes
 * ─────────────
 * - Dry-run by default (same pattern as scripts/backfill-patient-ages.ts).
 *   Pass `--apply` to write.
 * - Uses raw `prisma` (NOT tenantScopedPrisma) so the script sees every
 *   tenant. Data-correction sweeps are cross-tenant.
 * - Decision logic lives in `packages/db/src/lib/immunization-schedule.ts`
 *   as a PURE function so it can be unit-tested without a database.
 *
 * Usage
 * ─────
 *   # dry-run (DEFAULT — safe, zero writes):
 *   npx tsx scripts/fix-stale-immunizations.ts
 *
 *   # apply:
 *   npx tsx scripts/fix-stale-immunizations.ts --apply
 *
 *   # limit scope for a quick smoke test:
 *   npx tsx scripts/fix-stale-immunizations.ts --limit 10
 */

import { config as loadEnv } from "dotenv";
import path from "path";
import { prisma, recomputeImmunizationDue } from "@medcore/db";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), "apps/api/.env") });

if (!process.env.DATABASE_URL) {
  console.error(
    "[fix-stale-immunizations] FATAL: DATABASE_URL is not set. Aborting before any DB work."
  );
  process.exit(2);
}

// ── CLI parsing ─────────────────────────────────────────────────────────────

interface CliArgs {
  apply: boolean;
  limit: number | null;
}

function parseArgs(argv: string[]): CliArgs {
  let apply = false;
  let limit: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--limit") {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) limit = Math.floor(n);
    } else if (arg === "--help" || arg === "-h") {
      console.error(
        "Usage: tsx scripts/fix-stale-immunizations.ts [--apply] [--limit N]\n" +
          "\n" +
          "Recomputes or marks MISSED every PENDING immunization row whose\n" +
          "nextDueDate is more than 365d in the past. Dry-run by default."
      );
      process.exit(0);
    }
  }
  return { apply, limit };
}

const args = parseArgs(process.argv.slice(2));
const MODE: "DRY_RUN" | "APPLY" = args.apply ? "APPLY" : "DRY_RUN";

// ── Driver ──────────────────────────────────────────────────────────────────

interface PerRow {
  id: string;
  patientId: string;
  patientAge: string;
  vaccine: string;
  doseNumber: number | null;
  previousDueDate: string;
  action: "RECOMPUTE" | "MISSED" | "SKIP";
  newDueDate?: string;
  reason: string;
  updated: boolean;
}

async function main() {
  const startedAt = new Date();
  console.error(
    `[fix-stale-immunizations] mode=${MODE} startedAt=${startedAt.toISOString()}`
  );

  const oneYearAgo = new Date(startedAt.getTime() - 365 * 86_400_000);

  // PENDING = administeredBy is null, empty, or "Not given" / "Scheduled".
  // We match permissively because the seed uses a few sentinels.
  const candidates = await prisma.immunization.findMany({
    where: {
      nextDueDate: { not: null, lt: oneYearAgo },
      OR: [
        { administeredBy: null },
        { administeredBy: "" },
        { administeredBy: "Not given" },
        { administeredBy: "Scheduled" },
      ],
    },
    select: {
      id: true,
      patientId: true,
      vaccine: true,
      doseNumber: true,
      nextDueDate: true,
      notes: true,
      patient: {
        select: {
          dateOfBirth: true,
        },
      },
    },
    orderBy: [{ nextDueDate: "asc" }],
    take: args.limit ?? undefined,
  });

  console.error(
    `[fix-stale-immunizations] candidates (PENDING AND nextDueDate < ${
      oneYearAgo.toISOString().slice(0, 10)
    }): ${candidates.length}`
  );

  const perRow: PerRow[] = [];
  let recomputedCount = 0;
  let missedCount = 0;
  let skippedCount = 0;
  let updatedCount = 0;

  for (const row of candidates) {
    const dob = row.patient?.dateOfBirth ?? null;
    const ageLabel = dob
      ? `${Math.floor(
          (startedAt.getTime() - dob.getTime()) / (365 * 86_400_000)
        )}y`
      : "unknown";

    const decision = recomputeImmunizationDue({
      vaccine: row.vaccine,
      doseNumber: row.doseNumber,
      currentDueDate: row.nextDueDate as Date,
      patientDateOfBirth: dob,
      now: startedAt,
    });

    const base: PerRow = {
      id: row.id,
      patientId: row.patientId,
      patientAge: ageLabel,
      vaccine: row.vaccine,
      doseNumber: row.doseNumber ?? null,
      previousDueDate: (row.nextDueDate as Date).toISOString().slice(0, 10),
      action: decision.action,
      reason: decision.reason,
      updated: false,
    };

    if (decision.action === "SKIP") {
      skippedCount++;
      perRow.push(base);
      console.error(
        `[fix-stale:${MODE}] SKIP ${row.id} age=${ageLabel} ${row.vaccine} — ${decision.reason}`
      );
      continue;
    }

    if (decision.action === "RECOMPUTE") {
      recomputedCount++;
      base.newDueDate = decision.newDueDate.toISOString().slice(0, 10);
      if (MODE === "APPLY") {
        await prisma.immunization.update({
          where: { id: row.id },
          data: {
            nextDueDate: decision.newDueDate,
            notes: buildNote(
              row.notes,
              `recomputed ${base.previousDueDate} → ${base.newDueDate}: ${decision.reason}`
            ),
          },
        });
        base.updated = true;
        updatedCount++;
      }
      perRow.push(base);
      console.error(
        `[fix-stale:${MODE}] RECOMPUTE ${row.id} age=${ageLabel} ${row.vaccine} ${base.previousDueDate} → ${base.newDueDate} (${decision.reason})`
      );
      continue;
    }

    // MISSED
    missedCount++;
    if (MODE === "APPLY") {
      await prisma.immunization.update({
        where: { id: row.id },
        data: {
          nextDueDate: null,
          notes: buildNote(
            row.notes,
            `MISSED — ${decision.reason} (was due ${base.previousDueDate})`
          ),
        },
      });
      base.updated = true;
      updatedCount++;
    }
    perRow.push(base);
    console.error(
      `[fix-stale:${MODE}] MISSED ${row.id} age=${ageLabel} ${row.vaccine} was=${base.previousDueDate} (${decision.reason})`
    );
  }

  const finishedAt = new Date();
  const summary = {
    mode: MODE,
    candidates: candidates.length,
    recomputed: recomputedCount,
    missed: missedCount,
    skipped: skippedCount,
    updated: updatedCount,
    perRow,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };

  console.error(
    `[fix-stale-immunizations] done mode=${MODE} candidates=${candidates.length} ` +
      `recomputed=${recomputedCount} missed=${missedCount} skipped=${skippedCount} updated=${updatedCount}`
  );
  console.log(JSON.stringify(summary));

  await prisma.$disconnect();
}

/**
 * Compose a new `notes` value: keep the original content (if any), append
 * a timestamped audit line describing this script's action. Never overwrite
 * — ops needs the history.
 */
function buildNote(previous: string | null, addition: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const line = `[${stamp}] fix-stale-immunizations: ${addition}`;
  return previous && previous.trim().length > 0
    ? `${previous}\n${line}`
    : line;
}

main().catch(async (err) => {
  console.error("[fix-stale-immunizations] FATAL:", err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
