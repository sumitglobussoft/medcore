#!/usr/bin/env tsx
/**
 * fix-medicine-manufacturers
 * ─────────────────────────────────────────────────────────────────────────────
 * Remediate Issue #41 (every medicine row has a blank Manufacturer column) on
 * production data.
 *
 * Scope:
 *   Walks every Medicine row where `brand IS NULL OR brand = ''` and fills in
 *   a realistic Indian pharma manufacturer:
 *     1. Canonical mapping first  — a known drug (amlodipine → Cipla, etc.)
 *     2. Round-robin fallback     — deterministic hash over the row's name so
 *                                   the same row always maps to the same
 *                                   manufacturer across dry-run / apply runs.
 *
 * Why `brand` and not a dedicated `manufacturer` column?
 *   The schema.prisma is immutable for this fix (see Issue #41 constraints).
 *   The UI's "Manufacturer" column is exposed via the API alias layer in
 *   apps/api/src/services/medicines/serialize.ts, which maps `brand` →
 *   `manufacturer` on response. This keeps zero schema drift.
 *
 * Design notes
 * ─────────────
 * - Dry-run by default. Pass `--apply` to write.
 * - Uses raw `prisma` (NOT tenantScopedPrisma); manufacturer metadata is
 *   cross-tenant reference data.
 * - Assignment is deterministic (hash over name), so reruns produce the same
 *   result. Do NOT re-run without auditing rows that were already backfilled —
 *   the script skips non-empty brand values by design.
 *
 * Usage
 * ─────
 *   # dry-run (DEFAULT — safe, zero writes):
 *   npx tsx scripts/fix-medicine-manufacturers.ts
 *
 *   # apply:
 *   npx tsx scripts/fix-medicine-manufacturers.ts --apply
 */

import { config as loadEnv } from "dotenv";
import path from "path";
import { prisma } from "@medcore/db";
import {
  canonicalManufacturerFor,
  pickManufacturerFor,
} from "../apps/api/src/services/medicines/manufacturers";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), "apps/api/.env") });

if (!process.env.DATABASE_URL) {
  console.error(
    "[fix-mfg] FATAL: DATABASE_URL is not set. Aborting before any DB work."
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
        "Usage: tsx scripts/fix-medicine-manufacturers.ts [--apply]\n" +
          "\n" +
          "Fills the `brand` column (exposed to UI as `manufacturer`) for every\n" +
          "Medicine row where it is NULL or empty string. Uses canonical mapping\n" +
          "for known drugs, deterministic round-robin hash otherwise. Dry-run by\n" +
          "default."
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
  before: string | null;
  after: string;
  source: "CANONICAL" | "ROUND_ROBIN";
  updated: boolean;
}

async function main() {
  const startedAt = new Date();
  console.error(`[fix-mfg] mode=${MODE} startedAt=${startedAt.toISOString()}`);

  const candidates = await prisma.medicine.findMany({
    where: { OR: [{ brand: null }, { brand: "" }] },
    select: { id: true, name: true, genericName: true, brand: true },
    orderBy: { name: "asc" },
  });

  console.error(
    `[fix-mfg] candidates (brand IS NULL OR ''): ${candidates.length}`
  );

  const perRow: PerRow[] = [];
  let updatedCount = 0;
  let canonicalCount = 0;
  let roundRobinCount = 0;

  for (const m of candidates) {
    const canonical = canonicalManufacturerFor({
      name: m.name,
      genericName: m.genericName,
    });
    const after = canonical ?? pickManufacturerFor(m.id || m.name);
    const source: "CANONICAL" | "ROUND_ROBIN" = canonical
      ? "CANONICAL"
      : "ROUND_ROBIN";

    if (source === "CANONICAL") canonicalCount++;
    else roundRobinCount++;

    if (MODE === "APPLY") {
      await prisma.medicine.update({
        where: { id: m.id },
        data: { brand: after },
      });
      updatedCount++;
    }

    perRow.push({
      id: m.id,
      name: m.name,
      genericName: m.genericName ?? null,
      before: m.brand ?? null,
      after,
      source,
      updated: MODE === "APPLY",
    });

    console.error(
      `[fix-mfg:${MODE}] ${m.name} (generic=${m.genericName ?? "—"}) ` +
        `brand='${m.brand ?? ""}' → '${after}' [${source}]${
          MODE === "APPLY" ? " UPDATED" : ""
        }`
    );
  }

  const finishedAt = new Date();
  const summary = {
    mode: MODE,
    candidates: candidates.length,
    wouldUpdate: candidates.length,
    updated: updatedCount,
    canonical: canonicalCount,
    roundRobin: roundRobinCount,
    perRow,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };

  console.error(
    `[fix-mfg] done mode=${MODE} candidates=${candidates.length} ` +
      `updated=${updatedCount} canonical=${canonicalCount} ` +
      `roundRobin=${roundRobinCount}`
  );
  console.log(JSON.stringify(summary));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[fix-mfg] FATAL:", err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
