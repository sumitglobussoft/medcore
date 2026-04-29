// Tests covering KPI math edge cases that historically produced UI-visible
// nonsense values (issues #270, #281, #298, #300, #311, #312, #313).
//
// Each test pins one of the invariants the cross-module reconciliation pass
// guarantees so a future refactor can't silently re-introduce the bug.
import { describe, it, expect } from "vitest";
import { formatINR } from "../currency";
import { getBedSummary } from "../bed-summary";
import { formatDoctorName } from "../format-doctor-name";

// ─── Issue #281 — payment cap math ─────────────────────────────────────
// The server-side guard rejects a payment when it exceeds the invoice's
// outstanding balance (plus a small paise tolerance). We replicate the
// pure-function predicate here so the front-end can mirror the rule.
function paymentExceedsBalance(amount: number, balance: number): boolean {
  const TOLERANCE = 0.5;
  return amount > balance + TOLERANCE;
}

describe("payment cap (Issue #281)", () => {
  it("accepts an exact-balance payment", () => {
    expect(paymentExceedsBalance(1000, 1000)).toBe(false);
  });

  it("accepts a sub-balance payment", () => {
    expect(paymentExceedsBalance(500, 1000)).toBe(false);
  });

  it("rejects an over-payment beyond paise tolerance", () => {
    expect(paymentExceedsBalance(1001, 1000)).toBe(true);
    // The 99-crore typo from the production bug
    expect(paymentExceedsBalance(990000000, 1000)).toBe(true);
  });

  it("accepts a half-rupee rounding overshoot inside tolerance", () => {
    expect(paymentExceedsBalance(1000.4, 1000)).toBe(false);
  });
});

// ─── Issue #300 — analytics divide-by-zero / clamp ────────────────────
function deltaPct(current: number, previous: number): number {
  const PCT_FLOOR_BASE = 1;
  const PCT_CLAMP = 999;
  if (!previous || Math.abs(previous) < PCT_FLOOR_BASE) {
    if (!current) return 0;
    return 100;
  }
  const raw = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(raw)) return 0;
  return +Math.max(-PCT_CLAMP, Math.min(PCT_CLAMP, raw)).toFixed(1);
}

describe("delta percentage (Issue #300)", () => {
  it("returns 0 when both are zero", () => {
    expect(deltaPct(0, 0)).toBe(0);
  });

  it("returns 100 when previous is zero but current is non-zero", () => {
    expect(deltaPct(50, 0)).toBe(100);
  });

  it("clamps absurd ratios to ±999 (no '+199999899.8 %')", () => {
    // |previous| ≥ 1 so we hit the ratio branch and clamp to 999/-999.
    expect(deltaPct(19999989, 1)).toBe(999);
    expect(deltaPct(-19999989, 1)).toBe(-999);
  });

  it("treats sub-rupee base as effectively zero (returns 100, not crore-%)", () => {
    // The literal production value: 1.99 crore vs 0.01 paise base would
    // otherwise produce a 9-digit percentage. PCT_FLOOR_BASE = 1 collapses
    // it into the "previous = 0 ⇒ 100%" branch.
    expect(deltaPct(19999989, 0.01)).toBe(100);
  });

  it("computes a normal delta correctly", () => {
    expect(deltaPct(150, 100)).toBe(50);
    expect(deltaPct(80, 100)).toBe(-20);
  });

  it("never propagates NaN / Infinity", () => {
    expect(Number.isFinite(deltaPct(NaN, 100))).toBe(true);
    expect(Number.isFinite(deltaPct(100, NaN as unknown as number))).toBe(true);
  });
});

// ─── Issue #311 — bed summary canonical helper ────────────────────────
describe("getBedSummary (Issue #311)", () => {
  it("totals equal the sum of per-ward bed.length when beds are present", () => {
    const wards = [
      {
        beds: [
          { status: "OCCUPIED" },
          { status: "OCCUPIED" },
          { status: "AVAILABLE" },
        ],
      },
      {
        beds: [{ status: "OCCUPIED" }, { status: "CLEANING" }],
      },
    ];
    const s = getBedSummary(wards);
    expect(s.total).toBe(5);
    expect(s.occupied).toBe(3);
    expect(s.available).toBe(1);
    expect(s.cleaning).toBe(1);
  });

  it("falls back to scalar fields when beds[] is omitted", () => {
    const s = getBedSummary([
      { totalBeds: 10, occupiedBeds: 6, availableBeds: 4 },
    ]);
    expect(s.total).toBe(10);
    expect(s.occupied).toBe(6);
    expect(s.available).toBe(4);
  });

  it("returns all-zero for null / empty input (no NaN)", () => {
    expect(getBedSummary(null).total).toBe(0);
    expect(getBedSummary([]).occupied).toBe(0);
  });
});

// ─── Issue #313 — Critical Open ⊆ Total Open invariant ────────────────
describe("OPEN_STATUSES set (Issue #313)", () => {
  // Mirror the canonical OPEN_STATUSES ∋ {OPEN, UNDER_REVIEW, ESCALATED}
  const OPEN_STATUSES = ["OPEN", "UNDER_REVIEW", "ESCALATED"];

  function totalAndCriticalOpen<T extends { status: string; priority: string }>(
    rows: T[]
  ) {
    const open = rows.filter((r) => OPEN_STATUSES.includes(r.status));
    return {
      totalOpen: open.length,
      criticalOpen: open.filter((r) => r.priority === "CRITICAL").length,
    };
  }

  it("Critical Open is always ≤ Total Open", () => {
    const fixture = [
      { status: "OPEN", priority: "CRITICAL" },
      { status: "OPEN", priority: "HIGH" },
      { status: "ESCALATED", priority: "CRITICAL" },
      { status: "UNDER_REVIEW", priority: "MEDIUM" },
      { status: "RESOLVED", priority: "CRITICAL" }, // OUT of OPEN set
      { status: "CLOSED", priority: "CRITICAL" }, // OUT of OPEN set
    ];
    const { totalOpen, criticalOpen } = totalAndCriticalOpen(fixture);
    expect(totalOpen).toBe(4);
    expect(criticalOpen).toBe(2);
    expect(criticalOpen).toBeLessThanOrEqual(totalOpen);
  });

  it("excludes RESOLVED / CLOSED rows even if priority is CRITICAL", () => {
    const fixture = [
      { status: "RESOLVED", priority: "CRITICAL" },
      { status: "CLOSED", priority: "CRITICAL" },
    ];
    const { totalOpen, criticalOpen } = totalAndCriticalOpen(fixture);
    expect(totalOpen).toBe(0);
    expect(criticalOpen).toBe(0);
  });
});

// ─── Issue #298 / formatINR cross-checks ──────────────────────────────
describe("formatINR + KPI value rendering (Issue #298)", () => {
  it("renders an outstanding-balance KPI as ₹...,...,...", () => {
    const out = formatINR(1234567);
    expect(out.startsWith("₹")).toBe(true);
    expect(out).toContain("12,34,567");
  });

  it("never produces 'Rs. NaN' for a missing total", () => {
    expect(formatINR(null)).toBe("—");
    expect(formatINR(undefined)).toBe("—");
  });
});

// ─── Issue #234 / formatDoctorName invariant smoke check ──────────────
describe("formatDoctorName + double-prefix invariant", () => {
  it("never emits two 'Dr. ' tokens regardless of input prefix repetitions", () => {
    const inputs = [
      "Rajesh",
      "Dr. Rajesh",
      "DR. RAJESH",
      "Dr Rajesh",
      "Dr.  Rajesh",
      "Dr. Dr. Rajesh",
      "Dr. Dr. Dr. Rajesh",
    ];
    for (const i of inputs) {
      const out = formatDoctorName(i);
      // count occurrences of "Dr." (case-insensitive) — must be exactly 1
      const matches = out.match(/Dr\./gi) || [];
      expect(matches.length).toBe(1);
    }
  });
});
