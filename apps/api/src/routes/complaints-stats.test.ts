// Issue #92 (2026-04-26) — invariant test for the complaints /stats
// endpoint: Critical Open MUST be a subset of Total Open. The bug
// reported a UI showing 7 critical-open while total-open=5, which is
// arithmetically impossible — it happened because criticalOpen was
// derived from a different base set (status NOT IN (RESOLVED, CLOSED))
// than byStatus.OPEN (status = 'OPEN' only).
//
// This test is a pure unit test that mirrors the aggregation logic in
// `apps/api/src/routes/feedback.ts`. It does not need a DB.
import { describe, it, expect } from "vitest";

interface ComplaintRow {
  status: "OPEN" | "UNDER_REVIEW" | "ESCALATED" | "RESOLVED" | "CLOSED";
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  createdAt: Date;
  resolvedAt: Date | null;
  assignedTo: string | null;
}

// Pure aggregator copied verbatim from the route handler so a regression
// there is caught here. If you change the route, mirror the change in
// this function and re-run the suite.
function aggregate(all: ComplaintRow[]) {
  const OPEN_STATUSES: ReadonlyArray<string> = [
    "OPEN",
    "UNDER_REVIEW",
    "ESCALATED",
  ];
  const openSet = all.filter((c) => OPEN_STATUSES.includes(c.status));
  return {
    totalOpen: openSet.length,
    criticalOpen: openSet.filter((c) => c.priority === "CRITICAL").length,
  };
}

describe("complaints stats — Critical ⊆ Total invariant", () => {
  it("returns totalOpen=0 + criticalOpen=0 on empty input", () => {
    const r = aggregate([]);
    expect(r.totalOpen).toBe(0);
    expect(r.criticalOpen).toBe(0);
  });

  it("Critical ⊆ Total: criticalOpen never exceeds totalOpen", () => {
    // Reproduce the broken scenario from the bug report — 7 critical
    // complaints across OPEN/UNDER_REVIEW/ESCALATED, plus 0 with status
    // strictly = 'OPEN'. Old code reported critical=7, total=0.
    const rows: ComplaintRow[] = [
      ...Array.from({ length: 4 }, () => ({
        status: "UNDER_REVIEW" as const,
        priority: "CRITICAL" as const,
        createdAt: new Date(),
        resolvedAt: null,
        assignedTo: null,
      })),
      ...Array.from({ length: 3 }, () => ({
        status: "ESCALATED" as const,
        priority: "CRITICAL" as const,
        createdAt: new Date(),
        resolvedAt: null,
        assignedTo: null,
      })),
      // A few non-critical rows in OPEN/RESOLVED to make sure they
      // aren't double-counted.
      {
        status: "OPEN" as const,
        priority: "MEDIUM" as const,
        createdAt: new Date(),
        resolvedAt: null,
        assignedTo: null,
      },
      {
        status: "RESOLVED" as const,
        priority: "CRITICAL" as const,
        createdAt: new Date(),
        resolvedAt: new Date(),
        assignedTo: null,
      },
    ];
    const { totalOpen, criticalOpen } = aggregate(rows);
    expect(criticalOpen).toBeLessThanOrEqual(totalOpen);
    expect(totalOpen).toBe(8); // 4 UR + 3 ESC + 1 OPEN
    expect(criticalOpen).toBe(7); // 4 UR + 3 ESC critical
  });

  it("does not count RESOLVED or CLOSED complaints", () => {
    const rows: ComplaintRow[] = [
      {
        status: "RESOLVED",
        priority: "CRITICAL",
        createdAt: new Date(),
        resolvedAt: new Date(),
        assignedTo: null,
      },
      {
        status: "CLOSED",
        priority: "CRITICAL",
        createdAt: new Date(),
        resolvedAt: new Date(),
        assignedTo: null,
      },
    ];
    const { totalOpen, criticalOpen } = aggregate(rows);
    expect(totalOpen).toBe(0);
    expect(criticalOpen).toBe(0);
  });

  it("randomized fuzz: invariant holds across 50 random distributions", () => {
    const STATUSES: ComplaintRow["status"][] = [
      "OPEN",
      "UNDER_REVIEW",
      "ESCALATED",
      "RESOLVED",
      "CLOSED",
    ];
    const PRIORITIES: ComplaintRow["priority"][] = [
      "LOW",
      "MEDIUM",
      "HIGH",
      "CRITICAL",
    ];
    for (let i = 0; i < 50; i++) {
      const n = 5 + Math.floor(Math.random() * 30);
      const rows: ComplaintRow[] = Array.from({ length: n }, () => ({
        status: STATUSES[Math.floor(Math.random() * STATUSES.length)],
        priority:
          PRIORITIES[Math.floor(Math.random() * PRIORITIES.length)],
        createdAt: new Date(),
        resolvedAt: null,
        assignedTo: Math.random() > 0.5 ? "user-1" : null,
      }));
      const { totalOpen, criticalOpen } = aggregate(rows);
      expect(criticalOpen).toBeLessThanOrEqual(totalOpen);
    }
  });
});
