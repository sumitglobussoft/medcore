// Integration tests for the AI Fraud router (/api/v1/ai/fraud).
// The detection service is exercised live (no LLM required — llmReview defaults
// to false). The FraudAlert model may not yet be migrated; in that case the
// scan endpoint still returns 200 (hits + zero persisted) and the alert list
// endpoints return 503.
//
// Skipped unless DATABASE_URL_TEST is set.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import express from "express";
import { describeIfDB, resetDB, getAuthToken } from "../setup";

// ─── Build a minimal app ──────────────────────────────────────────────────
// We cannot modify app.ts, so mount the router into a fresh express app.
async function buildTestApp(): Promise<express.Express> {
  const a = express();
  a.use(express.json());
  const { aiFraudRouter } = await import("../../routes/ai-fraud");
  a.use("/api/v1/ai/fraud", aiFraudRouter);
  // Hook in the error handler for consistent error shape.
  const { errorHandler } = await import("../../middleware/error");
  a.use(errorHandler);
  return a;
}

let app: express.Express;
let adminToken: string;
let doctorToken: string;

describeIfDB("AI Fraud API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    doctorToken = await getAuthToken("DOCTOR");
    app = await buildTestApp();
  });

  it("requires authentication on POST /scan", async () => {
    const res = await request(app).post("/api/v1/ai/fraud/scan").send({});
    expect(res.status).toBe(401);
  });

  it("rejects DOCTOR role (403) on POST /scan", async () => {
    const res = await request(app)
      .post("/api/v1/ai/fraud/scan")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("runs a scan for ADMIN and returns a structured result", async () => {
    const res = await request(app)
      .post("/api/v1/ai/fraud/scan")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ windowDays: 30 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      windowDays: 30,
      llmReview: false,
    });
    expect(typeof res.body.data.hitCount).toBe("number");
    expect(typeof res.body.data.alertCount).toBe("number");
    expect(res.body.data.scannedAt).toBeTruthy();
  });

  it("lists alerts for ADMIN (200 when model migrated, 503 otherwise)", async () => {
    const res = await request(app)
      .get("/api/v1/ai/fraud/alerts")
      .set("Authorization", `Bearer ${adminToken}`);
    // Accept either the happy-path or deferred-migration branch — both are
    // contractually correct today.
    expect([200, 503]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    } else {
      expect(res.body.error).toMatch(/FraudAlert model is not yet migrated/);
    }
  });

  it("rejects DOCTOR role (403) on GET /alerts", async () => {
    const res = await request(app)
      .get("/api/v1/ai/fraud/alerts")
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(res.status).toBe(403);
  });

  it("returns 503 or 404 for unknown alert acknowledge", async () => {
    const res = await request(app)
      .post("/api/v1/ai/fraud/alerts/non-existent-id/acknowledge")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "ACKNOWLEDGED" });
    expect([404, 503]).toContain(res.status);
  });

  it("validates status values on acknowledge", async () => {
    const res = await request(app)
      .post("/api/v1/ai/fraud/alerts/some-id/acknowledge")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "BOGUS_STATUS" });
    // 503 if model missing (returned before validation); 400 if model present.
    expect([400, 503]).toContain(res.status);
  });
});
