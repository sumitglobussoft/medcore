// Integration tests for pharmacy inventory endpoints.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken, getPrisma } from "../setup";
import {
  createMedicineFixture,
  createInventoryFixture,
} from "../factories";

let app: any;
let adminToken: string;
let patientToken: string;

describeIfDB("Inventory API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    patientToken = await getAuthToken("PATIENT");
    const mod = await import("../../app");
    app = mod.app;
  });

  it("401 without token", async () => {
    const res = await request(app).get("/api/v1/pharmacy/inventory");
    expect(res.status).toBe(401);
  });

  it("lists inventory items", async () => {
    const med = await createMedicineFixture();
    await createInventoryFixture({ medicineId: med.id });
    const res = await request(app)
      .get("/api/v1/pharmacy/inventory")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("search filter narrows results by medicine name", async () => {
    const med = await createMedicineFixture({
      name: `ZZUniqueMed-${Date.now()}`,
    });
    await createInventoryFixture({ medicineId: med.id });
    const res = await request(app)
      .get("/api/v1/pharmacy/inventory?search=ZZUniqueMed")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it("lowStock=true returns only items at/below reorder level", async () => {
    const medLow = await createMedicineFixture();
    const medHigh = await createMedicineFixture();
    await createInventoryFixture({
      medicineId: medLow.id,
      overrides: { quantity: 5, reorderLevel: 10 },
    });
    await createInventoryFixture({
      medicineId: medHigh.id,
      overrides: { quantity: 100, reorderLevel: 10 },
    });
    const res = await request(app)
      .get("/api/v1/pharmacy/inventory?lowStock=true")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const r of res.body.data) {
      expect(r.quantity).toBeLessThanOrEqual(r.reorderLevel);
    }
  });

  it("creates inventory item (happy path)", async () => {
    const med = await createMedicineFixture();
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 2);
    const res = await request(app)
      .post("/api/v1/pharmacy/inventory")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        medicineId: med.id,
        batchNumber: `B-${Date.now()}`,
        quantity: 50,
        unitCost: 2.5,
        sellingPrice: 5,
        expiryDate: expiry.toISOString().slice(0, 10),
        reorderLevel: 10,
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.quantity).toBe(50);
  });

  it("upsert — same batch re-added increments quantity (side-effect)", async () => {
    const med = await createMedicineFixture();
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 2);
    const batch = `UpsertBatch-${Date.now()}`;
    const first = await request(app)
      .post("/api/v1/pharmacy/inventory")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        medicineId: med.id,
        batchNumber: batch,
        quantity: 20,
        unitCost: 1,
        sellingPrice: 3,
        expiryDate: expiry.toISOString().slice(0, 10),
      });
    expect([200, 201]).toContain(first.status);
    const second = await request(app)
      .post("/api/v1/pharmacy/inventory")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        medicineId: med.id,
        batchNumber: batch,
        quantity: 30,
        unitCost: 1,
        sellingPrice: 3,
        expiryDate: expiry.toISOString().slice(0, 10),
      });
    expect([200, 201]).toContain(second.status);
    expect(second.body.data?.quantity).toBe(50);
  });

  it("rejects malformed inventory payload (400)", async () => {
    const res = await request(app)
      .post("/api/v1/pharmacy/inventory")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        medicineId: "not-uuid",
        batchNumber: "",
        quantity: -1,
        unitCost: -5,
        sellingPrice: -5,
        expiryDate: "bad-date",
      });
    expect(res.status).toBe(400);
  });

  it("rejects PATIENT from creating inventory (403)", async () => {
    const med = await createMedicineFixture();
    const expiry = new Date();
    expiry.setFullYear(expiry.getFullYear() + 2);
    const res = await request(app)
      .post("/api/v1/pharmacy/inventory")
      .set("Authorization", `Bearer ${patientToken}`)
      .send({
        medicineId: med.id,
        batchNumber: `B-${Date.now()}`,
        quantity: 10,
        unitCost: 1,
        sellingPrice: 2,
        expiryDate: expiry.toISOString().slice(0, 10),
      });
    expect(res.status).toBe(403);
  });

  it("expiring endpoint lists items within cutoff", async () => {
    const med = await createMedicineFixture();
    const soon = new Date();
    soon.setDate(soon.getDate() + 10);
    const prisma = await getPrisma();
    await prisma.inventoryItem.create({
      data: {
        medicineId: med.id,
        batchNumber: `EXP-${Date.now()}`,
        quantity: 5,
        unitCost: 1,
        sellingPrice: 2,
        expiryDate: soon,
        reorderLevel: 10,
      },
    });
    const res = await request(app)
      .get("/api/v1/pharmacy/inventory/expiring?days=30")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });
});
