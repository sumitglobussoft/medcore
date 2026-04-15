// Integration tests for Operating Theater (OT) endpoints under /api/v1/surgery/ots.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken, getPrisma } from "../setup";
import {
  createOperatingTheaterFixture,
  createPatientFixture,
  createDoctorFixture,
} from "../factories";

let app: any;
let adminToken: string;
let patientToken: string;
let doctorToken: string;

describeIfDB("Operating Theater (OT) API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    patientToken = await getAuthToken("PATIENT");
    doctorToken = await getAuthToken("DOCTOR");
    const mod = await import("../../app");
    app = mod.app;
  });

  it("401 without token on list OTs", async () => {
    const res = await request(app).get("/api/v1/surgery/ots");
    expect(res.status).toBe(401);
  });

  it("lists active OTs", async () => {
    await createOperatingTheaterFixture();
    const res = await request(app)
      .get("/api/v1/surgery/ots")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("creates an OT (ADMIN)", async () => {
    const res = await request(app)
      .post("/api/v1/surgery/ots")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: `OT-${Date.now()}`,
        floor: "4",
        dailyRate: 5000,
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.name).toMatch(/^OT-/);
  });

  it("rejects OT create from PATIENT (403)", async () => {
    const res = await request(app)
      .post("/api/v1/surgery/ots")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ name: `OT-${Date.now()}` });
    expect(res.status).toBe(403);
  });

  it("rejects OT create with empty name (400)", async () => {
    const res = await request(app)
      .post("/api/v1/surgery/ots")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "", dailyRate: 100 });
    expect(res.status).toBe(400);
  });

  it("updates OT (dailyRate + isActive) — ADMIN", async () => {
    const ot = await createOperatingTheaterFixture();
    const res = await request(app)
      .patch(`/api/v1/surgery/ots/${ot.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ dailyRate: 7500, isActive: false });
    expect([200, 201]).toContain(res.status);
    const prisma = await getPrisma();
    const row = await prisma.operatingTheater.findUnique({ where: { id: ot.id } });
    expect(row?.dailyRate).toBe(7500);
    expect(row?.isActive).toBe(false);
  });

  it("OT schedule endpoint returns list (empty or full) for a date", async () => {
    const ot = await createOperatingTheaterFixture();
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/v1/surgery/ots/${ot.id}/schedule?date=${today}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("surgery schedule on inactive OT returns 409", async () => {
    const ot = await createOperatingTheaterFixture({ isActive: false });
    const patient = await createPatientFixture();
    const doctor = await createDoctorFixture();
    const res = await request(app)
      .post("/api/v1/surgery")
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({
        patientId: patient.id,
        surgeonId: doctor.id,
        otId: ot.id,
        procedure: "Appendectomy",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(res.status).toBe(409);
  });

  it("schedules a surgery on active OT (ADMIN/DOCTOR)", async () => {
    const ot = await createOperatingTheaterFixture();
    const patient = await createPatientFixture();
    const doctor = await createDoctorFixture();
    const res = await request(app)
      .post("/api/v1/surgery")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        patientId: patient.id,
        surgeonId: doctor.id,
        otId: ot.id,
        procedure: "Hernia Repair",
        scheduledAt: new Date(Date.now() + 86400000).toISOString(),
        durationMin: 60,
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.caseNumber).toMatch(/^SRG/);
    expect(res.body.data?.status).toBe("SCHEDULED");
  });
});
