// Integration tests for /api/v1/marketing/enquiry (public, unauthenticated).
// Covers happy path, Zod validation, honeypot rejection, and CRM forward
// best-effort semantics. Skipped unless DATABASE_URL_TEST is set.
import { it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getPrisma } from "../setup";

let app: any;

describeIfDB("Marketing enquiry API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    const mod = await import("../../app");
    app = mod.app;
  });

  beforeEach(async () => {
    // Ensure each test sees a clean enquiries table even though resetDB
    // only runs once per suite. A small cleanup is cheaper than a full reset.
    const prisma = await getPrisma();
    await prisma.marketingEnquiry.deleteMany({});
    delete process.env.CRM_WEBHOOK_URL;
  });

  afterAll(() => {
    delete process.env.CRM_WEBHOOK_URL;
    vi.restoreAllMocks();
  });

  const validPayload = {
    fullName: "Dr. Meera Rao",
    email: "meera@asha.hospital",
    phone: "+919000000001",
    hospitalName: "Asha Hospital",
    hospitalSize: "10-50",
    role: "Administrator",
    // Schema now requires message min 10 chars (Issue #45 tightening).
    message: "Looking for a demo please",
    preferredContactTime: "Morning",
  };

  it("accepts a well-formed enquiry and persists it", async () => {
    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send(validPayload);
    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);
    expect(res.body.data?.id).toBeTruthy();

    const prisma = await getPrisma();
    const row = await prisma.marketingEnquiry.findUnique({
      where: { id: res.body.data.id },
    });
    expect(row).toBeTruthy();
    expect(row.fullName).toBe(validPayload.fullName);
    expect(row.email).toBe(validPayload.email);
    expect(row.hospitalSize).toBe(validPayload.hospitalSize);
    expect(row.role).toBe(validPayload.role);
    expect(row.source).toBe("website");
    expect(row.forwardedToCrmAt).toBeNull(); // no CRM_WEBHOOK_URL set
  });

  it("rejects payload with bad email (400)", async () => {
    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({ ...validPayload, email: "not-an-email" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("rejects payload with missing required fields (400)", async () => {
    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({ fullName: "X" });
    expect(res.status).toBe(400);
  });

  it("rejects payload with bad hospitalSize enum (400)", async () => {
    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({ ...validPayload, hospitalSize: "giant" });
    expect(res.status).toBe(400);
  });

  it("rejects payload with bad role enum (400)", async () => {
    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({ ...validPayload, role: "CEO" });
    expect(res.status).toBe(400);
  });

  it("honeypot: filled 'website' field returns 200 but does NOT persist", async () => {
    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({ ...validPayload, website: "https://spambot.example" });
    // Silently "successful" to avoid signalling the bot.
    expect([200, 201]).toContain(res.status);
    expect(res.body.success).toBe(true);

    const prisma = await getPrisma();
    const count = await prisma.marketingEnquiry.count();
    expect(count).toBe(0);
  });

  it("accepts optional fields (phone + preferredContactTime omitted)", async () => {
    // Issue #45: message is now required, phone is now OPTIONAL.
    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({
        fullName: "No Phone User",
        email: "no-phone@x.com",
        hospitalName: "Clinic X",
        hospitalSize: "1-10",
        role: "Doctor",
        message: "Interested in a small-clinic demo next week.",
      });
    expect([200, 201]).toContain(res.status);
    const prisma = await getPrisma();
    const row = await prisma.marketingEnquiry.findUnique({
      where: { id: res.body.data.id },
    });
    expect(row.phone).toBe(""); // defaulted because schema DB column is non-null
    expect(row.preferredContactTime).toBeNull();
  });

  it("returns structured field errors on invalid email (Issue #45)", async () => {
    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({ ...validPayload, email: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    // Must NOT be the old generic string.
    expect(res.body.error).not.toBe("Invalid enquiry payload");
    expect(Array.isArray(res.body.errors)).toBe(true);
    const emailErr = res.body.errors.find(
      (e: { field: string }) => e.field === "email"
    );
    expect(emailErr).toBeTruthy();
    expect(typeof emailErr.message).toBe("string");
    expect(emailErr.message.length).toBeGreaterThan(0);
  });

  it("returns multiple field errors when several fields fail", async () => {
    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({
        fullName: "X", // too short
        email: "nope", // bad email
        hospitalName: "Q", // too short
        hospitalSize: "1-10",
        role: "Doctor",
        message: "tiny", // too short
      });
    expect(res.status).toBe(400);
    const fields = (res.body.errors as { field: string }[]).map(
      (e) => e.field
    );
    expect(fields).toEqual(
      expect.arrayContaining(["fullName", "email", "hospitalName", "message"])
    );
  });

  it("rejects phone that is not a valid Indian mobile (Issue #45)", async () => {
    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({ ...validPayload, phone: "12345" });
    expect(res.status).toBe(400);
    const phoneErr = (res.body.errors as { field: string; message: string }[])
      .find((e) => e.field === "phone");
    expect(phoneErr).toBeTruthy();
  });

  it("works without authentication (public endpoint)", async () => {
    // No Authorization header deliberately.
    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({ ...validPayload, email: "public@x.com" });
    expect([200, 201]).toContain(res.status);
  });

  it("forwards to CRM when CRM_WEBHOOK_URL is set (success stamps forwardedToCrmAt)", async () => {
    process.env.CRM_WEBHOOK_URL = "https://crm.example/webhook";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok", { status: 200 }));

    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({ ...validPayload, email: "crm-ok@x.com" });
    expect([200, 201]).toContain(res.status);

    // Give the async CRM call time to settle.
    await new Promise((r) => setTimeout(r, 50));

    expect(fetchSpy).toHaveBeenCalled();
    const call = fetchSpy.mock.calls[0];
    expect(call[0]).toBe("https://crm.example/webhook");
    const init = call[1] as any;
    expect(init.method).toBe("POST");
    expect(init.headers["x-medcore-source"]).toBe("website");
    const body = JSON.parse(init.body);
    expect(body.email).toBe("crm-ok@x.com");
    expect(body.source).toBe("website");

    const prisma = await getPrisma();
    const row = await prisma.marketingEnquiry.findUnique({
      where: { id: res.body.data.id },
    });
    expect(row.forwardedToCrmAt).toBeTruthy();

    fetchSpy.mockRestore();
  });

  it("CRM failure (5xx) does NOT block the enquiry — forwardedToCrmAt stays null", async () => {
    process.env.CRM_WEBHOOK_URL = "https://crm.example/webhook";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("boom", { status: 500 }));

    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({ ...validPayload, email: "crm-fail@x.com" });
    expect([200, 201]).toContain(res.status);

    await new Promise((r) => setTimeout(r, 50));

    const prisma = await getPrisma();
    const row = await prisma.marketingEnquiry.findUnique({
      where: { id: res.body.data.id },
    });
    expect(row).toBeTruthy();
    expect(row.forwardedToCrmAt).toBeNull();

    fetchSpy.mockRestore();
  });

  it("CRM throw (network error) does NOT block the enquiry", async () => {
    process.env.CRM_WEBHOOK_URL = "https://crm.example/webhook";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("network"));

    const res = await request(app)
      .post("/api/v1/marketing/enquiry")
      .send({ ...validPayload, email: "crm-throw@x.com" });
    expect([200, 201]).toContain(res.status);

    const prisma = await getPrisma();
    const row = await prisma.marketingEnquiry.findUnique({
      where: { id: res.body.data.id },
    });
    expect(row).toBeTruthy();
    expect(row.forwardedToCrmAt).toBeNull();

    fetchSpy.mockRestore();
  });
});
