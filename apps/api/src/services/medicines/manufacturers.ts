/**
 * Curated list of realistic Indian pharma manufacturers used for:
 *   - Seed fallback when a medicine row has no manufacturer set
 *   - Round-robin backfill of production rows with NULL / empty manufacturer
 *
 * The list is intentionally diverse (generics, formulations, specialty) so a
 * round-robin assignment over ~50 medicines spreads realistically instead of
 * every row showing "Cipla".
 */

export const INDIAN_MANUFACTURERS: readonly string[] = [
  "Cipla",
  "Sun Pharma",
  "Dr. Reddy's",
  "Alembic",
  "Torrent",
  "Glenmark",
  "USV",
  "Lupin",
  "Zydus",
  "GSK",
  "Mankind",
  "Abbott India",
  "Intas",
  "Alkem",
  "Emcure",
  "Aurobindo",
  "Ipca",
  "Biocon",
  "Micro Labs",
  "Macleods",
];

/**
 * Pick a manufacturer deterministically from the list using the row's
 * sort-stable identity (name or id). Deterministic = the same medicine name
 * always maps to the same manufacturer across runs, which is important for
 * dry-run / apply symmetry.
 */
export function pickManufacturerFor(key: string): string {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % INDIAN_MANUFACTURERS.length;
  return INDIAN_MANUFACTURERS[idx];
}

/**
 * Cardiovascular / diabetes / antibiotic drugs often have canonical Indian
 * manufacturer associations. When a specific mapping is known, prefer it over
 * the round-robin hash — the dry-run output is less surprising to reviewers.
 */
const CANONICAL_MAP: Record<string, string> = {
  amlodipine: "Cipla",
  atorvastatin: "Sun Pharma",
  rosuvastatin: "Dr. Reddy's",
  metformin: "USV",
  glimepiride: "Sanofi India",
  insulin: "Biocon",
  losartan: "Torrent",
  telmisartan: "Glenmark",
  enalapril: "Cipla",
  ramipril: "Sun Pharma",
  atenolol: "Alembic",
  metoprolol: "Zydus",
  clopidogrel: "Lupin",
  warfarin: "Cipla",
  amoxicillin: "Cipla",
  azithromycin: "Alembic",
  ciprofloxacin: "Dr. Reddy's",
  doxycycline: "Zydus",
  metronidazole: "Alkem",
  levothyroxine: "Abbott India",
  pantoprazole: "Sun Pharma",
  omeprazole: "Dr. Reddy's",
  cetirizine: "GSK",
  paracetamol: "GSK",
  ibuprofen: "Cipla",
  aspirin: "USV",
};

export function canonicalManufacturerFor(
  input: string | { name?: string | null; genericName?: string | null }
): string | null {
  const haystack = (
    typeof input === "string"
      ? input
      : `${input.name ?? ""} ${input.genericName ?? ""}`
  ).toLowerCase();
  for (const [key, mfg] of Object.entries(CANONICAL_MAP)) {
    if (haystack.includes(key)) return mfg;
  }
  return null;
}

/**
 * Resolve the best manufacturer for a medicine: canonical mapping first,
 * round-robin hash as fallback.
 */
export function resolveManufacturer(
  input: string | { name?: string | null; genericName?: string | null },
  hashKey?: string
): string {
  return (
    canonicalManufacturerFor(input) ??
    pickManufacturerFor(
      hashKey ?? (typeof input === "string" ? input : input.name ?? "")
    )
  );
}
