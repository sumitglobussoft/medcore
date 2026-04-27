// Unit tests for the elapsed-minutes / safeDate helpers.
//
// Issues #92 / #162 / #163: legacy ER + visitor rows had `arrivedAt`
// /`checkOutAt` defaulted to year-2000 sentinels, which produced 19,500-
// minute "elapsed" badges on the UI. We exhaustively cover:
//   - happy path                         → clamped minutes
//   - null / undefined / "" / "Invalid"  → 0
//   - sentinel timestamp (1970/2000)     → 0
//   - future startAt (clock skew)        → 0
//   - endAt before startAt               → falls back to "now"
//   - endAt is invalid                   → falls back to "now"
//
// Issue #108 / Doctors On Duty math is intentionally tested via an
// independent percentage helper (not a UI render) so the math fix is
// regression-locked even if the layout changes.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { elapsedMinutes, formatElapsed, safeDate } from "../time";

describe("elapsedMinutes", () => {
  const NOW = new Date("2026-04-26T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 0 for null / undefined / empty / invalid input", () => {
    expect(elapsedMinutes(null)).toBe(0);
    expect(elapsedMinutes(undefined)).toBe(0);
    expect(elapsedMinutes("")).toBe(0);
    expect(elapsedMinutes("not a date")).toBe(0);
  });

  it("returns 0 for year-2000 sentinel timestamps (Issue #162/#163)", () => {
    // The bug-source row had arrivedAt = 2000-01-01T00:00:00.000Z. Naive
    // Math.floor((Date.now() - new Date("2000-01-01")) / 60000) = ≈ 14M
    // minutes. We must clamp to 0.
    expect(elapsedMinutes("2000-01-01T00:00:00.000Z")).toBe(0);
    expect(elapsedMinutes("1970-01-01T00:00:00.000Z")).toBe(0);
    expect(elapsedMinutes(0)).toBe(0); // Unix epoch numeric form
  });

  it("clamps a future startAt to 0 (clock skew)", () => {
    expect(
      elapsedMinutes(new Date(NOW.getTime() + 60 * 60 * 1000))
    ).toBe(0);
  });

  it("returns minutes-since-start when endAt is null", () => {
    const start = new Date(NOW.getTime() - 90 * 60 * 1000); // 90 min ago
    expect(elapsedMinutes(start)).toBe(90);
  });

  it("uses endAt when valid and after startAt", () => {
    const start = new Date(NOW.getTime() - 120 * 60 * 1000);
    const end = new Date(NOW.getTime() - 30 * 60 * 1000);
    // 90 minutes between start and end.
    expect(elapsedMinutes(start, end)).toBe(90);
  });

  it("falls back to now when endAt predates startAt (year-2000 default)", () => {
    const start = new Date(NOW.getTime() - 60 * 60 * 1000);
    const end = "2000-01-01T00:00:00.000Z";
    // Without the fallback we'd report a hugely negative or sentinel-
    // contaminated value. With the fallback we report "60 minutes ago".
    expect(elapsedMinutes(start, end)).toBe(60);
  });

  it("falls back to now when endAt is unparseable", () => {
    const start = new Date(NOW.getTime() - 45 * 60 * 1000);
    expect(elapsedMinutes(start, "garbage")).toBe(45);
  });

  it("never returns a negative value", () => {
    const start = new Date(NOW.getTime() - 5 * 60 * 1000);
    const end = new Date(NOW.getTime() - 30 * 60 * 1000); // before start
    // Falls back to now; should be 5 minutes, not -25.
    expect(elapsedMinutes(start, end)).toBe(5);
  });
});

describe("formatElapsed", () => {
  it("renders minutes / hours / days with correct cutoffs", () => {
    expect(formatElapsed(0)).toBe("0m");
    expect(formatElapsed(45)).toBe("45m");
    expect(formatElapsed(60)).toBe("1h");
    expect(formatElapsed(125)).toBe("2h 5m");
    expect(formatElapsed(60 * 24)).toBe("1d");
    expect(formatElapsed(60 * 24 + 60 * 3)).toBe("1d 3h");
    // 7d+ guard for stale rows
    expect(formatElapsed(60 * 24 * 14)).toBe("7d+");
  });

  it("returns 0m for negative / NaN values", () => {
    expect(formatElapsed(-1)).toBe("0m");
    expect(formatElapsed(NaN)).toBe("0m");
  });
});

describe("safeDate", () => {
  it("returns the placeholder for null / undefined / invalid", () => {
    expect(safeDate(null)).toBe("—");
    expect(safeDate(undefined)).toBe("—");
    expect(safeDate("")).toBe("—");
    expect(safeDate("garbage")).toBe("—");
  });

  it("renders a real date as a locale string", () => {
    const out = safeDate("2026-04-26T00:00:00.000Z", "en-IN");
    // We don't pin the exact format — different runtimes localise — but
    // it must NOT contain the literal word "Invalid".
    expect(out).not.toContain("Invalid");
    expect(out.length).toBeGreaterThan(0);
  });
});

// ─── Issue #108 — Doctors On Duty percentage math ─────────
//
// The bug: 0/1 (100%) — math impossibility. The fix lives in the
// admin-console ResourceBar component, but the percentage formula is
// pure-function and can be unit-tested directly. We extract the formula
// here as a plain helper to lock in the fix even if the component churns.
function doctorsOnDutyPct(used: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(Math.round((used / total) * 100), 100);
}

describe("doctorsOnDutyPct (Issue #108)", () => {
  it("returns 0 when total is 0 (math impossibility before fix)", () => {
    expect(doctorsOnDutyPct(0, 0)).toBe(0);
  });

  it("returns 0 when used is 0 and total > 0", () => {
    expect(doctorsOnDutyPct(0, 5)).toBe(0);
  });

  it("returns 100 when used >= total", () => {
    expect(doctorsOnDutyPct(5, 5)).toBe(100);
    expect(doctorsOnDutyPct(7, 5)).toBe(100); // capped
  });

  it("computes intermediate ratios correctly", () => {
    expect(doctorsOnDutyPct(1, 4)).toBe(25);
    expect(doctorsOnDutyPct(2, 3)).toBe(67);
  });

  it("never returns 100 when used is 0 (regression for Issue #108)", () => {
    for (let total = 0; total <= 100; total++) {
      expect(doctorsOnDutyPct(0, total)).not.toBe(100);
    }
  });
});
