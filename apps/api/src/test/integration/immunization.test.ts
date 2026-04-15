// Integration tests for immunization endpoints (under the EHR router).
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken, getPrisma } from "../setup";
import { createPatientFixture } from "../factories";

let app: any;
let adminToken: string;
let doctorToken: string;
let nurseToken: string;
let receptionToken: string;

describeIfDB("Immunization API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    doctorToken = await getAuthToken("DOCTOR");
    nurseToken = await getAuthToken("NURSE");
    receptionToken = await getAuthToken("RECEPTION");
    const mod = await import("../../app");
    app = mod.app;
  });

  async function addImmunization(
    patientId: string,
    overrides: Partial<any> = {}
  ) {
    return request(app)
      .post("/api/v1/ehr/immunizations")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({
        patientId,
        vaccine: overrides.vaccine || "Hepatitis B",
        doseNumber: overrides.doseNumber ?? 1,
        dateGiven: overrides.dateGiven || "2025-03-01",
        manufacturer: overrides.manufacturer || "Serum Institute",
        batchNumber: overrides.batchNumber || "BATCH-01",
        site: overrides.site || "Left deltoid",
        nextDueDate: overrides.nextDueDate,
        ...overrides,
      });
  }

  it("nurse creates an immunization record", async () => {
    const patient = await createPatientFixture();
    const res = await addImmunization(patient.id);
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.vaccine).toBe("Hepatitis B");
    expect(res.body.data?.doseNumber).toBe(1);
  });

  it("lists immunizations for a patient", async () => {
    const patient = await createPatientFixture();
    await addImmunization(patient.id, { vaccine: "DPT 1" });
    const res = await request(app)
      .get(`/api/v1/ehr/patients/${patient.id}/immunizations`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it("requires auth (401)", async () => {
    const patient = await createPatientFixture();
    const res = await request(app).get(
      `/api/v1/ehr/patients/${patient.id}/immunizations`
    );
    expect(res.status).toBe(401);
  });

  it("rejects bad payload (400)", async () => {
    const res = await request(app)
      .post("/api/v1/ehr/immunizations")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ patientId: "not-uuid" });
    expect(res.status).toBe(400);
  });

  it("reception cannot record immunizations (403)", async () => {
    const patient = await createPatientFixture();
    const res = await request(app)
      .post("/api/v1/ehr/immunizations")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({
        patientId: patient.id,
        vaccine: "COVID",
        dateGiven: "2025-01-01",
      });
    expect(res.status).toBe(403);
  });

  it("updates an immunization record", async () => {
    const patient = await createPatientFixture();
    const create = await addImmunization(patient.id);
    const res = await request(app)
      .patch(`/api/v1/ehr/immunizations/${create.body.data.id}`)
      .set("Authorization", `Bearer ${doctorToken}`)
      .send({ notes: "No adverse reaction" });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.notes).toBe("No adverse reaction");
  });

  it("schedule endpoint filters upcoming immunizations", async () => {
    const patient = await createPatientFixture();
    const futureDue = new Date(Date.now() + 15 * 86400000)
      .toISOString()
      .slice(0, 10);
    await addImmunization(patient.id, {
      vaccine: "Booster",
      nextDueDate: futureDue,
    });
    const res = await request(app)
      .get("/api/v1/ehr/immunizations/schedule?filter=month")
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("recommended schedule respects patient DOB (pediatric)", async () => {
    const patient = await createPatientFixture({
      dateOfBirth: new Date("2024-01-01"),
    });
    const res = await request(app)
      .get(`/api/v1/ehr/patients/${patient.id}/immunizations/recommended`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data?.items?.length).toBeGreaterThan(0);
  });

  it("admin deletes an immunization (side-effect: removed)", async () => {
    const patient = await createPatientFixture();
    const create = await addImmunization(patient.id);
    const id = create.body.data.id;
    const res = await request(app)
      .delete(`/api/v1/ehr/immunizations/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect([200, 204]).toContain(res.status);

    const prisma = await getPrisma();
    const found = await prisma.immunization.findUnique({ where: { id } });
    expect(found).toBeNull();
  });

  it("lists due-only immunizations for a patient", async () => {
    const patient = await createPatientFixture();
    const res = await request(app)
      .get(`/api/v1/ehr/patients/${patient.id}/immunizations/due`)
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
