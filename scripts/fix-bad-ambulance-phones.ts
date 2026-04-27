#!/usr/bin/env tsx
/**
 * fix-bad-ambulance-phones
 * ─────────────────────────────────────────────────────────────────────────────
 * Remediate Issue #146 (Apr 2026) — AmbulanceTrip rows with bogus
 * `callerPhone` values like "abc123xyz" stored before the Issue #87 phone-
 * validation guard landed on POST /api/v1/ambulance/trips.
 *
 * Strategy
 *   - Read every `AmbulanceTrip` whose `callerPhone IS NOT NULL`.
 *   - Reject with the same regex the API now enforces:
 *         /^\+?\d{10,15}$/
 *   - Replace non-matching values with NULL (we do NOT delete the row;
 *     dispatch / billing history matters even if the caller phone is now
 *     unrecoverable).
 *   - Idempotent: a re-run is a no-op once every row matches.
 *   - Dry-run by default. Pass `--apply` to write.
 *
 * Why a script (and not a Prisma migration)?
 *   The schema can't be edited (CLAUDE.md scoping). The data fix is one-shot
 *   and small; cron-style remediation in product code would clutter the
 *   ambulance route.
 *
 * Usage
 *   # dry-run (DEFAULT — safe, zero writes):
 *   npx tsx scripts/fix-bad-ambulance-phones.ts
 *
 *   # apply:
 *   npx tsx scripts/fix-bad-ambulance-phones.ts --apply
 */

import { config as loadEnv } from "dotenv";
import path from "path";
import { prisma } from "@medcore/db";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), "apps/api/.env") });

if (!process.env.DATABASE_URL) {
  console.error(
    "[fix-ambulance-phones] FATAL: DATABASE_URL is not set. Aborting before any DB work."
  );
  process.exit(2);
}

// Same regex the API enforces in createAmbulanceTripSchema after #87.
const PHONE_REGEX = /^\+?\d{10,15}$/;

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
        "Usage: tsx scripts/fix-bad-ambulance-phones.ts [--apply]\n" +
          "\n" +
          "Replaces non-conforming `callerPhone` values on `AmbulanceTrip` rows\n" +
          "with NULL. The regex matches the API's createAmbulanceTripSchema:\n" +
          "  /^\\+?\\d{10,15}$/\n" +
          "Dry-run by default."
      );
      process.exit(0);
    }
  }
  return { apply };
}

const args = parseArgs(process.argv.slice(2));
const MODE: "DRY_RUN" | "APPLY" = args.apply ? "APPLY" : "DRY_RUN";

interface PerRow {
  id: string;
  tripNumber: string;
  before: string | null;
  after: string | null;
  updated: boolean;
}

async function main() {
  const startedAt = new Date();
  console.error(
    `[fix-ambulance-phones] mode=${MODE} startedAt=${startedAt.toISOString()}`
  );

  // We deliberately fetch ONLY rows with a non-null callerPhone — that's
  // the universe of "potentially bad" rows. Prisma can't filter by regex
  // mismatch in the where clause portably, so we filter in-memory.
  const candidates = await prisma.ambulanceTrip.findMany({
    where: { callerPhone: { not: null } },
    select: { id: true, tripNumber: true, callerPhone: true },
    orderBy: { requestedAt: "asc" },
  });

  const bad = candidates.filter(
    (t) => typeof t.callerPhone === "string" && !PHONE_REGEX.test(t.callerPhone)
  );

  console.error(
    `[fix-ambulance-phones] candidates=${candidates.length} bad=${bad.length}`
  );

  const perRow: PerRow[] = [];
  let updatedCount = 0;

  for (const t of bad) {
    if (MODE === "APPLY") {
      await prisma.ambulanceTrip.update({
        where: { id: t.id },
        data: { callerPhone: null },
      });
      updatedCount++;
    }

    perRow.push({
      id: t.id,
      tripNumber: t.tripNumber,
      before: t.callerPhone ?? null,
      after: null,
      updated: MODE === "APPLY",
    });

    console.error(
      `[fix-ambulance-phones:${MODE}] ${t.tripNumber} (id=${t.id}) ` +
        `'${t.callerPhone}' → NULL${MODE === "APPLY" ? " UPDATED" : ""}`
    );
  }

  const finishedAt = new Date();
  const summary = {
    mode: MODE,
    candidates: candidates.length,
    badCount: bad.length,
    wouldUpdate: bad.length,
    updated: updatedCount,
    perRow,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };

  console.error(
    `[fix-ambulance-phones] done mode=${MODE} candidates=${candidates.length} ` +
      `bad=${bad.length} updated=${updatedCount}`
  );
  console.log(JSON.stringify(summary));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[fix-ambulance-phones] FATAL:", err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
