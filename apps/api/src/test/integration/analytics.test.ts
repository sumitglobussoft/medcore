// Integration tests for analytics router.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken } from "../setup";
import {
  createPatientFixture,
  createDoctorFixture,
  createAppointmentFixture,
  createInvoiceFixture,
} from "../factories";

let app: any;
let adminToken: string;

async function seedSomeData() {
  const patient = await createPatientFixture();
  const doctor = await createDoctorFixture();
  const appt = await createAppointmentFixture({
    patientId: patient.id,
    doctorId: doctor.id,
    overrides: { status: "COMPLETED" },
  });
  await createInvoiceFixture({
    patientId: patient.id,
    appointmentId: appt.id,
    overrides: { paymentStatus: "PAID" },
  });
}

describeIfDB("Analytics API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    const mod = await import("../../app");
    app = mod.app;
    await seedSomeData();
  });

  it("returns overview", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/overview")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeTruthy();
  });

  it("returns overview with period query (month)", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/overview?period=month")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("returns revenue analytics", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/revenue")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("returns revenue breakdown", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/revenue/breakdown")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("returns appointments stats", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/appointments")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("returns no-show analysis", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/appointments/no-show-rate")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("returns patient retention metrics", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/patients/retention")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("returns patient growth", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/patients/growth")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("returns ER performance", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/er/performance")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("returns IPD occupancy", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/ipd/occupancy")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it("exports revenue as CSV (text/csv)", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/export/revenue.csv")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/csv/i);
  });

  it("exports appointments as CSV", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/export/appointments.csv")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/csv/i);
  });

  it("exports patients as CSV", async () => {
    const res = await request(app)
      .get("/api/v1/analytics/export/patients.csv")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/csv/i);
  });

  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/api/v1/analytics/overview");
    expect(res.status).toBe(401);
  });

  // Regression guard for Issue #48 (2026-04-24): the admin-console Today
  // Snapshot was stuck at "Registered: 0" because /analytics/overview
  // returned `newPatientsInPeriod` but the widget read `newPatients`, and
  // `admissions/discharges/surgeries/erCases` weren't returned at all.
  // Assert each key exists and that `newPatients` equals the actual count
  // of Patient rows whose user.createdAt falls in the period.
  it("Issue #48: overview exposes newPatients and matches Patient createdAt", async () => {
    // Seed a patient "today" (local TZ) so the count is non-zero and
    // deterministic enough to assert on.
    const fresh = await createPatientFixture();

    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      23,
      59,
      59,
      999
    );

    const res = await request(app)
      .get(
        `/api/v1/analytics/overview?from=${start.toISOString()}&to=${end.toISOString()}`
      )
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const data = res.body.data as Record<string, unknown>;

    // All Today-Snapshot keys must be present (not undefined) — otherwise
    // the widget silently renders "0".
    expect(data).toHaveProperty("newPatients");
    expect(data).toHaveProperty("newPatientsInPeriod");
    expect(data).toHaveProperty("admissions");
    expect(data).toHaveProperty("discharges");
    expect(data).toHaveProperty("surgeries");
    expect(data).toHaveProperty("erCases");

    // Cross-check: API count === DB count for the same window.
    const { getPrisma } = await import("../setup");
    const prisma = await getPrisma();
    const dbCount = await prisma.patient.count({
      where: { user: { createdAt: { gte: start, lte: end } } },
    });
    expect(data.newPatients).toBe(dbCount);
    expect(data.newPatients).toBe(data.newPatientsInPeriod);
    // The freshly seeded patient MUST be in the count.
    expect((data.newPatients as number) >= 1).toBe(true);
    expect(fresh.id).toBeTruthy();
  });
});
