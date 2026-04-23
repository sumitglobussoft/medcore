// Integration tests for the AI Coaching router (/api/v1/ai/coaching).
// Pure DB-backed — no LLM calls in Phase 1 scaffold.
// Skipped unless DATABASE_URL_TEST is set.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken } from "../setup";
import { createPatientFixture, createDoctorWithToken } from "../factories";
import jwt from "jsonwebtoken";

let app: any;
let adminToken: string;

function signPatientToken(userId: string): string {
  return jwt.sign(
    { userId, email: "p@test.local", role: "PATIENT" },
    process.env.JWT_SECRET || "test-jwt-secret-do-not-use-in-prod",
    { expiresIn: "1h" }
  );
}

describeIfDB("AI Coaching API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    const mod = await import("../../app");
    app = mod.app;
  });

  // ─── POST /enroll ──────────────────────────────────────────────────────

  it("enrolls a patient in a chronic care plan (happy path)", async () => {
    const patient = await createPatientFixture();
    const { token: doctorToken } = await createDoctorWithToken();

    const res = await request(app)
      .post("/api/v1/ai/coaching/enroll")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        patientId: patient.id,
        condition: "HYPERTENSION",
        checkInFrequencyDays: 7,
        thresholds: { bpSystolic: 160, bpDiastolic: 100 },
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.condition).toBe("HYPERTENSION");
    expect(res.body.data.checkInFrequencyDays).toBe(7);
    expect(res.body.data.active).toBe(true);
  });

  it("rejects PATIENT role for enroll", async () => {
    const patient = await createPatientFixture();
    const token = signPatientToken(patient.userId);

    const res = await request(app)
      .post("/api/v1/ai/coaching/enroll")
      .set("Authorization", `Bearer ${token}`)
      .send({
        patientId: patient.id,
        condition: "DIABETES",
        checkInFrequencyDays: 3,
        thresholds: {},
      });

    expect(res.status).toBe(403);
  });

  it("validates condition and frequency inputs", async () => {
    const patient = await createPatientFixture();
    const { token: doctorToken } = await createDoctorWithToken();

    const badCondition = await request(app)
      .post("/api/v1/ai/coaching/enroll")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        patientId: patient.id,
        condition: "CHOLERA",
        checkInFrequencyDays: 3,
      });
    expect(badCondition.status).toBe(400);

    const badFreq = await request(app)
      .post("/api/v1/ai/coaching/enroll")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        patientId: patient.id,
        condition: "DIABETES",
        checkInFrequencyDays: 5,
      });
    expect(badFreq.status).toBe(400);
  });

  // ─── GET /plans/:patientId ─────────────────────────────────────────────

  it("lets a patient see only their own plans", async () => {
    const patient = await createPatientFixture();
    const { token: doctorToken } = await createDoctorWithToken();
    const patientToken = signPatientToken(patient.userId);

    await request(app)
      .post("/api/v1/ai/coaching/enroll")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        patientId: patient.id,
        condition: "ASTHMA",
        checkInFrequencyDays: 1,
        thresholds: { pefr: 300 },
      });

    const res = await request(app)
      .get(`/api/v1/ai/coaching/plans/${patient.id}`)
      .set("Authorization", `Bearer ${patientToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].patientId).toBe(patient.id);
  });

  it("forbids a patient from viewing another patient's plans", async () => {
    const patientA = await createPatientFixture();
    const patientB = await createPatientFixture();
    const { token: doctorToken } = await createDoctorWithToken();
    const tokenB = signPatientToken(patientB.userId);

    await request(app)
      .post("/api/v1/ai/coaching/enroll")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        patientId: patientA.id,
        condition: "DIABETES",
        checkInFrequencyDays: 7,
      });

    const res = await request(app)
      .get(`/api/v1/ai/coaching/plans/${patientA.id}`)
      .set("Authorization", `Bearer ${tokenB}`);

    expect(res.status).toBe(403);
  });

  // ─── POST /plans/:id/check-in ──────────────────────────────────────────

  it("logs a check-in with NO breach when responses are under thresholds", async () => {
    const patient = await createPatientFixture();
    const { token: doctorToken } = await createDoctorWithToken();
    const patientToken = signPatientToken(patient.userId);

    const plan = await request(app)
      .post("/api/v1/ai/coaching/enroll")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        patientId: patient.id,
        condition: "HYPERTENSION",
        checkInFrequencyDays: 7,
        thresholds: { bpSystolic: 160 },
      });

    const res = await request(app)
      .post(`/api/v1/ai/coaching/plans/${plan.body.data.id}/check-in`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        responses: { bpSystolic: 130, bpDiastolic: 85 },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.checkIn).toBeTruthy();
    expect(res.body.data.alert).toBeNull();
  });

  it("creates a ChronicCareAlert when thresholds are breached", async () => {
    const patient = await createPatientFixture();
    const { token: doctorToken } = await createDoctorWithToken();
    const patientToken = signPatientToken(patient.userId);

    const plan = await request(app)
      .post("/api/v1/ai/coaching/enroll")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        patientId: patient.id,
        condition: "DIABETES",
        checkInFrequencyDays: 1,
        thresholds: { bgFasting: 180 },
      });

    const res = await request(app)
      .post(`/api/v1/ai/coaching/plans/${plan.body.data.id}/check-in`)
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        responses: { bgFasting: 220 },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.alert).toBeTruthy();
    expect(res.body.data.alert.severity).toBe("MEDIUM");
    expect(res.body.data.alert.reason).toMatch(/bgFasting/);
  });

  it("forbids a patient from checking in on another patient's plan", async () => {
    const patientA = await createPatientFixture();
    const patientB = await createPatientFixture();
    const { token: doctorToken } = await createDoctorWithToken();
    const tokenB = signPatientToken(patientB.userId);

    const plan = await request(app)
      .post("/api/v1/ai/coaching/enroll")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        patientId: patientA.id,
        condition: "TB",
        checkInFrequencyDays: 1,
      });

    const res = await request(app)
      .post(`/api/v1/ai/coaching/plans/${plan.body.data.id}/check-in`)
      .set("Authorization", `Bearer ${tokenB}`)
      .send({ responses: { cough: 1 } });

    expect(res.status).toBe(403);
  });
});
