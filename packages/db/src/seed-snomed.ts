/**
 * PRD §3.5.4 / §3.7.1 — SNOMED-CT curated subset seed.
 *
 * Idempotently loads `seed-data/snomed-subset.json` into the
 * `SnomedConcept` table. Safe to run repeatedly:
 *   - If a row with the same conceptId already exists, it is updated
 *     with the latest term / synonyms / specialtyTags / redFlagTerms.
 *   - New rows are inserted.
 *   - Rows never deleted by this script — if a concept is retired we
 *     manage that via a follow-up data-correction script.
 *
 * Run as post-deploy step:
 *   npm run -w @medcore/db db:seed-snomed
 *
 * Until the `SnomedConcept` Prisma model lands (see
 * `apps/api/src/services/.prisma-models-snomed.md`), the corresponding
 * service (`apps/api/src/services/ai/snomed-mapping.ts`) reads the JSON
 * file directly as a fallback, so the feature works before and after
 * the migration.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Resolve path to the JSON seed file that lives alongside this script
// at packages/db/seed-data/snomed-subset.json. Works both when run via
// tsx from source and when compiled, because we walk up from __dirname.
function resolveSeedPath(): string {
  // In CommonJS tsx run __dirname exists. In the off-chance this runs
  // as ESM, fall back to the fileURLToPath trick.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyGlobal = globalThis as any;
  const here: string =
    typeof __dirname !== "undefined"
      ? __dirname
      : dirname(fileURLToPath(anyGlobal?.["import.meta"]?.url ?? ""));
  // packages/db/src/ → packages/db/seed-data/
  const candidate = join(here, "..", "seed-data", "snomed-subset.json");
  if (existsSync(candidate)) return candidate;
  // fallback — working-directory relative (e.g. when run from repo root)
  const alt = join(process.cwd(), "packages", "db", "seed-data", "snomed-subset.json");
  if (existsSync(alt)) return alt;
  throw new Error(`snomed-subset.json not found (tried ${candidate} and ${alt})`);
}

interface SnomedConceptSeed {
  conceptId: string;
  term: string;
  synonyms: string[];
  specialtyTags: string[];
  redFlagTerms: string[];
  category: string;
}

interface SnomedSeedFile {
  _meta?: Record<string, unknown>;
  concepts: SnomedConceptSeed[];
}

async function main(): Promise<void> {
  const seedPath = resolveSeedPath();
  const raw = readFileSync(seedPath, "utf8");
  const parsed = JSON.parse(raw) as SnomedSeedFile;
  if (!Array.isArray(parsed.concepts)) {
    throw new Error("snomed-subset.json: `concepts` array missing");
  }

  // Duplicate check up front — the service relies on conceptId being unique.
  const ids = new Set<string>();
  for (const c of parsed.concepts) {
    if (ids.has(c.conceptId)) {
      throw new Error(`Duplicate conceptId in seed file: ${c.conceptId}`);
    }
    ids.add(c.conceptId);
  }

  // If the SnomedConcept model has not yet been migrated in, the Prisma
  // client won't have the delegate. Detect that and exit cleanly with a
  // helpful message instead of crashing — the service will still work
  // against the JSON fallback until the migration lands.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const client = prisma as any;
  if (!client.snomedConcept || typeof client.snomedConcept.upsert !== "function") {
    console.warn(
      "[seed-snomed] SnomedConcept Prisma model not yet available — skipping DB upsert. " +
        "The snomed-mapping service will use the JSON fallback until the migration lands."
    );
    console.warn(`[seed-snomed] JSON file validated: ${parsed.concepts.length} concepts, no duplicates.`);
    return;
  }

  let created = 0;
  let updated = 0;

  for (const c of parsed.concepts) {
    const data = {
      term: c.term,
      synonyms: c.synonyms,
      specialtyTags: c.specialtyTags,
      redFlagTerms: c.redFlagTerms,
      category: c.category,
    };
    // upsert keyed on the conceptId (stored as the PK `id`).
    const existing = await client.snomedConcept.findUnique({ where: { id: c.conceptId } });
    await client.snomedConcept.upsert({
      where: { id: c.conceptId },
      create: { id: c.conceptId, ...data },
      update: data,
    });
    if (existing) updated++;
    else created++;
  }

  console.log(
    `[seed-snomed] done — created=${created} updated=${updated} total=${parsed.concepts.length}`
  );
}

main()
  .catch((err) => {
    console.error("[seed-snomed] failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
