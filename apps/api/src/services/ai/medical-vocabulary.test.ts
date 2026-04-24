import { describe, it, expect } from "vitest";
import {
  DRUGS_GENERIC,
  DRUGS_BRAND_IN,
  ANATOMY,
  PROCEDURES,
  MEDICAL_WORD_BOOST_LIST,
  getBoostWeight,
} from "./medical-vocabulary";

// PRD §4.5.2 — these minimums match the counts cited in the PRD ("~100 generic
// drugs", "~80 Indian brands", "~60 anatomy", "~60 procedures"). Enforced as
// minimum thresholds so future pruning can't silently shrink the boost list
// below the PRD commitment without tripping CI.
const EXPECTED_MIN = {
  DRUGS_GENERIC: 100,
  DRUGS_BRAND_IN: 80,
  ANATOMY: 60,
  PROCEDURES: 60,
};

describe("medical-vocabulary", () => {
  it("each category meets its PRD minimum entry count", () => {
    expect(DRUGS_GENERIC.length).toBeGreaterThanOrEqual(EXPECTED_MIN.DRUGS_GENERIC);
    expect(DRUGS_BRAND_IN.length).toBeGreaterThanOrEqual(EXPECTED_MIN.DRUGS_BRAND_IN);
    expect(ANATOMY.length).toBeGreaterThanOrEqual(EXPECTED_MIN.ANATOMY);
    expect(PROCEDURES.length).toBeGreaterThanOrEqual(EXPECTED_MIN.PROCEDURES);
  });

  it("MEDICAL_WORD_BOOST_LIST has no case-insensitive duplicates", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const w of MEDICAL_WORD_BOOST_LIST) {
      const key = w.toLowerCase();
      if (seen.has(key)) dupes.push(w);
      seen.add(key);
    }
    expect(dupes).toEqual([]);
    // Combined length must at least equal the largest source category (catching
    // the bug where the combined list accidentally becomes one of the source
    // arrays — a regression we've seen before in similar merge helpers).
    const largest = Math.max(
      DRUGS_GENERIC.length,
      DRUGS_BRAND_IN.length,
      ANATOMY.length,
      PROCEDURES.length
    );
    expect(MEDICAL_WORD_BOOST_LIST.length).toBeGreaterThanOrEqual(largest);
  });

  it("getBoostWeight ranks common drugs higher than anatomical terms", () => {
    // HIGH_PRIORITY common drug → 10
    expect(getBoostWeight("Paracetamol")).toBe(10);
    expect(getBoostWeight("Amoxicillin")).toBe(10);
    // Non-priority drug → 7
    expect(getBoostWeight("Carvedilol")).toBe(7);
    // Anatomy term → 3
    expect(getBoostWeight("cerebellum")).toBe(3);
    // Procedure → 4
    expect(getBoostWeight("thoracentesis")).toBe(4);
    // Monotonicity: drug > procedure > anatomy
    expect(getBoostWeight("Paracetamol")).toBeGreaterThan(getBoostWeight("thyroid"));
    expect(getBoostWeight("Amoxicillin")).toBeGreaterThan(getBoostWeight("femur"));
    expect(getBoostWeight("Metformin")).toBeGreaterThan(getBoostWeight("colonoscopy"));
    expect(getBoostWeight("appendectomy")).toBeGreaterThan(getBoostWeight("vertebra"));
    // Case-insensitive lookup
    expect(getBoostWeight("PARACETAMOL")).toBe(10);
    // Unknown word → midpoint, so the function is safe on arbitrary input
    expect(getBoostWeight("flibbertigibbet")).toBe(5);
    // Empty/invalid input returns the midpoint rather than throwing
    expect(getBoostWeight("")).toBe(5);
  });

  it("combined list includes canonical sanity-check entries", () => {
    // PRD called out "Amoxicillin" explicitly as a canary.
    expect(MEDICAL_WORD_BOOST_LIST).toContain("Amoxicillin");
    // Sample one from each category so a future refactor that drops a whole
    // category (e.g. anatomy) fails loudly.
    expect(MEDICAL_WORD_BOOST_LIST).toContain("Metformin"); // generic drug
    expect(MEDICAL_WORD_BOOST_LIST).toContain("Crocin"); // Indian brand
    expect(MEDICAL_WORD_BOOST_LIST).toContain("thyroid"); // anatomy
    expect(MEDICAL_WORD_BOOST_LIST).toContain("colonoscopy"); // procedure
  });
});
