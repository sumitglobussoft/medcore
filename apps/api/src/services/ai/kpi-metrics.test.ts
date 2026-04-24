// Unit tests for kpi-metrics.ts. We mock `tenant-prisma` so tests run
// without a database and can inject deterministic fixture data. Each test
// asserts the shape AND the numerical result so regressions in the pct /
// median / filter logic are caught.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    appointment: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    aITriageSession: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    aIScribeSession: {
      findMany: vi.fn(),
    },
    patientFeedback: {
      findMany: vi.fn(),
    },
    emergencyCase: {
      findFirst: vi.fn(),
    },
    user: {
      count: vi.fn(),
    },
  } as any,
}));

vi.mock("../tenant-prisma", () => ({
  tenantScopedPrisma: prismaMock,
}));

import {
  misroutedOpdAppointments,
  bookingCompletionRate,
  patientCsatAiFlow,
  top1AcceptanceRate,
  timeToConfirmedAppointment,
  redFlagFalseNegativeRate,
  frontDeskCallVolume,
  doctorDocTimeReduction,
  doctorAdoption,
  soapAcceptanceRate,
  drugAlertInducedChanges,
  medicationErrorRateComparison,
  doctorNpsForScribe,
  timeToSignOff,
  computeFeature1Bundle,
  computeFeature2Bundle,
  bundlesToCsv,
  previousWindow,
  AI_TRIAGE_SUMMARY_MARKER,
} from "./kpi-metrics";

const from = new Date("2026-04-01T00:00:00Z");
const to = new Date("2026-04-30T23:59:59Z");

function resetAll() {
  for (const model of Object.values(prismaMock)) {
    for (const fn of Object.values(model as Record<string, any>)) {
      if (typeof (fn as any).mockReset === "function") (fn as any).mockReset();
    }
  }
}

beforeEach(() => resetAll());

// ─── Feature 1 tests ────────────────────────────────────

describe("misroutedOpdAppointments", () => {
  it("counts CANCELLED appointments created in-window and updated within 24h", async () => {
    const created = new Date("2026-04-10T10:00:00Z");
    prismaMock.appointment.findMany
      // current window
      .mockResolvedValueOnce([
        {
          id: "a1",
          status: "CANCELLED",
          createdAt: created,
          updatedAt: new Date(created.getTime() + 3 * 3600 * 1000),
          type: "SCHEDULED",
          doctorId: "d1",
          patientId: "p1",
          date: created,
        },
        {
          id: "a2",
          status: "CANCELLED",
          createdAt: created,
          updatedAt: new Date(created.getTime() + 48 * 3600 * 1000), // outside 24h
          type: "SCHEDULED",
          doctorId: "d1",
          patientId: "p1",
          date: created,
        },
        {
          id: "a3",
          status: "COMPLETED",
          createdAt: created,
          updatedAt: created,
          type: "SCHEDULED",
          doctorId: "d1",
          patientId: "p1",
          date: created,
        },
      ])
      // previous window
      .mockResolvedValueOnce([]);

    const r = await misroutedOpdAppointments({ from, to });
    expect(r.current).toBe(1);
    expect(r.target_direction).toBe("down");
    expect(r.unit).toBe("count");
  });
});

describe("bookingCompletionRate", () => {
  it("returns booked / total as a fraction", async () => {
    prismaMock.aITriageSession.count
      .mockResolvedValueOnce(10) // total
      .mockResolvedValueOnce(8); // booked
    const r = await bookingCompletionRate({ from, to });
    expect(r.current).toBeCloseTo(0.8, 2);
    expect(r.target).toBe(0.7);
    expect(r.target_direction).toBe("up");
    expect(r.sampleSize).toBe(10);
  });

  it("returns 0 when no sessions in window", async () => {
    prismaMock.aITriageSession.count.mockResolvedValue(0);
    const r = await bookingCompletionRate({ from, to });
    expect(r.current).toBe(0);
  });
});

describe("patientCsatAiFlow", () => {
  it("averages ratings of patients who booked via AI triage", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([
      { patientId: "p1" },
      { patientId: "p2" },
      { patientId: "p1" }, // dedup
    ]);
    prismaMock.patientFeedback.findMany.mockResolvedValue([
      { rating: 5 },
      { rating: 4 },
      { rating: 4 },
    ]);
    const r = await patientCsatAiFlow({ from, to });
    expect(r.current).toBeCloseTo(4.33, 1);
    expect(r.sampleSize).toBe(3);
    expect(r.target).toBe(4.2);
    // contains marker: we can't test the where-clause but can verify the
    // arg contained `AI_TRIAGE_SUMMARY_MARKER` in notes.contains.
    const apptCall = prismaMock.appointment.findMany.mock.calls[0][0];
    expect(apptCall.where.notes.contains).toBe(AI_TRIAGE_SUMMARY_MARKER);
  });

  it("returns 0 CSAT when no AI-booked patients", async () => {
    prismaMock.appointment.findMany.mockResolvedValue([]);
    const r = await patientCsatAiFlow({ from, to });
    expect(r.current).toBe(0);
    expect(r.sampleSize).toBe(0);
  });
});

describe("top1AcceptanceRate", () => {
  it("counts sessions whose booked doctor matches the top suggested specialty", async () => {
    prismaMock.aITriageSession.findMany.mockResolvedValue([
      {
        id: "s1",
        suggestedSpecialties: [{ specialty: "Cardiology" }, { specialty: "General Physician" }],
        appointmentId: "a1",
      },
      {
        id: "s2",
        suggestedSpecialties: [{ specialty: "Pediatrics" }],
        appointmentId: "a2",
      },
    ]);
    prismaMock.appointment.findUnique
      .mockResolvedValueOnce({ doctor: { specialization: "Cardiology" } }) // hit
      .mockResolvedValueOnce({ doctor: { specialization: "Orthopedics" } }); // miss

    const r = await top1AcceptanceRate({ from, to });
    expect(r.current).toBeCloseTo(0.5, 2);
    expect(r.sampleSize).toBe(2);
    expect(r.target).toBe(0.55);
  });
});

describe("timeToConfirmedAppointment", () => {
  it("computes the median seconds between session and appointment createdAt", async () => {
    const base = new Date("2026-04-10T10:00:00Z");
    prismaMock.aITriageSession.findMany.mockResolvedValue([
      { createdAt: base, appointmentId: "a1" }, // 60s
      { createdAt: base, appointmentId: "a2" }, // 120s
      { createdAt: base, appointmentId: "a3" }, // 180s
    ]);
    prismaMock.appointment.findUnique
      .mockResolvedValueOnce({ createdAt: new Date(base.getTime() + 60 * 1000) })
      .mockResolvedValueOnce({ createdAt: new Date(base.getTime() + 120 * 1000) })
      .mockResolvedValueOnce({ createdAt: new Date(base.getTime() + 180 * 1000) });

    const r = await timeToConfirmedAppointment({ from, to });
    expect(r.current).toBe(120);
    expect(r.target).toBe(180);
    expect(r.target_direction).toBe("down");
    expect(r.unit).toBe("seconds");
  });
});

describe("redFlagFalseNegativeRate", () => {
  it("counts sessions without red flag whose patient later ended up in ER", async () => {
    const base = new Date("2026-04-10T10:00:00Z");
    prismaMock.aITriageSession.findMany.mockResolvedValue([
      { id: "s1", patientId: "p1", createdAt: base },
      { id: "s2", patientId: "p2", createdAt: base },
    ]);
    prismaMock.emergencyCase.findFirst
      .mockResolvedValueOnce({ id: "e1" })
      .mockResolvedValueOnce(null);

    const r = await redFlagFalseNegativeRate({ from, to });
    expect(r.current).toBeCloseTo(0.5, 2);
    expect(r.target).toBe(0.01);
    expect(r.target_direction).toBe("down");
  });
});

describe("frontDeskCallVolume", () => {
  it("is marked unavailable with a reason", async () => {
    const r = await frontDeskCallVolume({ from, to });
    expect(r.unavailable).toBe(true);
    expect(r.reason).toContain("phone");
  });
});

// ─── Feature 2 tests ────────────────────────────────────

describe("doctorDocTimeReduction", () => {
  it("computes reduction fraction from scribe vs manual medians", async () => {
    const t0 = new Date("2026-04-10T10:00:00Z");
    prismaMock.aIScribeSession.findMany.mockResolvedValue([
      { createdAt: t0, signedOffAt: new Date(t0.getTime() + 60_000), appointmentId: "a1" },
      { createdAt: t0, signedOffAt: new Date(t0.getTime() + 60_000), appointmentId: "a2" },
    ]);
    prismaMock.appointment.findMany.mockResolvedValue([
      {
        consultationStartedAt: t0,
        consultationEndedAt: new Date(t0.getTime() + 120_000),
      },
      {
        consultationStartedAt: t0,
        consultationEndedAt: new Date(t0.getTime() + 120_000),
      },
    ]);
    const r = await doctorDocTimeReduction({ from, to });
    // manual median 120s, scribe median 60s → 0.5 reduction
    expect(r.current).toBeCloseTo(0.5, 2);
    expect(r.target_direction).toBe("up");
  });

  it("flags unavailable when baseline cohort is empty", async () => {
    prismaMock.aIScribeSession.findMany.mockResolvedValue([
      { createdAt: new Date(), signedOffAt: new Date(), appointmentId: "a1" },
    ]);
    prismaMock.appointment.findMany.mockResolvedValue([]);
    const r = await doctorDocTimeReduction({ from, to });
    expect(r.unavailable).toBe(true);
    expect(r.reason).toContain("manual-baseline");
  });
});

describe("doctorAdoption", () => {
  it("computes distinct signOffBy / total doctors", async () => {
    prismaMock.aIScribeSession.findMany.mockResolvedValue([
      { signedOffBy: "u1" },
      { signedOffBy: "u2" },
      { signedOffBy: "u1" }, // dup
    ]);
    prismaMock.user.count.mockResolvedValue(4);
    const r = await doctorAdoption({ from, to });
    expect(r.current).toBeCloseTo(0.5, 2);
    expect(r.target).toBe(0.7);
    expect(r.sampleSize).toBe(4);
  });
});

describe("soapAcceptanceRate", () => {
  it("averages per-section acceptance across sessions", async () => {
    prismaMock.aIScribeSession.findMany.mockResolvedValue([
      // zero edits = 4/4 sections accepted
      { doctorEdits: [] },
      // only subjective edited = 3/4 accepted
      { doctorEdits: [{ section: "subjective", field: "cc" }] },
    ]);
    const r = await soapAcceptanceRate({ from, to });
    // total sections = 8, accepts = 4 + 3 = 7 → 0.875
    expect(r.current).toBeCloseTo(0.875, 3);
    expect(r.target).toBe(0.6);
  });
});

describe("drugAlertInducedChanges", () => {
  it("counts sessions where an alerted medication was added/removed between draft and final", async () => {
    prismaMock.aIScribeSession.findMany.mockResolvedValue([
      {
        rxDraft: { alerts: [{ medication: "Warfarin" }] },
        soapDraft: { plan: { medications: [{ name: "Warfarin" }] } },
        soapFinal: { plan: { medications: [] } }, // removed → counts as change
      },
      {
        rxDraft: { alerts: [{ medication: "Aspirin" }] },
        soapDraft: { plan: { medications: [{ name: "Aspirin" }] } },
        soapFinal: { plan: { medications: [{ name: "Aspirin" }] } }, // unchanged
      },
      {
        rxDraft: { alerts: [] }, // skipped from denominator
        soapDraft: null,
        soapFinal: null,
      },
    ]);
    const r = await drugAlertInducedChanges({ from, to });
    expect(r.sampleSize).toBe(2);
    expect(r.current).toBeCloseTo(0.5, 2);
  });
});

describe("medicationErrorRateComparison / doctorNpsForScribe", () => {
  it("are marked unavailable with a reason", async () => {
    const a = await medicationErrorRateComparison({ from, to });
    const b = await doctorNpsForScribe({ from, to });
    expect(a.unavailable).toBe(true);
    expect(a.reason).toMatch(/incident/i);
    expect(b.unavailable).toBe(true);
    expect(b.reason).toMatch(/NPS|column/i);
  });
});

describe("timeToSignOff", () => {
  it("uses last transcript timestamp as the anchor when present", async () => {
    const created = new Date("2026-04-10T10:00:00Z");
    const lastTs = new Date("2026-04-10T10:10:00Z"); // 10 min after createdAt
    const signed = new Date("2026-04-10T10:10:30Z"); // 30s after last transcript
    prismaMock.aIScribeSession.findMany.mockResolvedValue([
      {
        createdAt: created,
        signedOffAt: signed,
        updatedAt: signed,
        transcript: [
          { timestamp: new Date("2026-04-10T10:00:30Z").toISOString() },
          { timestamp: lastTs.toISOString() },
        ],
      },
    ]);
    const r = await timeToSignOff({ from, to });
    expect(r.current).toBe(30);
    expect(r.target).toBe(60);
    expect(r.target_direction).toBe("down");
  });
});

// ─── Bundles + CSV ──────────────────────────────────────

describe("bundlesToCsv", () => {
  it("produces a CSV with a header row and one row per metric, honoring unavailable", () => {
    const f1 = {
      misroutedOpdAppointments: { current: 5, target: 0, target_direction: "down" as const, unit: "count" as const },
      bookingCompletionRate: { current: 0.8, target: 0.7, target_direction: "up" as const, unit: "pct" as const },
      patientCsatAiFlow: { current: 4.4, target: 4.2, target_direction: "up" as const, unit: "rating" as const },
      top1AcceptanceRate: { current: 0.6, target: 0.55, target_direction: "up" as const, unit: "pct" as const },
      timeToConfirmedAppointment: { current: 120, target: 180, target_direction: "down" as const, unit: "seconds" as const },
      redFlagFalseNegativeRate: { current: 0, target: 0.01, target_direction: "down" as const, unit: "pct" as const },
      frontDeskCallVolume: { current: 0, target: 0.75, target_direction: "down" as const, unavailable: true as const, reason: "no telephony" },
    };
    const f2 = {
      doctorDocTimeReduction: { current: 0.55, target: 0.5, target_direction: "up" as const, unit: "pct" as const },
      doctorAdoption: { current: 0.75, target: 0.7, target_direction: "up" as const, unit: "pct" as const },
      soapAcceptanceRate: { current: 0.65, target: 0.6, target_direction: "up" as const, unit: "pct" as const },
      drugAlertInducedChanges: { current: 0.3, target: 0, target_direction: "up" as const, unit: "pct" as const },
      medicationErrorRateComparison: { current: 0, target: 0, target_direction: "down" as const, unavailable: true as const, reason: "x,y,z" },
      doctorNpsForScribe: { current: 0, target: 40, target_direction: "up" as const, unavailable: true as const, reason: "no column" },
      timeToSignOff: { current: 45, target: 60, target_direction: "down" as const, unit: "seconds" as const },
    };
    const csv = bundlesToCsv(f1, f2);
    const lines = csv.split("\n");
    expect(lines[0]).toMatch(/^feature,metric,current/);
    expect(lines).toHaveLength(1 + 7 + 7);
    // unavailable rows have quoted reason
    expect(csv).toContain("no telephony");
    // escapes commas inside reasons
    expect(csv).toContain('"x,y,z"');
  });
});

describe("previousWindow", () => {
  it("returns a same-length window immediately before the input range", () => {
    const f = new Date("2026-04-15T00:00:00Z");
    const t = new Date("2026-04-30T00:00:00Z");
    const prev = previousWindow(f, t);
    expect(prev.to.getTime()).toBeLessThan(f.getTime());
    expect(t.getTime() - f.getTime()).toBe(prev.to.getTime() - prev.from.getTime() + 1);
  });
});

// ─── Bundle composition ─────────────────────────────────

describe("computeFeature1Bundle / computeFeature2Bundle", () => {
  it("returns all seven keys for each feature", async () => {
    // Return zero-ish data so all metrics succeed quickly
    prismaMock.appointment.findMany.mockResolvedValue([]);
    prismaMock.appointment.findFirst.mockResolvedValue(null);
    prismaMock.appointment.findUnique.mockResolvedValue(null);
    prismaMock.aITriageSession.findMany.mockResolvedValue([]);
    prismaMock.aITriageSession.count.mockResolvedValue(0);
    prismaMock.aIScribeSession.findMany.mockResolvedValue([]);
    prismaMock.patientFeedback.findMany.mockResolvedValue([]);
    prismaMock.emergencyCase.findFirst.mockResolvedValue(null);
    prismaMock.user.count.mockResolvedValue(1);

    const f1 = await computeFeature1Bundle({ from, to });
    const f2 = await computeFeature2Bundle({ from, to });

    expect(Object.keys(f1)).toHaveLength(7);
    expect(Object.keys(f2)).toHaveLength(7);
    // Each result has current + target + target_direction
    for (const v of Object.values(f1)) {
      expect(v).toHaveProperty("current");
      expect(v).toHaveProperty("target");
      expect(v).toHaveProperty("target_direction");
    }
    for (const v of Object.values(f2)) {
      expect(v).toHaveProperty("current");
      expect(v).toHaveProperty("target");
      expect(v).toHaveProperty("target_direction");
    }
  });
});
