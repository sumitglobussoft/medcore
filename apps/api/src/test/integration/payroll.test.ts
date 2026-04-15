// Integration tests for the payroll + overtime endpoints (hr-ops router).
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken, getPrisma } from "../setup";
import { createUserFixture, createShiftFixture } from "../factories";

let app: any;
let adminToken: string;
let nurseToken: string;
let nurseUser: any;

describeIfDB("Payroll / Overtime API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    nurseToken = await getAuthToken("NURSE");
    const mod = await import("../../app");
    app = mod.app;
    const prisma = await getPrisma();
    nurseUser = await prisma.user.findUnique({
      where: { email: "nurse@test.local" },
    });
  });

  it("computes payroll (admin)", async () => {
    const user = await createUserFixture({ role: "NURSE" });
    const now = new Date();
    const res = await request(app)
      .post("/api/v1/hr-ops/payroll")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        userId: user.id,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        basicSalary: 30000,
        allowances: 5000,
        deductions: 2000,
        overtimeRate: 150,
      });
    expect([200, 201]).toContain(res.status);
    expect(typeof res.body.data?.net).toBe("number");
    expect(res.body.data?.gross).toBe(35000);
  });

  it("payroll with worked night shifts contributes overtime pay", async () => {
    const user = await createUserFixture({ role: "NURSE" });
    await createShiftFixture({
      userId: user.id,
      overrides: { type: "NIGHT", status: "PRESENT" },
    });
    const now = new Date();
    const res = await request(app)
      .post("/api/v1/hr-ops/payroll")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        userId: user.id,
        year: now.getFullYear(),
        month: now.getMonth() + 1,
        basicSalary: 30000,
        overtimeRate: 100,
      });
    expect(res.status).toBe(200);
    expect(res.body.data?.overtimeShifts).toBeGreaterThanOrEqual(1);
    expect(res.body.data?.overtimePay).toBeGreaterThan(0);
  });

  it("non-admin cannot compute payroll (403)", async () => {
    const res = await request(app)
      .post("/api/v1/hr-ops/payroll")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({
        userId: nurseUser.id,
        year: 2026,
        month: 4,
        basicSalary: 30000,
      });
    expect(res.status).toBe(403);
  });

  it("requires auth (401)", async () => {
    const res = await request(app).post("/api/v1/hr-ops/payroll").send({});
    expect(res.status).toBe(401);
  });

  it("rejects bad payroll payload (400)", async () => {
    const res = await request(app)
      .post("/api/v1/hr-ops/payroll")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ userId: "not-a-uuid", year: 2026, month: 14, basicSalary: -1 });
    expect(res.status).toBe(400);
  });

  it("creates an overtime record (amount computed)", async () => {
    const user = await createUserFixture({ role: "NURSE" });
    const res = await request(app)
      .post("/api/v1/hr-ops/overtime")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        userId: user.id,
        date: new Date().toISOString().slice(0, 10),
        regularHours: 8,
        overtimeHours: 3,
        hourlyRate: 200,
        overtimeRate: 1.5,
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.amount).toBe(900); // 3 * 200 * 1.5
  });

  it("approves an overtime record (side-effect: approved=true)", async () => {
    const user = await createUserFixture({ role: "NURSE" });
    const create = await request(app)
      .post("/api/v1/hr-ops/overtime")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        userId: user.id,
        date: new Date().toISOString().slice(0, 10),
        regularHours: 8,
        overtimeHours: 2,
        hourlyRate: 150,
        overtimeRate: 2,
      });
    const res = await request(app)
      .patch(`/api/v1/hr-ops/overtime/${create.body.data.id}/approve`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.approved).toBe(true);
  });

  it("lists overtime records", async () => {
    const res = await request(app)
      .get("/api/v1/hr-ops/overtime")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("nurse cannot query other users' overtime (403)", async () => {
    const other = await createUserFixture({ role: "NURSE" });
    const res = await request(app)
      .get(`/api/v1/hr-ops/overtime?userId=${other.id}`)
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(res.status).toBe(403);
  });

  it("returns attendance summary for current month", async () => {
    const res = await request(app)
      .get("/api/v1/hr-ops/attendance")
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data?.byStatus).toBeTruthy();
  });

  it("payslip requires valid month format (400)", async () => {
    const res = await request(app)
      .get(`/api/v1/hr-ops/payroll/${nurseUser.id}/slip?month=BAD`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});
