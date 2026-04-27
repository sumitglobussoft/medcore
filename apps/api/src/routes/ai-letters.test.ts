/**
 * Issue #100 — AI Letters: regression test for the missing
 * `GET /api/v1/ai/scribe` list endpoint.
 *
 * The web AI Letters page picks a Scribe Session via the shared
 * EntityPicker (`endpoint="/ai/scribe"`). With no list endpoint the
 * picker hit a 404 and the page was permanently broken. The new GET /
 * handler returns finalised sessions in the standard envelope so the
 * picker can populate.
 *
 * Also exercises the happy path of `POST /api/v1/ai/letters/referral`
 * to confirm the call chain end-to-end (no 500 / 404).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const { prismaMock } = vi.hoisted(() => {
  const base: any = {
    aIScribeSession: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    auditLog: { create: vi.fn(async () => ({ id: "al-1" })) },
  };
  return { prismaMock: base };
});

vi.mock("@medcore/db", () => ({ prisma: prismaMock }));
vi.mock("../services/tenant-prisma", () => ({
  tenantScopedPrisma: prismaMock,
}));
vi.mock("../services/ai/letter-generator", () => ({
  generateReferralLetter: vi.fn(async () => "Dear Dr. ___,\n\nGenerated letter."),
  generateDischargeSummary: vi.fn(async () => "Discharge summary text."),
}));
vi.mock("../services/ai/sarvam", () => ({
  generateSOAPNote: vi.fn(),
}));
vi.mock("../services/ai/drug-interactions", () => ({
  checkDrugSafety: vi.fn(),
}));
vi.mock("../services/ai/rag-ingest", () => ({
  ingestConsultation: vi.fn(),
  fireAndForgetIngest: vi.fn(),
}));
vi.mock("../services/notification", () => ({
  sendNotification: vi.fn(),
}));

import { aiLettersRouter } from "./ai-letters";
import { aiScribeRouter } from "./ai-scribe";

function tokenFor(role: string): string {
  process.env.JWT_SECRET = "test-secret";
  return jwt.sign(
    { userId: "u-test", email: "u@test.local", role },
    "test-secret"
  );
}

function buildApp() {
  process.env.JWT_SECRET = "test-secret";
  process.env.NODE_ENV = "test";
  const app = express();
  app.use(express.json());
  app.use("/api/v1/ai/scribe", aiScribeRouter);
  app.use("/api/v1/ai/letters", aiLettersRouter);
  return app;
}

describe("AI Letters — Issue #100 regression", () => {
  beforeEach(() => {
    prismaMock.aIScribeSession.findMany.mockReset();
    prismaMock.aIScribeSession.findUnique.mockReset();
  });

  it("GET /api/v1/ai/scribe returns the picker-friendly list (no 404)", async () => {
    prismaMock.aIScribeSession.findMany.mockResolvedValueOnce([
      {
        id: "ses-1",
        status: "COMPLETED",
        appointmentId: "appt-1",
        createdAt: new Date("2026-04-25T10:00:00Z"),
        appointment: {
          id: "appt-1",
          patient: {
            id: "p-1",
            user: { name: "Asha Kumari" },
          },
        },
      },
    ]);
    const app = buildApp();
    const res = await request(app)
      .get("/api/v1/ai/scribe?search=Asha&limit=10")
      .set("Authorization", `Bearer ${tokenFor("DOCTOR")}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data[0].id).toBe("ses-1");
    expect(res.body.data[0].patient.user.name).toBe("Asha Kumari");
  });

  it("POST /api/v1/ai/letters/referral happy path returns generated letter", async () => {
    prismaMock.aIScribeSession.findUnique.mockResolvedValueOnce({
      id: "ses-1",
      soapFinal: {
        subjective: { hpi: "2-day fever" },
        assessment: { impression: "Viral fever, likely" },
        plan: { medications: [{ name: "Paracetamol 500mg" }] },
      },
      appointment: {
        id: "appt-1",
        patient: { age: 30, gender: "MALE", user: { name: "Asha Kumari" } },
        doctor: { user: { name: "Dr Rao" } },
      },
    });
    const app = buildApp();
    const res = await request(app)
      .post("/api/v1/ai/letters/referral")
      .set("Authorization", `Bearer ${tokenFor("DOCTOR")}`)
      .send({
        scribeSessionId: "ses-1",
        toSpecialty: "Cardiologist",
        urgency: "ROUTINE",
      });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.letter).toContain("Generated letter");
  });
});
