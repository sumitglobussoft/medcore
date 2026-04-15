// Integration tests for user-related endpoints: registration, /auth/me,
// role filtering on /shifts/staff. (There is no dedicated /users router;
// user CRUD lives on auth + shifts.)
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken, getPrisma } from "../setup";
import { createUserFixture } from "../factories";

let app: any;
let adminToken: string;
let patientToken: string;

describeIfDB("Users API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    adminToken = await getAuthToken("ADMIN");
    patientToken = await getAuthToken("PATIENT");
    const mod = await import("../../app");
    app = mod.app;
  });

  it("registers a new staff user (RECEPTION)", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      name: "Rita Reception",
      email: `rita-${Date.now()}@test.local`,
      phone: "9998887777",
      password: "password123",
      role: "RECEPTION",
    });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.user?.role).toBe("RECEPTION");
  });

  it("rejects duplicate email (409)", async () => {
    const email = `dup-${Date.now()}@test.local`;
    await request(app).post("/api/v1/auth/register").send({
      name: "First",
      email,
      phone: "9999999999",
      password: "password123",
      role: "NURSE",
    });
    const res = await request(app).post("/api/v1/auth/register").send({
      name: "Second",
      email,
      phone: "9999999999",
      password: "password123",
      role: "NURSE",
    });
    expect(res.status).toBe(409);
  });

  it("rejects malformed payload (400)", async () => {
    const res = await request(app).post("/api/v1/auth/register").send({
      name: "X",
      email: "not-an-email",
      phone: "1",
      password: "x",
      role: "MAGICIAN",
    });
    expect(res.status).toBe(400);
  });

  it("GET /auth/me returns 401 without token", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });

  it("GET /auth/me returns user profile", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data?.role).toBe("ADMIN");
  });

  it("PATCH /auth/me updates profile fields", async () => {
    const res = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Updated Admin Name" });
    expect(res.status).toBe(200);
    const me = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(me.body.data?.name).toBe("Updated Admin Name");
  });

  it("PATCH /auth/me with no fields returns 400", async () => {
    const res = await request(app)
      .patch("/api/v1/auth/me")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it("ADMIN can list staff via /shifts/staff", async () => {
    await createUserFixture({ role: "NURSE" });
    await createUserFixture({ role: "DOCTOR" });
    const res = await request(app)
      .get("/api/v1/shifts/staff")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const roles = new Set(res.body.data.map((u: any) => u.role));
    // Filter should exclude PATIENT, PHARMACIST, LAB_TECH
    expect(roles.has("PATIENT")).toBe(false);
  });

  it("rejects PATIENT from /shifts/staff (403)", async () => {
    const res = await request(app)
      .get("/api/v1/shifts/staff")
      .set("Authorization", `Bearer ${patientToken}`);
    expect(res.status).toBe(403);
  });

  it("persists user to DB on register (side-effect)", async () => {
    const email = `persist-${Date.now()}@test.local`;
    await request(app).post("/api/v1/auth/register").send({
      name: "Persist Me",
      email,
      phone: "9990001111",
      password: "password123",
      role: "RECEPTION",
    });
    const prisma = await getPrisma();
    const user = await prisma.user.findUnique({ where: { email } });
    expect(user).toBeTruthy();
    expect(user?.role).toBe("RECEPTION");
  });
});
