import { describe, it, expect } from "vitest";
import {
  isAboCompatible,
  aboMismatchReason,
  RBC_COMPATIBILITY,
  PLASMA_COMPATIBILITY,
  ALL_BLOOD_GROUPS,
  prettyBloodGroup,
} from "../../abo-compatibility";

// Issue #93 (2026-04-26) — exhaustive coverage of the ABO matrix used by
// the blood-bank issue-unit screen. If any of these expectations break,
// the API gate AND the UI warning banner are both wrong (they share the
// same source of truth).

describe("isAboCompatible (RBC)", () => {
  it("AB+ recipient accepts every donor group (universal recipient)", () => {
    for (const donor of ALL_BLOOD_GROUPS) {
      expect(isAboCompatible(donor, "AB_POS", "RBC")).toBe(true);
    }
  });

  it("O- recipient only accepts O- (most restrictive)", () => {
    for (const donor of ALL_BLOOD_GROUPS) {
      const expected = donor === "O_NEG";
      expect(isAboCompatible(donor, "O_NEG", "RBC")).toBe(expected);
    }
  });

  it("O- donor is universal (accepted by every recipient)", () => {
    for (const recipient of ALL_BLOOD_GROUPS) {
      expect(isAboCompatible("O_NEG", recipient, "RBC")).toBe(true);
    }
  });

  it("rejects classic mismatches called out in issue #93", () => {
    // O+ to A- → Rh-negative recipient cannot receive Rh-positive blood.
    expect(isAboCompatible("O_POS", "A_NEG", "RBC")).toBe(false);
    // A+ to B- → ABO + Rh both wrong.
    expect(isAboCompatible("A_POS", "B_NEG", "RBC")).toBe(false);
    // B+ to O+ → recipient has anti-B antibodies.
    expect(isAboCompatible("B_POS", "O_POS", "RBC")).toBe(false);
  });

  it("accepts Rh+ donor for Rh+ same-type recipient", () => {
    expect(isAboCompatible("A_POS", "A_POS", "RBC")).toBe(true);
    expect(isAboCompatible("B_POS", "B_POS", "RBC")).toBe(true);
  });

  it("matrix entries match the explicit RBC_COMPATIBILITY table", () => {
    for (const recipient of ALL_BLOOD_GROUPS) {
      for (const donor of ALL_BLOOD_GROUPS) {
        const expected = RBC_COMPATIBILITY[recipient].includes(donor);
        expect(isAboCompatible(donor, recipient, "RBC")).toBe(expected);
      }
    }
  });

  it("returns false for unknown groups (fail-safe)", () => {
    expect(isAboCompatible("MARS", "A_POS", "RBC")).toBe(false);
    expect(isAboCompatible("A_POS", null, "RBC")).toBe(false);
    expect(isAboCompatible(undefined, undefined, "RBC")).toBe(false);
  });
});

describe("isAboCompatible (PLASMA)", () => {
  it("AB plasma is universal donor for plasma", () => {
    for (const recipient of ALL_BLOOD_GROUPS) {
      expect(isAboCompatible("AB_POS", recipient, "PLASMA")).toBe(true);
      expect(isAboCompatible("AB_NEG", recipient, "PLASMA")).toBe(true);
    }
  });

  it("matrix entries match the explicit PLASMA_COMPATIBILITY table", () => {
    for (const recipient of ALL_BLOOD_GROUPS) {
      for (const donor of ALL_BLOOD_GROUPS) {
        const expected = PLASMA_COMPATIBILITY[recipient].includes(donor);
        expect(isAboCompatible(donor, recipient, "PLASMA")).toBe(expected);
      }
    }
  });
});

describe("aboMismatchReason", () => {
  it("returns null when compatible", () => {
    expect(aboMismatchReason("O_NEG", "AB_POS", "RBC")).toBeNull();
  });

  it("returns a human-readable reason on mismatch", () => {
    const r = aboMismatchReason("O_POS", "A_NEG", "RBC");
    expect(r).toMatch(/RBC mismatch/);
    expect(r).toContain("O+");
    expect(r).toContain("A-");
  });
});

describe("prettyBloodGroup", () => {
  it("formats Rh suffixes", () => {
    expect(prettyBloodGroup("A_POS")).toBe("A+");
    expect(prettyBloodGroup("AB_NEG")).toBe("AB-");
  });
});
