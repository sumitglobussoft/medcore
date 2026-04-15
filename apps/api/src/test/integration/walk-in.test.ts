// Integration tests focused on walk-in registration flow.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken } from "../setup";
import { createPatientFixture, createDoctorFixture } from "../factories";

let app: any;
let receptionToken: string;
let patientToken: string;

describeIfDB("Walk-in API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    receptionToken = await getAuthToken("RECEPTION");
    patientToken = await getAuthToken("PATIENT");
    const mod = await import("../../app");
    app = mod.app;
  });

  it("401 without token", async () => {
    const res = await request(app)
      .post("/api/v1/appointments/walk-in")
      .send({});
    expect(res.status).toBe(401);
  });

  it("registers a walk-in with default NORMAL priority", async () => {
    const patient = await createPatientFixture();
    const doctor = await createDoctorFixture();
    const res = await request(app)
      .post("/api/v1/appointments/walk-in")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({ patientId: patient.id, doctorId: doctor.id });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.type).toBe("WALK_IN");
    expect(res.body.data?.priority).toBe("NORMAL");
    expect(res.body.data?.status).toBe("BOOKED");
  });

  it("registers a walk-in with EMERGENCY priority", async () => {
    const patient = await createPatientFixture();
    const doctor = await createDoctorFixture();
    const res = await request(app)
      .post("/api/v1/appointments/walk-in")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({
        patientId: patient.id,
        doctorId: doctor.id,
        priority: "EMERGENCY",
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.priority).toBe("EMERGENCY");
  });

  it("assigns sequential token numbers for same doctor on same day", async () => {
    const doctor = await createDoctorFixture();
    const p1 = await createPatientFixture();
    const p2 = await createPatientFixture();
    const r1 = await request(app)
      .post("/api/v1/appointments/walk-in")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({ patientId: p1.id, doctorId: doctor.id });
    const r2 = await request(app)
      .post("/api/v1/appointments/walk-in")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({ patientId: p2.id, doctorId: doctor.id });
    expect([200, 201]).toContain(r1.status);
    expect([200, 201]).toContain(r2.status);
    expect(r2.body.data.tokenNumber).toBe(r1.body.data.tokenNumber + 1);
  });

  it("rejects malformed payload (non-uuid patientId)", async () => {
    const doctor = await createDoctorFixture();
    const res = await request(app)
      .post("/api/v1/appointments/walk-in")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({ patientId: "not-a-uuid", doctorId: doctor.id });
    expect(res.status).toBe(400);
  });

  it("rejects unknown priority (400)", async () => {
    const patient = await createPatientFixture();
    const doctor = await createDoctorFixture();
    const res = await request(app)
      .post("/api/v1/appointments/walk-in")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({
        patientId: patient.id,
        doctorId: doctor.id,
        priority: "WHENEVER",
      });
    expect(res.status).toBe(400);
  });

  it("rejects PATIENT role (403)", async () => {
    const patient = await createPatientFixture();
    const doctor = await createDoctorFixture();
    const res = await request(app)
      .post("/api/v1/appointments/walk-in")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({ patientId: patient.id, doctorId: doctor.id });
    expect(res.status).toBe(403);
  });

  it("walk-in appointment is date-stamped today", async () => {
    const patient = await createPatientFixture();
    const doctor = await createDoctorFixture();
    const res = await request(app)
      .post("/api/v1/appointments/walk-in")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({ patientId: patient.id, doctorId: doctor.id });
    expect([200, 201]).toContain(res.status);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const apptDate = new Date(res.body.data.date);
    apptDate.setHours(0, 0, 0, 0);
    expect(apptDate.getTime()).toBe(today.getTime());
  });
});
