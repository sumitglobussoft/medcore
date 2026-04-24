// Integration-style tests for /api/v1/ai/kpis/* using a mini Express app
// that mounts only the ai-kpis router. The full app wiring line
// (`app.use("/api/v1/ai/kpis", aiKpisRouter)`) is intentionally NOT added in
// app.ts here — callers should merge that line; these tests exercise the
// router in isolation so they don't depend on it.
//
// The metrics service is mocked so we can assert role guards, date parsing,
// and response shape without touching a database.
/* eslint-disable @typescript-eslint/no-explicit-any */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const { computeFeature1BundleMock, computeFeature2BundleMock, bundlesToCsvMock } = vi.hoisted(() => ({
  computeFeature1BundleMock: vi.fn(),
  computeFeature2BundleMock: vi.fn(),
  bundlesToCsvMock: vi.fn(),
}));

vi.mock("../services/ai/kpi-metrics", () => ({
  computeFeature1Bundle: computeFeature1BundleMock,
  computeFeature2Bundle: computeFeature2BundleMock,
  bundlesToCsv: bundlesToCsvMock,
}));

// Load the router AFTER mocks are registered
import { aiKpisRouter } from "./ai-kpis";

function buildMiniApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/ai/kpis", aiKpisRouter);
  // No error middleware — let thrown errors 500 so tests can surface them
  return app;
}

function tokenFor(role: string): string {
  return jwt.sign(
    { userId: `u-${role}`, email: `${role}@t.local`, role },
    process.env.JWT_SECRET || "dev-secret",
    { expiresIn: "1h" },
  );
}

const sampleF1 = {
  misroutedOpdAppointments: {
    current: 5,
    baseline: 8,
    target: 6,
    target_direction: "down",
    unit: "count",
  },
  bookingCompletionRate: { current: 0.8, target: 0.7, target_direction: "up", unit: "pct" },
  patientCsatAiFlow: { current: 4.4, target: 4.2, target_direction: "up", unit: "rating" },
  top1AcceptanceRate: { current: 0.6, target: 0.55, target_direction: "up", unit: "pct" },
  timeToConfirmedAppointment: {
    current: 120,
    target: 180,
    target_direction: "down",
    unit: "seconds",
  },
  redFlagFalseNegativeRate: {
    current: 0,
    target: 0.01,
    target_direction: "down",
    unit: "pct",
  },
  frontDeskCallVolume: {
    current: 0,
    target: 0.75,
    target_direction: "down",
    unavailable: true,
    reason: "no telephony",
  },
};

const sampleF2 = {
  doctorDocTimeReduction: { current: 0.55, target: 0.5, target_direction: "up", unit: "pct" },
  doctorAdoption: { current: 0.75, target: 0.7, target_direction: "up", unit: "pct" },
  soapAcceptanceRate: { current: 0.65, target: 0.6, target_direction: "up", unit: "pct" },
  drugAlertInducedChanges: { current: 0.3, target: 0, target_direction: "up", unit: "pct" },
  medicationErrorRateComparison: {
    current: 0,
    target: 0,
    target_direction: "down",
    unavailable: true,
    reason: "no incident log",
  },
  doctorNpsForScribe: {
    current: 0,
    target: 40,
    target_direction: "up",
    unavailable: true,
    reason: "no column",
  },
  timeToSignOff: { current: 45, target: 60, target_direction: "down", unit: "seconds" },
};

describe("GET /api/v1/ai/kpis/* role guards and response shapes", () => {
  let app: express.Express;

  beforeEach(() => {
    computeFeature1BundleMock.mockReset();
    computeFeature2BundleMock.mockReset();
    bundlesToCsvMock.mockReset();
    app = buildMiniApp();
  });

  it("returns 401 when no auth header is supplied", async () => {
    const res = await request(app).get("/api/v1/ai/kpis/feature1");
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-admin roles on feature1", async () => {
    const res = await request(app)
      .get("/api/v1/ai/kpis/feature1")
      .set("Authorization", `Bearer ${tokenFor("DOCTOR")}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 for RECEPTION on feature2", async () => {
    const res = await request(app)
      .get("/api/v1/ai/kpis/feature2")
      .set("Authorization", `Bearer ${tokenFor("RECEPTION")}`);
    expect(res.status).toBe(403);
  });

  it("returns 403 for PATIENT on export", async () => {
    const res = await request(app)
      .get("/api/v1/ai/kpis/export")
      .set("Authorization", `Bearer ${tokenFor("PATIENT")}`);
    expect(res.status).toBe(403);
  });

  it("ADMIN can fetch feature1, passing the parsed from/to range to the service", async () => {
    computeFeature1BundleMock.mockResolvedValue(sampleF1);
    const res = await request(app)
      .get("/api/v1/ai/kpis/feature1?from=2026-04-01&to=2026-04-30")
      .set("Authorization", `Bearer ${tokenFor("ADMIN")}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bundle.bookingCompletionRate.current).toBe(0.8);
    expect(res.body.data.bundle.frontDeskCallVolume.unavailable).toBe(true);

    // Date range forwarded correctly
    const arg = computeFeature1BundleMock.mock.calls[0][0];
    expect(arg.from).toBeInstanceOf(Date);
    expect(arg.to).toBeInstanceOf(Date);
    expect(arg.from.toISOString().slice(0, 10)).toBe("2026-04-01");
    expect(arg.to.toISOString().slice(0, 10)).toBe("2026-04-30");
  });

  it("ADMIN can fetch feature2 and all 7 KPIs are in the bundle", async () => {
    computeFeature2BundleMock.mockResolvedValue(sampleF2);
    const res = await request(app)
      .get("/api/v1/ai/kpis/feature2")
      .set("Authorization", `Bearer ${tokenFor("ADMIN")}`);

    expect(res.status).toBe(200);
    const keys = Object.keys(res.body.data.bundle);
    expect(keys).toHaveLength(7);
    expect(keys).toContain("timeToSignOff");
    expect(keys).toContain("doctorAdoption");
  });

  it("defaults the date range to the last 30 days when from/to are omitted", async () => {
    computeFeature1BundleMock.mockResolvedValue(sampleF1);
    await request(app)
      .get("/api/v1/ai/kpis/feature1")
      .set("Authorization", `Bearer ${tokenFor("ADMIN")}`);
    const arg = computeFeature1BundleMock.mock.calls[0][0];
    const span = arg.to.getTime() - arg.from.getTime();
    // ~30 days ± 1 day
    expect(span).toBeGreaterThan(29 * 24 * 3600 * 1000);
    expect(span).toBeLessThan(31 * 24 * 3600 * 1000);
  });

  it("export returns CSV with correct headers and filename", async () => {
    computeFeature1BundleMock.mockResolvedValue(sampleF1);
    computeFeature2BundleMock.mockResolvedValue(sampleF2);
    bundlesToCsvMock.mockReturnValue("feature,metric,current\nfeature1,x,1");
    const res = await request(app)
      .get("/api/v1/ai/kpis/export?from=2026-04-01&to=2026-04-30")
      .set("Authorization", `Bearer ${tokenFor("ADMIN")}`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(
      /ai-kpis-2026-04-01_to_2026-04-30\.csv/,
    );
    expect(res.text).toContain("feature,metric,current");
  });

  it("returns 200 with empty bundle when metric service yields zeros", async () => {
    computeFeature1BundleMock.mockResolvedValue({
      ...sampleF1,
      misroutedOpdAppointments: {
        current: 0,
        baseline: 0,
        target: 0,
        target_direction: "down",
        unit: "count",
      },
    });
    const res = await request(app)
      .get("/api/v1/ai/kpis/feature1")
      .set("Authorization", `Bearer ${tokenFor("ADMIN")}`);
    expect(res.status).toBe(200);
    expect(res.body.data.bundle.misroutedOpdAppointments.current).toBe(0);
  });
});
