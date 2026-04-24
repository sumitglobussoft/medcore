// Integration tests for medicines router — Issue #40 + #41 regression.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken, getPrisma } from "../setup";
import { createMedicineFixture } from "../factories";

let app: any;
let adminToken: string;

describeIfDB("Medicines API (Issue #40 + #41 regression)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    const mod = await import("../../app");
    app = mod.app;
  });

  it("list response exposes rxRequired alias for every row", async () => {
    await createMedicineFixture({ name: "Amlodipine-IT-5mg" });
    await createMedicineFixture({ name: "Paracetamol-IT-500mg" });
    const res = await request(app)
      .get("/api/v1/medicines?limit=100")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    for (const row of res.body.data) {
      expect(row).toHaveProperty("rxRequired");
      expect(typeof row.rxRequired).toBe("boolean");
    }
  });

  it("list response exposes manufacturer alias (maps brand → manufacturer)", async () => {
    await createMedicineFixture({
      name: "Mfg-Test-Alembic-500mg",
      brand: "Alembic",
    });
    const res = await request(app)
      .get("/api/v1/medicines?search=Mfg-Test-Alembic")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const row = res.body.data.find((m: any) =>
      m.name.includes("Mfg-Test-Alembic")
    );
    expect(row).toBeDefined();
    expect(row.manufacturer).toBe("Alembic");
  });

  it("creating a medicine via {manufacturer, rxRequired} persists as brand + prescriptionRequired", async () => {
    const res = await request(app)
      .post("/api/v1/medicines")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Route-Create-Test-" + Date.now(),
        genericName: "Amlodipine",
        strength: "5mg",
        manufacturer: "Cipla",
        rxRequired: true,
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data.manufacturer).toBe("Cipla");
    expect(res.body.data.rxRequired).toBe(true);

    // Raw DB row must have brand + prescriptionRequired set.
    const prisma = await getPrisma();
    const dbRow = await prisma.medicine.findUnique({
      where: { id: res.body.data.id },
    });
    expect(dbRow.brand).toBe("Cipla");
    expect(dbRow.prescriptionRequired).toBe(true);
  });

  it("creating a medicine WITHOUT manufacturer is rejected by Zod", async () => {
    const res = await request(app)
      .post("/api/v1/medicines")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Missing-Mfg-" + Date.now(),
        genericName: "Ibuprofen",
        strength: "400mg",
        rxRequired: false,
      });
    expect(res.status).toBe(400);
  });

  it("every medicine row has a non-empty manufacturer after backfill is run", async () => {
    // Simulate backfill by ensuring every row has brand set.
    const prisma = await getPrisma();
    await prisma.medicine.updateMany({
      where: { OR: [{ brand: null }, { brand: "" }] },
      data: { brand: "BackfillMfg" },
    });

    const res = await request(app)
      .get("/api/v1/medicines?limit=200")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const row of res.body.data) {
      expect(row.manufacturer).toBeTruthy();
      expect(typeof row.manufacturer).toBe("string");
      expect(row.manufacturer.length).toBeGreaterThan(0);
    }
  });
});
