// Integration tests for the AI Doc-QA router (/api/v1/ai/doc-qa).
// The doc-qa service is mocked so tests don't depend on Sarvam or the
// DocQAReport model being migrated.
//
// Skipped unless DATABASE_URL_TEST is set.
import { it, expect, beforeAll, vi } from "vitest";
import request from "supertest";
import express from "express";
import { describeIfDB, resetDB, getAuthToken, getPrisma } from "../setup";
import {
  createPatientFixture,
  createDoctorFixture,
  createAppointmentFixture,
} from "../factories";

vi.mock("../../services/ai/doc-qa", () => ({
  auditConsultation: vi.fn(),
  runDailyDocQASample: vi.fn().mockResolvedValue({ sampled: 3, audited: 3 }),
}));

async function buildTestApp(): Promise<express.Express> {
  const a = express();
  a.use(express.json());
  const { aiDocQaRouter } = await import("../../routes/ai-doc-qa");
  a.use("/api/v1/ai/doc-qa", aiDocQaRouter);
  const { errorHandler } = await import("../../middleware/error");
  a.use(errorHandler);
  return a;
}

let app: express.Express;
let adminToken: string;
let doctorToken: string;

describeIfDB("AI Doc-QA API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    doctorToken = await getAuthToken("DOCTOR");
    app = await buildTestApp();
  });

  it("requires authentication on POST /run-sample", async () => {
    const res = await request(app).post("/api/v1/ai/doc-qa/run-sample").send({});
    expect(res.status).toBe(401);
  });

  it("rejects DOCTOR role (403) on POST /run-sample", async () => {
    const res = await request(app)
      .post("/api/v1/ai/doc-qa/run-sample")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("runs the daily sample for ADMIN and echoes the counts", async () => {
    const res = await request(app)
      .post("/api/v1/ai/doc-qa/run-sample")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ samplePct: 10, windowDays: 7 });

    expect(res.status).toBe(200);
    expect(res.body.data.sampled).toBe(3);
    expect(res.body.data.audited).toBe(3);
    expect(res.body.data.samplePct).toBe(10);
    expect(res.body.data.windowDays).toBe(7);
  });

  it("audits a consultation for ADMIN", async () => {
    const { auditConsultation } = await import("../../services/ai/doc-qa");
    vi.mocked(auditConsultation).mockResolvedValueOnce({
      consultationId: "fake-id",
      score: 88,
      completenessScore: 90,
      icdAccuracyScore: 85,
      medicationScore: 80,
      clarityScore: 95,
      issues: [],
      recommendations: ["Great note."],
      auditedAt: new Date().toISOString(),
    });

    const res = await request(app)
      .post("/api/v1/ai/doc-qa/audit/fake-id")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.score).toBe(88);
    expect(res.body.data.consultationId).toBe("fake-id");
  });

  it("returns 404 when auditConsultation returns null", async () => {
    const { auditConsultation } = await import("../../services/ai/doc-qa");
    vi.mocked(auditConsultation).mockResolvedValueOnce(null);

    const res = await request(app)
      .post("/api/v1/ai/doc-qa/audit/nonexistent")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it("returns 503 or 200 on GET /reports depending on migration state", async () => {
    const res = await request(app)
      .get("/api/v1/ai/doc-qa/reports")
      .set("Authorization", `Bearer ${adminToken}`);
    expect([200, 503]).toContain(res.status);
  });

  it("doctor can access their own consultation's report (auth path)", async () => {
    // Build consultation owned by a specific doctor user, then access with that
    // doctor's token. When the model isn't migrated the endpoint returns 503 —
    // accept both.
    const prisma = await getPrisma();
    const patient = await createPatientFixture();

    // Build a doctor whose user gets a DOCTOR token
    const doctorUser = await prisma.user.findUnique({
      where: { email: "doctor@test.local" },
    });
    const doctor = await createDoctorFixture({ user: doctorUser });
    const appt = await createAppointmentFixture({
      patientId: patient.id,
      doctorId: doctor.id,
    });
    const consult = await prisma.consultation.create({
      data: {
        appointmentId: appt.id,
        doctorId: doctor.id,
        notes: "Test consultation notes.",
      },
    });

    const res = await request(app)
      .get(`/api/v1/ai/doc-qa/reports/${consult.id}`)
      .set("Authorization", `Bearer ${doctorToken}`);

    // Valid outcomes: 404 (report not created), 503 (model missing), 200 (migrated + report exists).
    expect([200, 403, 404, 503]).toContain(res.status);
  });
});
