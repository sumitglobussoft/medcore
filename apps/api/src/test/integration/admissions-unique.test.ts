// Integration tests for Issue #37 — one ACTIVE admission per patient.
//
// Asserts the service-layer guard:
//   1. POST /admissions for a patient that already has ADMITTED status → 409.
//   2. Discharge the first, admit the second → 201.
//   3. Cross-patient concurrency does NOT collide.
// Also includes the "validate current data" sweep expected by the ticket.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken, getPrisma } from "../setup";
import {
  createPatientFixture,
  createDoctorFixture,
  createWardFixture,
  createBedFixture,
} from "../factories";

let app: any;
let adminToken: string;

async function setupTwoBeds() {
  const patient = await createPatientFixture();
  const doctor = await createDoctorFixture();
  const ward = await createWardFixture();
  const bedA = await createBedFixture({ wardId: ward.id });
  const bedB = await createBedFixture({ wardId: ward.id });
  return { patient, doctor, ward, bedA, bedB };
}

describeIfDB("Admissions uniqueness (Issue #37)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    const mod = await import("../../app");
    app = mod.app;
  });

  it("rejects a second ACTIVE admission for the same patient with 409", async () => {
    const { patient, doctor, bedA, bedB } = await setupTwoBeds();

    const first = await request(app)
      .post("/api/v1/admissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        patientId: patient.id,
        doctorId: doctor.id,
        bedId: bedA.id,
        reason: "Primary admission",
      });
    expect([200, 201]).toContain(first.status);

    const second = await request(app)
      .post("/api/v1/admissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        patientId: patient.id,
        doctorId: doctor.id,
        bedId: bedB.id,
        reason: "Attempted duplicate",
      });
    expect(second.status).toBe(409);
    expect(second.body.error).toMatch(/active admission/i);
    expect(second.body.existingAdmission?.id).toBeTruthy();

    // The second bed MUST remain AVAILABLE — the 409 must short-circuit
    // before any bed mutation happens.
    const prisma = await getPrisma();
    const bedBAfter = await prisma.bed.findUnique({ where: { id: bedB.id } });
    expect(bedBAfter?.status).toBe("AVAILABLE");
  });

  it("allows a new admission once the previous one is discharged", async () => {
    const { patient, doctor, bedA, bedB } = await setupTwoBeds();

    const first = await request(app)
      .post("/api/v1/admissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        patientId: patient.id,
        doctorId: doctor.id,
        bedId: bedA.id,
        reason: "First stay",
      });
    expect([200, 201]).toContain(first.status);

    const dischargeRes = await request(app)
      .patch(`/api/v1/admissions/${first.body.data.id}/discharge`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        dischargeSummary: "Recovered, sent home.",
        forceDischarge: true,
        conditionAtDischarge: "STABLE",
        dischargeMedications: "PCM 500mg",
        followUpInstructions: "Review in 1wk",
      });
    expect([200, 201]).toContain(dischargeRes.status);

    const second = await request(app)
      .post("/api/v1/admissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        patientId: patient.id,
        doctorId: doctor.id,
        bedId: bedB.id,
        reason: "Readmission next month",
      });
    expect([200, 201]).toContain(second.status);
    expect(second.body.data?.status).toBe("ADMITTED");
  });

  it("does NOT block distinct patients from being admitted concurrently", async () => {
    const { patient: p1, doctor, bedA } = await setupTwoBeds();
    const p2 = await createPatientFixture();
    const ward = await createWardFixture();
    const bedC = await createBedFixture({ wardId: ward.id });

    const res1 = await request(app)
      .post("/api/v1/admissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        patientId: p1.id,
        doctorId: doctor.id,
        bedId: bedA.id,
        reason: "P1",
      });
    expect([200, 201]).toContain(res1.status);

    const res2 = await request(app)
      .post("/api/v1/admissions")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        patientId: p2.id,
        doctorId: doctor.id,
        bedId: bedC.id,
        reason: "P2",
      });
    expect([200, 201]).toContain(res2.status);
  });

  it("invariant: no patient in the DB has 2+ ACTIVE admissions after this suite", async () => {
    const prisma = await getPrisma();
    const dupes = await prisma.admission.groupBy({
      by: ["patientId"],
      where: { status: "ADMITTED" },
      _count: { _all: true },
      having: { patientId: { _count: { gt: 1 } } },
    });
    expect(dupes).toEqual([]);
  });
});
