// Integration tests for the assets router.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken, getPrisma } from "../setup";
import { createUserFixture } from "../factories";

let app: any;
let adminToken: string;
let nurseToken: string;

async function createAsset(overrides: Partial<any> = {}) {
  const res = await request(app)
    .post("/api/v1/assets")
    .set("Authorization", `Bearer ${adminToken}`)
    .send({
      assetTag:
        overrides.assetTag ||
        `AT-${Date.now() % 100000}-${Math.floor(Math.random() * 1000)}`,
      name: overrides.name || "Infusion Pump",
      category: overrides.category || "MEDICAL",
      department: overrides.department || "ICU",
      purchaseCost: overrides.purchaseCost ?? 50000,
      purchaseDate:
        overrides.purchaseDate ||
        new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10),
      ...overrides,
    });
  return res.body.data;
}

describeIfDB("Assets API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    nurseToken = await getAuthToken("NURSE");
    const mod = await import("../../app");
    app = mod.app;
  });

  it("creates an asset (admin)", async () => {
    const asset = await createAsset();
    expect(asset?.assetTag).toBeTruthy();
    expect(asset?.status).toBe("IDLE");
  });

  it("lists assets with pagination", async () => {
    await createAsset();
    const res = await request(app)
      .get("/api/v1/assets?page=1&limit=10")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("requires auth (401)", async () => {
    const res = await request(app).get("/api/v1/assets");
    expect(res.status).toBe(401);
  });

  it("nurse cannot create assets (403)", async () => {
    const res = await request(app)
      .post("/api/v1/assets")
      .set("Authorization", `Bearer ${nurseToken}`)
      .send({ assetTag: "NURSE-TRY", name: "Thing", category: "MEDICAL" });
    expect(res.status).toBe(403);
  });

  it("rejects bad payload (400)", async () => {
    const res = await request(app)
      .post("/api/v1/assets")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "no-tag" });
    expect(res.status).toBe(400);
  });

  it("assigns an asset — status becomes IN_USE (side-effect)", async () => {
    const asset = await createAsset();
    const user = await createUserFixture({ role: "NURSE" });
    const res = await request(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ assignedTo: user.id, location: "Bed-7" });
    expect([200, 201]).toContain(res.status);

    const prisma = await getPrisma();
    const refreshed = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(refreshed?.status).toBe("IN_USE");
  });

  it("returns an asset — status back to IDLE", async () => {
    const asset = await createAsset();
    const user = await createUserFixture({ role: "NURSE" });
    await request(app)
      .post(`/api/v1/assets/${asset.id}/assign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ assignedTo: user.id });
    const res = await request(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ notes: "back to store" });
    expect([200, 201]).toContain(res.status);

    const prisma = await getPrisma();
    const refreshed = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(refreshed?.status).toBe("IDLE");
  });

  it("return fails when no active assignment (400 business rule)", async () => {
    const asset = await createAsset();
    const res = await request(app)
      .post(`/api/v1/assets/${asset.id}/return`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("logs maintenance and exposes /maintenance/due", async () => {
    const asset = await createAsset();
    const nextDue = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
    const log = await request(app)
      .post("/api/v1/assets/maintenance")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        assetId: asset.id,
        type: "SCHEDULED",
        description: "Calibration & clean",
        nextDueDate: nextDue,
      });
    expect([200, 201]).toContain(log.status);
    const due = await request(app)
      .get("/api/v1/assets/maintenance/due")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(due.status).toBe(200);
  });

  it("transfers an asset between departments", async () => {
    const asset = await createAsset({ department: "ICU" });
    const res = await request(app)
      .post(`/api/v1/assets/${asset.id}/transfer`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ toDepartment: "EMERGENCY", reason: "relocation" });
    expect([200, 201]).toContain(res.status);

    const prisma = await getPrisma();
    const refreshed = await prisma.asset.findUnique({ where: { id: asset.id } });
    expect(refreshed?.department).toBe("EMERGENCY");
  });

  it("disposes an asset (status RETIRED)", async () => {
    const asset = await createAsset();
    const res = await request(app)
      .post(`/api/v1/assets/${asset.id}/dispose`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ method: "SCRAPPED", disposalValue: 200 });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.status).toBe("RETIRED");
  });

  it("returns depreciation payload", async () => {
    const asset = await createAsset({ purchaseCost: 100000 });
    // Add useful life via PATCH
    await request(app)
      .patch(`/api/v1/assets/${asset.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ usefulLifeYears: 5 });
    const res = await request(app)
      .get(`/api/v1/assets/${asset.id}/depreciation`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});
