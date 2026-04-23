// Integration tests for the AI Symptom Diary router (/api/v1/ai/symptom-diary).
// Analyzer is mocked — no SARVAM_API_KEY required.
// Skipped unless DATABASE_URL_TEST is set.
import { it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken } from "../setup";
import { createPatientFixture } from "../factories";
import jwt from "jsonwebtoken";

vi.mock("../../services/ai/symptom-diary", async () => {
  const actual = await vi.importActual<any>("../../services/ai/symptom-diary");
  return {
    ...actual,
    analyzeSymptomTrends: vi.fn().mockResolvedValue({
      trends: [
        {
          symptom: "headache",
          direction: "worsening",
          averageSeverity: 6.5,
          peakSeverity: 9,
        },
      ],
      followUpRecommended: true,
      reasoning: "Headache severity trending up over the last week.",
    }),
  };
});

let app: any;
let adminToken: string;

function signPatientToken(userId: string): string {
  return jwt.sign(
    { userId, email: "p@test.local", role: "PATIENT" },
    process.env.JWT_SECRET || "test-jwt-secret-do-not-use-in-prod",
    { expiresIn: "1h" }
  );
}

describeIfDB("AI Symptom Diary API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    const mod = await import("../../app");
    app = mod.app;
  });

  // ─── POST / ────────────────────────────────────────────────────────────

  it("lets a patient log a diary entry (happy path)", async () => {
    const patient = await createPatientFixture();
    const token = signPatientToken(patient.userId);

    const res = await request(app)
      .post("/api/v1/ai/symptom-diary")
      .set("Authorization", `Bearer ${token}`)
      .send({
        symptomDate: new Date().toISOString(),
        entries: [
          { symptom: "headache", severity: 7, notes: "Front of head" },
          { symptom: "nausea", severity: 4 },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.patientId).toBe(patient.id);
    expect(Array.isArray(res.body.data.entries)).toBe(true);
    expect(res.body.data.entries.length).toBe(2);
  });

  it("rejects a DOCTOR role — endpoint is PATIENT-only", async () => {
    const res = await request(app)
      .post("/api/v1/ai/symptom-diary")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        symptomDate: new Date().toISOString(),
        entries: [{ symptom: "headache", severity: 5 }],
      });

    expect(res.status).toBe(403);
  });

  it("validates entry shape (severity must be 1-10)", async () => {
    const patient = await createPatientFixture();
    const token = signPatientToken(patient.userId);

    const res = await request(app)
      .post("/api/v1/ai/symptom-diary")
      .set("Authorization", `Bearer ${token}`)
      .send({
        symptomDate: new Date().toISOString(),
        entries: [{ symptom: "headache", severity: 15 }],
      });

    expect(res.status).toBe(400);
  });

  // ─── GET / ─────────────────────────────────────────────────────────────

  it("returns only the calling patient's entries", async () => {
    const patientA = await createPatientFixture();
    const patientB = await createPatientFixture();
    const tokenA = signPatientToken(patientA.userId);
    const tokenB = signPatientToken(patientB.userId);

    // Patient A logs an entry
    await request(app)
      .post("/api/v1/ai/symptom-diary")
      .set("Authorization", `Bearer ${tokenA}`)
      .send({
        symptomDate: new Date().toISOString(),
        entries: [{ symptom: "cough", severity: 3 }],
      });

    // Patient B logs an entry
    await request(app)
      .post("/api/v1/ai/symptom-diary")
      .set("Authorization", `Bearer ${tokenB}`)
      .send({
        symptomDate: new Date().toISOString(),
        entries: [{ symptom: "fever", severity: 6 }],
      });

    const res = await request(app)
      .get("/api/v1/ai/symptom-diary")
      .set("Authorization", `Bearer ${tokenA}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((e: any) => e.patientId === patientA.id)).toBe(true);
    // Should contain at least A's cough entry
    expect(
      res.body.data.some((e: any) =>
        (e.entries as any[]).some((item) => item.symptom === "cough")
      )
    ).toBe(true);
  });

  // ─── POST /analyze ─────────────────────────────────────────────────────

  it("runs trend analysis and persists on the latest entry", async () => {
    const patient = await createPatientFixture();
    const token = signPatientToken(patient.userId);

    // Log at least one entry so analysis has something to look at
    const logged = await request(app)
      .post("/api/v1/ai/symptom-diary")
      .set("Authorization", `Bearer ${token}`)
      .send({
        symptomDate: new Date().toISOString(),
        entries: [{ symptom: "headache", severity: 8 }],
      });
    expect(logged.status).toBe(201);

    const res = await request(app)
      .post("/api/v1/ai/symptom-diary/analyze")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.followUpRecommended).toBe(true);
    expect(Array.isArray(res.body.data.trends)).toBe(true);
    expect(res.body.data.trends[0].symptom).toBe("headache");
  });

  it("returns 400 when analyzing with no diary entries yet", async () => {
    const patient = await createPatientFixture();
    const token = signPatientToken(patient.userId);

    const res = await request(app)
      .post("/api/v1/ai/symptom-diary/analyze")
      .set("Authorization", `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no diary entries/i);
  });
});
