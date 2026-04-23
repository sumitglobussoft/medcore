// Integration tests for the audit router.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken, getPrisma } from "../setup";

let app: any;
let adminToken: string;
let patientToken: string;

async function seedAuditLogs() {
  const prisma = await getPrisma();
  const admin = await prisma.user.findUnique({
    where: { email: "admin@test.local" },
  });
  const now = new Date();
  const entries = [
    { action: "AUTH_LOGIN", entity: "user", entityId: admin?.id, ipAddress: "127.0.0.1" },
    { action: "PATIENT_CREATE", entity: "patient", entityId: "p1", ipAddress: "10.0.0.1" },
    { action: "PATIENT_CREATE", entity: "patient", entityId: "p2", ipAddress: "10.0.0.2" },
    { action: "PATIENT_DELETE", entity: "patient", entityId: "p1", ipAddress: "10.0.0.1" },
    { action: "BED_STATUS_UPDATE", entity: "bed", entityId: "b1", ipAddress: "10.0.0.3" },
  ];
  for (const e of entries) {
    await prisma.auditLog.create({
      data: {
        userId: admin?.id,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId,
        ipAddress: e.ipAddress,
        details: { extra: "test" } as any,
        createdAt: now,
      },
    });
  }
}

describeIfDB("Audit API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    patientToken = await getAuthToken("PATIENT");
    const mod = await import("../../app");
    app = mod.app;
    await seedAuditLogs();
  });

  it("401 without token on list", async () => {
    const res = await request(app).get("/api/v1/audit");
    expect(res.status).toBe(401);
  });

  it("rejects PATIENT role (403)", async () => {
    const res = await request(app)
      .get("/api/v1/audit")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(403);
  });

  it("ADMIN lists audit logs with pagination meta", async () => {
    const res = await request(app)
      .get("/api/v1/audit?page=1&limit=50")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta?.page).toBe(1);
    expect(res.body.meta?.limit).toBe(50);
    expect(res.body.meta?.total).toBeGreaterThan(0);
  });

  it("filters by action=PATIENT_CREATE", async () => {
    const res = await request(app)
      .get("/api/v1/audit?action=PATIENT_CREATE")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const row of res.body.data) {
      expect(row.action).toBe("PATIENT_CREATE");
    }
  });

  it("filters by entity=bed", async () => {
    const res = await request(app)
      .get("/api/v1/audit?entity=bed")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const row of res.body.data) {
      expect(row.entity).toBe("bed");
    }
  });

  it("filter by ipContains works", async () => {
    const res = await request(app)
      .get("/api/v1/audit?ipContains=10.0.0.1")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const row of res.body.data) {
      expect(row.ipAddress).toContain("10.0.0.1");
    }
  });

  it("respects limit clamp (max 100)", async () => {
    const res = await request(app)
      .get("/api/v1/audit?limit=500")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.meta?.limit).toBeLessThanOrEqual(100);
  });

  it("exports CSV with audit-YYYY-MM-DD filename", async () => {
    const res = await request(app)
      .get("/api/v1/audit/export.csv")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    expect(res.headers["content-disposition"]).toContain("audit-");
  });

  it("retention-stats returns totalEntries & retentionDays", async () => {
    const res = await request(app)
      .get("/api/v1/audit/retention-stats")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(typeof res.body.data.totalEntries).toBe("number");
    expect(typeof res.body.data.retentionDays).toBe("number");
  });

  it("/filters returns distinct actions & users", async () => {
    const res = await request(app)
      .get("/api/v1/audit/filters")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data?.actions)).toBe(true);
    expect(Array.isArray(res.body.data?.users)).toBe(true);
  });

  it("free-text search via /search", async () => {
    const res = await request(app)
      .get("/api/v1/audit/search?q=PATIENT_DELETE")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});
