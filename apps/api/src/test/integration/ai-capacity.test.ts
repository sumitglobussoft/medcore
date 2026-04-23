// Integration tests for the AI Capacity forecasting router
// (/api/v1/ai/capacity).  The capacity-forecast service is mocked so we can
// assert route behaviour without exercising Holt-Winters against real data.
// Skipped unless DATABASE_URL_TEST is set.
import { it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import { describeIfDB, resetDB, getAuthToken } from "../setup";

vi.mock("../../services/ai/capacity-forecast", () => {
  const row = {
    resourceId: "ward-1",
    resourceName: "Ward A",
    resourceType: "ward" as const,
    capacityUnits: 20,
    currentlyInUse: 12,
    plannedReleases: 3,
    predictedInflow: 6,
    predictedInflowUpper: 10,
    expectedOccupancyPct: 75,
    expectedStockout: false,
    confidence: "high" as const,
    method: "holt-winters" as const,
    insufficientData: false,
  };
  const summary = {
    totalCapacity: 20,
    totalCurrentlyInUse: 12,
    totalPredictedInflow: 6,
    totalPredictedInflowUpper: 10,
    aggregateOccupancyPct: 90,
    anyStockoutRisk: false,
    wardsAtRisk: 0,
  };
  return {
    forecastBedOccupancy: vi.fn(async ({ horizonHours }: { horizonHours: number }) => ({
      horizonHours,
      generatedAt: new Date().toISOString(),
      forecasts: [row],
      summary,
    })),
    forecastOTUtilization: vi.fn(async ({ horizonHours }: { horizonHours: number }) => ({
      horizonHours,
      generatedAt: new Date().toISOString(),
      forecasts: [{ ...row, resourceType: "ot", resourceName: "OT-1" }],
      summary,
    })),
    forecastICUDemand: vi.fn(async ({ horizonHours }: { horizonHours: number }) => ({
      horizonHours,
      generatedAt: new Date().toISOString(),
      forecasts: [{ ...row, resourceName: "ICU-A" }],
      summary,
    })),
  };
});

let app: express.Express;
let adminToken: string;
let nurseToken: string;
let doctorToken: string;
let patientToken: string;

describeIfDB("AI Capacity API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    nurseToken = await getAuthToken("NURSE");
    doctorToken = await getAuthToken("DOCTOR");
    patientToken = await getAuthToken("PATIENT");

    const { aiCapacityRouter } = await import("../../routes/ai-capacity");
    const { errorHandler } = await import("../../middleware/error");
    app = express();
    app.use(express.json());
    app.use("/api/v1/ai/capacity", aiCapacityRouter);
    app.use(errorHandler);
  });

  // ─── GET /beds ───────────────────────────────────────────────────────

  it("GET /beds?horizon=72 returns a ward forecast for ADMIN", async () => {
    const res = await request(app)
      .get("/api/v1/ai/capacity/beds?horizon=72")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.horizonHours).toBe(72);
    expect(Array.isArray(res.body.data.forecasts)).toBe(true);
    expect(res.body.data.forecasts[0].resourceType).toBe("ward");
    expect(res.body.data.summary.totalCapacity).toBeGreaterThan(0);
  });

  it("GET /beds is also allowed for NURSE", async () => {
    const res = await request(app)
      .get("/api/v1/ai/capacity/beds?horizon=24")
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.horizonHours).toBe(24);
  });

  it("GET /beds rejects unauthenticated requests (401)", async () => {
    const res = await request(app).get("/api/v1/ai/capacity/beds?horizon=24");
    expect(res.status).toBe(401);
  });

  it("GET /beds rejects DOCTOR (403)", async () => {
    const res = await request(app)
      .get("/api/v1/ai/capacity/beds?horizon=24")
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /beds rejects invalid horizon (400)", async () => {
    const res = await request(app)
      .get("/api/v1/ai/capacity/beds?horizon=7")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/horizon/i);
  });

  // ─── GET /ot ─────────────────────────────────────────────────────────

  it("GET /ot?horizon=48 returns OT forecast for ADMIN", async () => {
    const res = await request(app)
      .get("/api/v1/ai/capacity/ot?horizon=48")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.horizonHours).toBe(48);
    expect(res.body.data.forecasts[0].resourceType).toBe("ot");
  });

  it("GET /ot rejects NURSE (403) — only ADMIN allowed", async () => {
    const res = await request(app)
      .get("/api/v1/ai/capacity/ot?horizon=24")
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(res.status).toBe(403);
  });

  it("GET /ot rejects PATIENT (403)", async () => {
    const res = await request(app)
      .get("/api/v1/ai/capacity/ot?horizon=24")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(403);
  });

  // ─── GET /icu ────────────────────────────────────────────────────────

  it("GET /icu returns ICU forecast for ADMIN and NURSE", async () => {
    const resAdmin = await request(app)
      .get("/api/v1/ai/capacity/icu?horizon=24")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(resAdmin.status).toBe(200);
    expect(resAdmin.body.data.forecasts[0].resourceName).toContain("ICU");

    const resNurse = await request(app)
      .get("/api/v1/ai/capacity/icu?horizon=24")
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(resNurse.status).toBe(200);
  });

  it("GET /icu defaults to 72h when horizon omitted", async () => {
    const res = await request(app)
      .get("/api/v1/ai/capacity/icu")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.horizonHours).toBe(72);
  });

  it("GET /icu rejects PATIENT (403)", async () => {
    const res = await request(app)
      .get("/api/v1/ai/capacity/icu?horizon=24")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(403);
  });
});
