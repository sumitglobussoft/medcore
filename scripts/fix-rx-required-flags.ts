#!/usr/bin/env tsx
/**
 * fix-rx-required-flags
 * ─────────────────────────────────────────────────────────────────────────────
 * Remediate Issue #40 (Amlodipine 5mg and other prescription-only drugs flagged
 * `Rx Required: No`) on production data.
 *
 * Scope:
 *   Walks every Medicine row where `prescriptionRequired = false` AND the
 *   name / genericName matches the curated Schedule-H substring list at
 *   apps/api/src/services/medicines/rx-required-list.ts. Flips the flag to
 *   `true` so the UI (which now reads `rxRequired` via the API alias layer)
 *   renders "Rx Required: Yes".
 *
 * What this does NOT do:
 *   - Does NOT flip rows that are ALREADY `prescriptionRequired = true`
 *     (nothing to do).
 *   - Does NOT downgrade any row from RX to OTC (this script is additive; a
 *     separate audit is required if a genuinely-OTC drug is mis-flagged).
 *
 * Design notes
 * ─────────────
 * - Dry-run by default (same pattern as scripts/backfill-patient-ages.ts).
 *   Pass `--apply` to write.
 * - Uses raw `prisma` (NOT tenantScopedPrisma) so the script sees every tenant.
 *   Rx classification is a regulatory invariant, not tenant data.
 * - The curated list is defined in one place (rx-required-list.ts) and reused
 *   by unit tests and the create-medicine form.
 *
 * Usage
 * ─────
 *   # dry-run (DEFAULT — safe, zero writes):
 *   npx tsx scripts/fix-rx-required-flags.ts
 *
 *   # apply:
 *   npx tsx scripts/fix-rx-required-flags.ts --apply
 */

import { config as loadEnv } from "dotenv";
import path from "path";
import { prisma } from "@medcore/db";
import {
  isRxRequired,
  matchingRxSubstrings,
} from "../apps/api/src/services/medicines/rx-required-list";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), "apps/api/.env") });

if (!process.env.DATABASE_URL) {
  console.error(
    "[fix-rx] FATAL: DATABASE_URL is not set. Aborting before any DB work."
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
        "Usage: tsx scripts/fix-rx-required-flags.ts [--apply]\n" +
          "\n" +
          "Sets prescriptionRequired=true for Medicine rows whose name/genericName\n" +
          "matches the Schedule-H curated list AND currently have the flag false.\n" +
          "Dry-run by default."
      );
      process.exit(0);
    }
  }
  return { apply };
}

const args = parseArgs(process.argv.slice(2));
const MODE: "DRY_RUN" | "APPLY" = args.apply ? "APPLY" : "DRY_RUN";

// ── Driver ──────────────────────────────────────────────────────────────────

interface PerRow {
  id: string;
  name: string;
  genericName: string | null;
  matchedSubstrings: string[];
  before: boolean;
  after: boolean;
  updated: boolean;
}

async function main() {
  const startedAt = new Date();
  console.error(`[fix-rx] mode=${MODE} startedAt=${startedAt.toISOString()}`);

  // Select only rows that actually need remediation: prescriptionRequired=false.
  // We then filter in-memory against the curated list (substring match doesn't
  // map to a single WHERE clause).
  const candidates = await prisma.medicine.findMany({
    where: { prescriptionRequired: false },
    select: { id: true, name: true, genericName: true },
    orderBy: { name: "asc" },
  });

  console.error(
    `[fix-rx] candidates (prescriptionRequired=false): ${candidates.length}`
  );

  const perRow: PerRow[] = [];
  let updatedCount = 0;
  let matchedCount = 0;

  for (const m of candidates) {
    const matched = matchingRxSubstrings({
      name: m.name,
      genericName: m.genericName,
    });
    const shouldFlip = matched.length > 0;

    if (!shouldFlip) {
      // Genuinely OTC — leave it alone.
      continue;
    }

    matchedCount++;

    if (MODE === "APPLY") {
      await prisma.medicine.update({
        where: { id: m.id },
        data: { prescriptionRequired: true },
      });
      updatedCount++;
    }

    perRow.push({
      id: m.id,
      name: m.name,
      genericName: m.genericName ?? null,
      matchedSubstrings: matched,
      before: false,
      after: true,
      updated: MODE === "APPLY",
    });

    console.error(
      `[fix-rx:${MODE}] ${m.name} (generic=${m.genericName ?? "—"}) ` +
        `matched=[${matched.join(", ")}] false → true${
          MODE === "APPLY" ? " UPDATED" : ""
        }`
    );
  }

  // Invariant check: make sure we didn't miss anything that clearly needs it.
  const untouchedButShouldHave = candidates.filter(
    (m) =>
      !perRow.find((r) => r.id === m.id) &&
      isRxRequired({ name: m.name, genericName: m.genericName })
  );

  const finishedAt = new Date();
  const summary = {
    mode: MODE,
    candidates: candidates.length,
    matched: matchedCount,
    wouldUpdate: matchedCount,
    updated: updatedCount,
    otcKept: candidates.length - matchedCount,
    // Should always be 0 — kept as a safety telemetry field.
    invariantMisses: untouchedButShouldHave.length,
    perRow,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };

  console.error(
    `[fix-rx] done mode=${MODE} candidates=${candidates.length} ` +
      `matched=${matchedCount} updated=${updatedCount} ` +
      `otcKept=${candidates.length - matchedCount}`
  );
  console.log(JSON.stringify(summary));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[fix-rx] FATAL:", err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
