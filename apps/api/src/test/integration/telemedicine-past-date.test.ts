// Issue #93 (2026-04-26) — telemedicine must reject scheduling a session
// in the past with a 400. Both layers (shared Zod schema, server route)
// enforce this; this test exercises the server route end-to-end so a
// regression there is caught even if the Zod refinement is bypassed.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken } from "../setup";
import { createPatientFixture, createDoctorFixture } from "../factories";

let app: any;
let adminToken: string;

describeIfDB("Telemedicine — past-date rejection (Issue #93)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    const mod = await import("../../app");
    app = mod.app;
  });

  it("rejects scheduledAt = yesterday with 400 + clear message", async () => {
    const patient = await createPatientFixture();
    const doctor = await createDoctorFixture();
    const yesterday = new Date(Date.now() - 24 * 3600_000).toISOString();

    const res = await request(app)
      .post("/api/v1/telemedicine")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        patientId: patient.id,
        doctorId: doctor.id,
        scheduledAt: yesterday,
        chiefComplaint: "Fever",
        fee: 500,
      });

    expect(res.status).toBe(400);
    // Must surface a message a UI can show as a toast — avoid leaking
    // internal stack traces.
    const errBody = JSON.stringify(res.body);
    expect(errBody.toLowerCase()).toMatch(/past|future|scheduledat/);
  });

  it("rejects scheduledAt = ten years ago with 400", async () => {
    const patient = await createPatientFixture();
    const doctor = await createDoctorFixture();
    const tenYearsAgo = new Date("2016-01-01T10:00:00.000Z").toISOString();

    const res = await request(app)
      .post("/api/v1/telemedicine")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        patientId: patient.id,
        doctorId: doctor.id,
        scheduledAt: tenYearsAgo,
        chiefComplaint: "Followup",
        fee: 500,
      });

    expect(res.status).toBe(400);
  });

  it("accepts scheduledAt one hour from now with 201", async () => {
    const patient = await createPatientFixture();
    const doctor = await createDoctorFixture();
    const future = new Date(Date.now() + 3600_000).toISOString();

    const res = await request(app)
      .post("/api/v1/telemedicine")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        patientId: patient.id,
        doctorId: doctor.id,
        scheduledAt: future,
        chiefComplaint: "Fever",
        fee: 500,
      });

    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.status).toBe("SCHEDULED");
  });
});
