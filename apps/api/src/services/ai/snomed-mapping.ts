/**
 * PRD §3.5.4 / §3.7.1 — SNOMED-CT-backed specialty mapping.
 *
 * Deterministic symptom → specialty anchor that complements the LLM
 * reasoning step in the triage flow. The LLM suggests specialties based
 * on conversational context; this module independently looks up each
 * captured symptom against a curated SNOMED-CT subset and produces a
 * scored list of candidate specialties.
 *
 * Used by `extractSymptomSummary` (sarvam.ts) and by the router layer
 * to cross-check the LLM's suggestions. When the LLM and SNOMED agree,
 * we surface the match with high confidence; when they disagree, BOTH
 * sets are returned and the UI flags the disagreement so the reception
 * desk can apply human judgement.
 *
 * Data flow:
 *   1. Preferred: read rows from the `SnomedConcept` Prisma table.
 *   2. Fallback: read `packages/db/seed-data/snomed-subset.json`
 *      directly (used until the model migration lands and the seed has
 *      been run).
 *
 * The pure scoring function `scoreSymptomsAgainstConcepts` is exported
 * separately so unit tests can mock the concept list without touching
 * the DB or the filesystem.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@medcore/db";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SnomedConcept {
  conceptId: string;
  term: string;
  synonyms: string[];
  specialtyTags: string[];
  redFlagTerms: string[];
  category: string;
}

export interface SpecialtyMatch {
  specialty: string; // normalised SCREAMING_SNAKE (e.g. "CARDIOLOGY")
  score: number; // 0..N aggregate score
  snomedMatches: string[]; // list of conceptIds contributing to this specialty
}

export interface SnomedMappingResult {
  specialties: SpecialtyMatch[];
  redFlagTerms: string[]; // flattened, deduplicated red-flag terms surfaced
  matchedConceptIds: string[]; // every concept that matched at least one symptom
}

// ── Scoring weights ───────────────────────────────────────────────────────────

const WEIGHT_EXACT = 1.0;
const WEIGHT_SYNONYM = 0.9;
const WEIGHT_SUBSTRING = 0.6;

// ── Specialty normaliser ─────────────────────────────────────────────────────

/**
 * Normalise a free-text specialty string to SCREAMING_SNAKE_CASE so
 * SNOMED tags and LLM-emitted strings are trivially comparable.
 *   "General Physician"  → "GENERAL_PHYSICIAN"
 *   "ENT / Otolaryngology" → "ENT_OTOLARYNGOLOGY"
 *   "cardiology"         → "CARDIOLOGY"
 */
export function normaliseSpecialty(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ── Tokeniser ────────────────────────────────────────────────────────────────

/**
 * Very small tokeniser — splits on whitespace and common punctuation, drops
 * empties. Kept deliberately dumb: SNOMED matching is substring-based, so
 * we just want reasonable chunks to compare against `term` / `synonyms`.
 */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,;.()\/\\]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

// ── Concept loader (JSON fallback) ───────────────────────────────────────────

let cachedJsonConcepts: SnomedConcept[] | null = null;

function resolveSeedJsonPath(): string | null {
  // Walk common candidate locations — the service is imported from many
  // different cwd contexts (dev server, tests, scheduler workers).
  const candidates = [
    // When running the API under `npm run dev` from repo root:
    join(process.cwd(), "packages", "db", "seed-data", "snomed-subset.json"),
    // When running from apps/api (rare, but tsc --noEmit does this sometimes):
    join(process.cwd(), "..", "..", "packages", "db", "seed-data", "snomed-subset.json"),
    // When running from inside packages/db:
    join(process.cwd(), "..", "packages", "db", "seed-data", "snomed-subset.json"),
    // Walk up from the compiled module (apps/api/dist/services/ai → repo root):
    join(__dirname, "..", "..", "..", "..", "..", "packages", "db", "seed-data", "snomed-subset.json"),
    // Walk up from source module (apps/api/src/services/ai → repo root):
    join(__dirname, "..", "..", "..", "..", "packages", "db", "seed-data", "snomed-subset.json"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

export function loadSnomedFromJson(): SnomedConcept[] {
  if (cachedJsonConcepts) return cachedJsonConcepts;
  const path = resolveSeedJsonPath();
  if (!path) {
    cachedJsonConcepts = [];
    return cachedJsonConcepts;
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as { concepts?: SnomedConcept[] };
    cachedJsonConcepts = Array.isArray(parsed.concepts) ? parsed.concepts : [];
  } catch {
    cachedJsonConcepts = [];
  }
  return cachedJsonConcepts;
}

/** Test helper — resets the JSON cache between test runs. */
export function _resetSnomedCache(): void {
  cachedJsonConcepts = null;
}

// ── Concept loader (DB-first with JSON fallback) ─────────────────────────────

async function loadSnomedConcepts(): Promise<SnomedConcept[]> {
  // Prefer DB when the Prisma client has the delegate (post-migration).
  // Wrap in try/catch so a transient DB error still degrades gracefully
  // to the JSON fallback rather than breaking triage.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyPrisma = prisma as any;
  if (anyPrisma?.snomedConcept && typeof anyPrisma.snomedConcept.findMany === "function") {
    try {
      const rows: Array<{
        id: string;
        term: string;
        synonyms: unknown;
        specialtyTags: unknown;
        redFlagTerms: unknown;
        category: string;
      }> = await anyPrisma.snomedConcept.findMany();
      if (rows.length > 0) {
        return rows.map((r) => ({
          conceptId: r.id,
          term: r.term,
          synonyms: Array.isArray(r.synonyms) ? (r.synonyms as string[]) : [],
          specialtyTags: Array.isArray(r.specialtyTags) ? (r.specialtyTags as string[]) : [],
          redFlagTerms: Array.isArray(r.redFlagTerms) ? (r.redFlagTerms as string[]) : [],
          category: r.category,
        }));
      }
    } catch {
      // fall through to JSON
    }
  }
  return loadSnomedFromJson();
}

// ── Pure scoring core ────────────────────────────────────────────────────────

/**
 * Pure, deterministic scorer. Takes a concept list and a list of symptom
 * strings, returns matched specialties with aggregate scores.
 *
 * Algorithm (per PRD §3.5.4):
 *  a. Lowercase the symptom string.
 *  b. For each concept, check:
 *       - exact match on `term` (score += 1.0)
 *       - exact match on any `synonym` (score += 0.9)
 *       - substring match on term or synonyms (score += 0.6)
 *     At most one of these hits per (symptom, concept) pair — exact wins.
 *  c. For each match, accumulate the concept's specialtyTags into a
 *     score map keyed by normalised specialty name. Record the
 *     conceptId against every specialty it contributes to.
 *  d. Return specialties sorted by score DESC, with the contributing
 *     conceptIds listed for traceability.
 */
export function scoreSymptomsAgainstConcepts(
  symptoms: string[],
  concepts: SnomedConcept[]
): SnomedMappingResult {
  const scoreBySpecialty = new Map<string, number>();
  const conceptsBySpecialty = new Map<string, Set<string>>();
  const matchedConceptIds = new Set<string>();
  const redFlagTerms = new Set<string>();

  for (const rawSymptom of symptoms) {
    if (!rawSymptom) continue;
    const symptom = rawSymptom.toLowerCase().trim();
    if (!symptom) continue;
    const symptomTokens = new Set(tokenise(symptom));

    for (const concept of concepts) {
      const termLc = concept.term.toLowerCase();
      const synonymsLc = concept.synonyms.map((s) => s.toLowerCase());

      let weight = 0;
      if (symptom === termLc || symptomTokens.has(termLc)) {
        weight = WEIGHT_EXACT;
      } else if (synonymsLc.some((s) => s === symptom || symptomTokens.has(s))) {
        weight = WEIGHT_SYNONYM;
      } else if (
        symptom.includes(termLc) ||
        termLc.includes(symptom) ||
        synonymsLc.some((s) => symptom.includes(s) || s.includes(symptom))
      ) {
        // Guard against degenerate 1-char matches.
        if (termLc.length >= 3 || synonymsLc.some((s) => s.length >= 3)) {
          weight = WEIGHT_SUBSTRING;
        }
      }

      if (weight === 0) continue;

      matchedConceptIds.add(concept.conceptId);
      for (const r of concept.redFlagTerms) redFlagTerms.add(r);

      for (const tag of concept.specialtyTags) {
        const key = normaliseSpecialty(tag);
        scoreBySpecialty.set(key, (scoreBySpecialty.get(key) ?? 0) + weight);
        let set = conceptsBySpecialty.get(key);
        if (!set) {
          set = new Set<string>();
          conceptsBySpecialty.set(key, set);
        }
        set.add(concept.conceptId);
      }
    }
  }

  const specialties: SpecialtyMatch[] = [...scoreBySpecialty.entries()]
    .map(([specialty, score]) => ({
      specialty,
      score: Number(score.toFixed(3)),
      snomedMatches: [...(conceptsBySpecialty.get(specialty) ?? [])].sort(),
    }))
    .sort((a, b) => b.score - a.score || a.specialty.localeCompare(b.specialty));

  return {
    specialties,
    redFlagTerms: [...redFlagTerms].sort(),
    matchedConceptIds: [...matchedConceptIds].sort(),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * PRD §3.5.4 — map captured symptoms to candidate specialties using the
 * curated SNOMED-CT subset. The returned list is sorted by accumulated
 * score descending; each entry carries the conceptIds that contributed
 * so callers can show provenance in the UI.
 *
 * Resolution order:
 *   1. `SnomedConcept` Prisma table (when migrated + seeded).
 *   2. `packages/db/seed-data/snomed-subset.json` (always available).
 */
export async function mapSymptomsToSpecialties(
  symptoms: string[]
): Promise<SpecialtyMatch[]> {
  const concepts = await loadSnomedConcepts();
  return scoreSymptomsAgainstConcepts(symptoms, concepts).specialties;
}

/**
 * Same as `mapSymptomsToSpecialties` but returns the full result
 * including red-flag terms and matched conceptIds. Used by
 * `sarvam.extractSymptomSummary` to cross-check the LLM output, and by
 * `red-flag.ts` to layer SNOMED-sourced keywords on top of its regex list.
 */
export async function analyseSymptomsWithSnomed(
  symptoms: string[]
): Promise<SnomedMappingResult> {
  const concepts = await loadSnomedConcepts();
  return scoreSymptomsAgainstConcepts(symptoms, concepts);
}

/**
 * Synchronous variant that uses only the JSON fallback. Used by
 * red-flag.ts, which must remain synchronous for the existing call
 * sites (many are in hot tool-call paths).
 */
export function analyseSymptomsWithSnomedSync(
  symptoms: string[]
): SnomedMappingResult {
  const concepts = loadSnomedFromJson();
  return scoreSymptomsAgainstConcepts(symptoms, concepts);
}

/**
 * PRD §3.5.4 — combine the LLM's specialty suggestions with the SNOMED
 * deterministic mapping. Returns the intersection (high confidence) and
 * the union with disagreement flags so the UI can surface both sets.
 *
 * Inputs are free-text specialty strings (e.g. "Cardiology", "General
 * Physician"); they are normalised before comparison.
 */
export function reconcileSpecialties(
  llmSuggestions: string[],
  snomedMatches: SpecialtyMatch[]
): {
  agreed: string[];
  llmOnly: string[];
  snomedOnly: string[];
  disagreement: boolean;
} {
  const llmSet = new Set(llmSuggestions.filter((s) => s).map((s) => normaliseSpecialty(s)));
  const snomedSet = new Set(snomedMatches.map((m) => m.specialty));

  const agreed: string[] = [];
  const llmOnly: string[] = [];
  const snomedOnly: string[] = [];

  for (const s of llmSet) {
    if (snomedSet.has(s)) agreed.push(s);
    else llmOnly.push(s);
  }
  for (const s of snomedSet) {
    if (!llmSet.has(s)) snomedOnly.push(s);
  }

  return {
    agreed: agreed.sort(),
    llmOnly: llmOnly.sort(),
    snomedOnly: snomedOnly.sort(),
    // "disagreement" == the LLM picked something that SNOMED didn't, OR
    // SNOMED had matches that the LLM missed. The agreed list may still
    // be non-empty even when this is true.
    disagreement: llmOnly.length > 0 || snomedOnly.length > 0,
  };
}
