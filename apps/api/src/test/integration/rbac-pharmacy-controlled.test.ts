// Issue #98 — RBAC tightening for pharmacy + controlled-substance + expenses.
//
// The fix from #89 only covered DOCTOR. RECEPTION still had:
//   * write+read on /pharmacy/inventory (stock-level visibility)
//   * full read on /controlled-substances/* (Schedule H/H1/X is regulated)
//   * read on /expenses (staff-salary leak)
//
// These tests assert that RECEPTION now gets 403 on each route, and that
// the still-allowed roles (PHARMACIST, DOCTOR, NURSE, ADMIN) keep working.
//
// Mirrors the pattern of rbac-hardening.test.ts (issue #89 + #90) so the
// reader sees the next layer in the evolving role/route matrix.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken } from "../setup";

let app: any;
let adminToken: string;
let doctorToken: string;
let receptionToken: string;
let nurseToken: string;
let pharmacistToken: string;

describeIfDB("RBAC tightening — issue #98 (RECEPTION over-access)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    doctorToken = await getAuthToken("DOCTOR");
    receptionToken = await getAuthToken("RECEPTION");
    nurseToken = await getAuthToken("NURSE");
    pharmacistToken = await getAuthToken("PHARMACIST");
    const mod = await import("../../app");
    app = mod.app;
  });

  // ─── Pharmacy inventory READS — RECEPTION must NOT see stock levels ───

  it("RECEPTION cannot GET /pharmacy/inventory (403)", async () => {
    const res = await request(app)
      .get("/api/v1/pharmacy/inventory")
      .set("Authorization", `Bearer ${receptionToken}`);
    expect(res.status).toBe(403);
  });

  it("RECEPTION cannot GET /pharmacy/inventory/expiring (403)", async () => {
    const res = await request(app)
      .get("/api/v1/pharmacy/inventory/expiring?days=30")
      .set("Authorization", `Bearer ${receptionToken}`);
    expect(res.status).toBe(403);
  });

  it("PHARMACIST can GET /pharmacy/inventory (200)", async () => {
    const res = await request(app)
      .get("/api/v1/pharmacy/inventory")
      .set("Authorization", `Bearer ${pharmacistToken}`);
    expect(res.status).toBe(200);
  });

  it("DOCTOR can GET /pharmacy/inventory (200) — clinical role needs visibility", async () => {
    const res = await request(app)
      .get("/api/v1/pharmacy/inventory")
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
  });

  it("NURSE can GET /pharmacy/inventory (200) — clinical role needs visibility", async () => {
    const res = await request(app)
      .get("/api/v1/pharmacy/inventory")
      .set("Authorization", `Bearer ${nurseToken}`);
    expect(res.status).toBe(200);
  });

  it("ADMIN can GET /pharmacy/inventory (200)", async () => {
    const res = await request(app)
      .get("/api/v1/pharmacy/inventory")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  // ─── Pharmacy inventory WRITES — RECEPTION must NOT mutate stock ───

  it("RECEPTION cannot POST /pharmacy/inventory (403)", async () => {
    const res = await request(app)
      .post("/api/v1/pharmacy/inventory")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({
        medicineId: "fake",
        batchNumber: "B1",
        quantity: 1,
        unitCost: 1,
        sellingPrice: 1,
        expiryDate: "2030-01-01",
      });
    expect(res.status).toBe(403);
  });

  it("RECEPTION cannot PATCH /pharmacy/inventory/:id (403)", async () => {
    const res = await request(app)
      .patch("/api/v1/pharmacy/inventory/some-fake-id")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({ reorderLevel: 50 });
    expect(res.status).toBe(403);
  });

  it("RECEPTION cannot POST /pharmacy/stock-movements (403)", async () => {
    const res = await request(app)
      .post("/api/v1/pharmacy/stock-movements")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({
        inventoryItemId: "fake",
        type: "ADJUSTMENT",
        quantity: 1,
        reason: "test",
      });
    expect(res.status).toBe(403);
  });

  it("RECEPTION cannot POST /pharmacy/stock-adjustments (403)", async () => {
    const res = await request(app)
      .post("/api/v1/pharmacy/stock-adjustments")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({
        inventoryItemId: "fake",
        quantity: 1,
        reasonCode: "DAMAGE",
        reason: "test",
      });
    expect(res.status).toBe(403);
  });

  it("RECEPTION cannot POST /pharmacy/transfers (403)", async () => {
    const res = await request(app)
      .post("/api/v1/pharmacy/transfers")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({
        inventoryItemId: "fake",
        fromLocation: "A",
        toLocation: "B",
        quantity: 1,
      });
    expect(res.status).toBe(403);
  });

  // ─── Controlled Substance Register — Schedule H/H1/X is regulated ───

  it("RECEPTION cannot GET /controlled-substances (403)", async () => {
    const res = await request(app)
      .get("/api/v1/controlled-substances")
      .set("Authorization", `Bearer ${receptionToken}`);
    expect(res.status).toBe(403);
  });

  it("RECEPTION cannot GET /controlled-substances/register/:medicineId (403)", async () => {
    const res = await request(app)
      .get("/api/v1/controlled-substances/register/some-fake-medicine")
      .set("Authorization", `Bearer ${receptionToken}`);
    expect(res.status).toBe(403);
  });

  it("RECEPTION cannot POST /controlled-substances (403)", async () => {
    const res = await request(app)
      .post("/api/v1/controlled-substances")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({
        medicineId: "fake",
        quantity: 1,
      });
    expect(res.status).toBe(403);
  });

  it("PHARMACIST can GET /controlled-substances (200)", async () => {
    const res = await request(app)
      .get("/api/v1/controlled-substances")
      .set("Authorization", `Bearer ${pharmacistToken}`);
    expect(res.status).toBe(200);
  });

  it("DOCTOR can GET /controlled-substances (200) — prescribing role", async () => {
    const res = await request(app)
      .get("/api/v1/controlled-substances")
      .set("Authorization", `Bearer ${doctorToken}`);
    expect(res.status).toBe(200);
  });

  // ─── Expenses — ADMIN-only until ACCOUNTANT role exists ───

  it("RECEPTION cannot GET /expenses (403) — staff-salary leak", async () => {
    const res = await request(app)
      .get("/api/v1/expenses")
      .set("Authorization", `Bearer ${receptionToken}`);
    expect(res.status).toBe(403);
  });

  it("RECEPTION cannot GET /expenses/summary (403)", async () => {
    const res = await request(app)
      .get("/api/v1/expenses/summary")
      .set("Authorization", `Bearer ${receptionToken}`);
    expect(res.status).toBe(403);
  });

  it("RECEPTION cannot POST /expenses (403)", async () => {
    const res = await request(app)
      .post("/api/v1/expenses")
      .set("Authorization", `Bearer ${receptionToken}`)
      .send({
        category: "SALARY",
        amount: 100,
        description: "test",
        date: "2026-04-26",
      });
    expect(res.status).toBe(403);
  });

  it("ADMIN can still GET /expenses (200)", async () => {
    const res = await request(app)
      .get("/api/v1/expenses")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});
