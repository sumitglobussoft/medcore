// Unit tests for the Issue #46 recomputer. The function is PURE so we
// don't need a database — just feed in synthetic rows + DOBs + "now".
import { describe, it, expect } from "vitest";
import {
  findUIPEntry,
  recomputeImmunizationDue,
} from "../immunization-schedule";

// Fixed "now" so the tests are deterministic regardless of when they run.
const NOW = new Date("2026-04-24T00:00:00.000Z");

function dobYearsAgo(years: number): Date {
  return new Date(NOW.getTime() - years * 365 * 86_400_000);
}

function dueYearsAgo(years: number): Date {
  return new Date(NOW.getTime() - years * 365 * 86_400_000);
}

describe("findUIPEntry", () => {
  it("finds BCG at age 0", () => {
    const e = findUIPEntry("BCG", 1);
    expect(e).toBeTruthy();
    expect(e?.dueAgeDays).toBe(0);
  });

  it("finds DPT Booster 1 at ~1.5y", () => {
    const e = findUIPEntry("DPT Booster 1", 1);
    expect(e?.dueAgeDays).toBe(490);
  });

  it("returns undefined for adult-only vaccines", () => {
    expect(findUIPEntry("Influenza (Annual)", 1)).toBeUndefined();
  });
});

describe("recomputeImmunizationDue (Issue #46)", () => {
  it("marks an adult patient's pediatric vaccine as MISSED", () => {
    // Saanvi-style bug: adult (30y) with a DPT due date from 9+ years ago.
    const decision = recomputeImmunizationDue({
      vaccine: "Pentavalent (DPT+HepB+Hib)",
      doseNumber: 1,
      currentDueDate: dueYearsAgo(9),
      patientDateOfBirth: dobYearsAgo(30),
      now: NOW,
    });
    expect(decision.action).toBe("MISSED");
    if (decision.action === "MISSED") {
      expect(decision.reason).toMatch(/pediatric/i);
    }
  });

  it("recomputes a young child's overdue DPT within a realistic window", () => {
    // 3y old, DPT was "due" at 98 days (anchored) — but seed put it 9y ago
    // (garbage). The recomputer should either anchor-to-DOB or clamp to a
    // 7-60d overdue window. Either way the resulting date is within the
    // last year and the patient is still a valid pediatric candidate.
    const decision = recomputeImmunizationDue({
      vaccine: "Pentavalent (DPT+HepB+Hib)",
      doseNumber: 1,
      currentDueDate: dueYearsAgo(9),
      patientDateOfBirth: dobYearsAgo(3),
      now: NOW,
    });
    expect(decision.action).toBe("RECOMPUTE");
    if (decision.action === "RECOMPUTE") {
      const ageDays =
        (NOW.getTime() - decision.newDueDate.getTime()) / 86_400_000;
      // Either anchor-to-DOB (~3y old) would still be too far — so we expect
      // the clamped branch: 7..60 days overdue.
      expect(ageDays).toBeGreaterThanOrEqual(7);
      expect(ageDays).toBeLessThanOrEqual(60);
    }
  });

  it("recomputes an age-appropriate upcoming item by anchoring to DOB", () => {
    // Infant (90 days old). OPV dose 3 is due at 70 days — so the UIP anchor
    // is only 20 days overdue. That's <= 60 days, so the anchored date is
    // used directly (no clamping).
    const infantDob = new Date(NOW.getTime() - 90 * 86_400_000);
    const decision = recomputeImmunizationDue({
      vaccine: "OPV",
      doseNumber: 3,
      currentDueDate: dueYearsAgo(9), // stale garbage
      patientDateOfBirth: infantDob,
      now: NOW,
    });
    expect(decision.action).toBe("RECOMPUTE");
    if (decision.action === "RECOMPUTE") {
      const overdueDays =
        (NOW.getTime() - decision.newDueDate.getTime()) / 86_400_000;
      expect(overdueDays).toBeCloseTo(20, 0);
    }
  });

  it("does not recompute a non-stale entry (under 365 days)", () => {
    const decision = recomputeImmunizationDue({
      vaccine: "Pentavalent (DPT+HepB+Hib)",
      doseNumber: 1,
      currentDueDate: new Date(NOW.getTime() - 30 * 86_400_000),
      patientDateOfBirth: dobYearsAgo(30),
      now: NOW,
    });
    expect(decision.action).toBe("SKIP");
  });

  it("marks MISSED when the patient has no DOB (cannot anchor)", () => {
    const decision = recomputeImmunizationDue({
      vaccine: "BCG",
      doseNumber: 1,
      currentDueDate: dueYearsAgo(9),
      patientDateOfBirth: null,
      now: NOW,
    });
    expect(decision.action).toBe("MISSED");
  });

  it("clamps unknown (non-UIP) vaccines to the 7-60 day window", () => {
    const decision = recomputeImmunizationDue({
      vaccine: "Influenza (Annual)", // adult, not in UIP
      doseNumber: 1,
      currentDueDate: dueYearsAgo(3),
      patientDateOfBirth: dobYearsAgo(40),
      now: NOW,
    });
    expect(decision.action).toBe("RECOMPUTE");
    if (decision.action === "RECOMPUTE") {
      const overdueDays =
        (NOW.getTime() - decision.newDueDate.getTime()) / 86_400_000;
      expect(overdueDays).toBeGreaterThanOrEqual(7);
      expect(overdueDays).toBeLessThanOrEqual(60);
    }
  });

  it("is deterministic — same input yields same output across calls", () => {
    const input = {
      vaccine: "Td",
      doseNumber: 2,
      currentDueDate: dueYearsAgo(5),
      patientDateOfBirth: dobYearsAgo(25),
      now: NOW,
    };
    const a = recomputeImmunizationDue(input);
    const b = recomputeImmunizationDue(input);
    expect(a).toEqual(b);
  });

  it("adult pediatric vaccine → MISSED even when dueAgeDays is borderline", () => {
    // DPT Booster 2 is at 5y (1825d), below the 16y threshold → pediatric
    // → adult patient is too late.
    const decision = recomputeImmunizationDue({
      vaccine: "DPT Booster 2",
      doseNumber: 2,
      currentDueDate: dueYearsAgo(15),
      patientDateOfBirth: dobYearsAgo(25),
      now: NOW,
    });
    expect(decision.action).toBe("MISSED");
  });
});
