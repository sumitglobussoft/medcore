/**
 * Issue #348 — bed counts were inconsistent across Wards/Admissions/
 * Dashboard because each page open-coded its own reduce. The shared
 * `summarizeBeds` / `getBedSummary` helpers collapse every fallback path
 * into one formula so all three pages always agree.
 *
 * These tests pin both the per-ward and the across-wards summary against
 * the three payload shapes the API can produce:
 *   • beds[] populated   → recompute from beds[]
 *   • beds[] omitted     → fall back to aggregate fields (totalBeds, etc.)
 *   • completely missing → return zeros (no crash)
 */
import { describe, it, expect } from "vitest";
import { summarizeBeds, getBedSummary } from "../bed-summary";

describe("summarizeBeds", () => {
  it("computes from beds[] when populated", () => {
    expect(
      summarizeBeds({
        beds: [
          { status: "AVAILABLE" },
          { status: "AVAILABLE" },
          { status: "OCCUPIED" },
          { status: "CLEANING" },
          { status: "MAINTENANCE" },
        ],
      })
    ).toEqual({
      total: 5,
      available: 2,
      occupied: 1,
      cleaning: 1,
      maintenance: 1,
    });
  });

  it("falls back to aggregate fields when beds[] is omitted", () => {
    expect(
      summarizeBeds({
        totalBeds: 10,
        availableBeds: 6,
        occupiedBeds: 3,
        cleaningBeds: 1,
        maintenanceBeds: 0,
      })
    ).toEqual({
      total: 10,
      available: 6,
      occupied: 3,
      cleaning: 1,
      maintenance: 0,
    });
  });

  it("returns all zeros for null/undefined ward — no crash", () => {
    expect(summarizeBeds(null)).toEqual({
      total: 0,
      available: 0,
      occupied: 0,
      cleaning: 0,
      maintenance: 0,
    });
    expect(summarizeBeds(undefined)).toEqual({
      total: 0,
      available: 0,
      occupied: 0,
      cleaning: 0,
      maintenance: 0,
    });
  });
});

describe("getBedSummary", () => {
  it("sums across multiple wards using a mix of payload shapes", () => {
    const wards = [
      // Modern shape — beds[] populated
      {
        beds: [{ status: "AVAILABLE" }, { status: "OCCUPIED" }],
      },
      // Aggregate shape — beds[] omitted
      {
        totalBeds: 5,
        availableBeds: 3,
        occupiedBeds: 2,
      },
    ];
    expect(getBedSummary(wards)).toEqual({
      total: 7,
      available: 4,
      occupied: 3,
      cleaning: 0,
      maintenance: 0,
    });
  });

  it("Issue #348 regression — Wards page formula and Admissions page formula must agree", () => {
    // The bug: the Admissions page's open-coded reduce only filtered
    // `beds[]` and never fell back to `availableBeds`. When the API
    // returned the aggregate shape it counted 0 instead of N. This test
    // pins that both paths now report the same number.
    const wards = [
      // Aggregate-only payload — the case where the bug manifested.
      { totalBeds: 4, availableBeds: 4, occupiedBeds: 0 },
    ];
    const summary = getBedSummary(wards);
    expect(summary.available).toBe(4);
    expect(summary.total).toBe(4);
  });
});
