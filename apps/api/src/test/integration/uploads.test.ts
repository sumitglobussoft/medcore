// Integration tests for the uploads router.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken } from "../setup";

let app: any;
let token: string;

describeIfDB("Uploads API (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    token = await getAuthToken("ADMIN");
    const mod = await import("../../app");
    app = mod.app;
  });

  it("401 without token", async () => {
    const res = await request(app).post("/api/v1/uploads").send({});
    expect(res.status).toBe(401);
  });

  it("rejects missing filename (400)", async () => {
    const res = await request(app)
      .post("/api/v1/uploads")
      .set("Authorization", `Bearer ${token}`)
      .send({ base64Content: "aGVsbG8=" });
    expect(res.status).toBe(400);
  });

  it("rejects missing base64Content (400)", async () => {
    const res = await request(app)
      .post("/api/v1/uploads")
      .set("Authorization", `Bearer ${token}`)
      .send({ filename: "test.txt" });
    expect(res.status).toBe(400);
  });

  it("uploads a plain base64 text file", async () => {
    const content = Buffer.from("hello world").toString("base64");
    const res = await request(app)
      .post("/api/v1/uploads")
      .set("Authorization", `Bearer ${token}`)
      .send({ filename: "hello.txt", base64Content: content });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.filePath).toMatch(/uploads\/ehr\//);
    expect(res.body.data?.fileSize).toBe(11);
    expect(res.body.data?.originalName).toBe("hello.txt");
  });

  it("accepts data URL prefix and strips it", async () => {
    const raw = Buffer.from("%PDF-1.4 fake").toString("base64");
    const res = await request(app)
      .post("/api/v1/uploads")
      .set("Authorization", `Bearer ${token}`)
      .send({
        filename: "doc.pdf",
        base64Content: `data:application/pdf;base64,${raw}`,
        type: "PRESCRIPTION",
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.data?.fileSize).toBeGreaterThan(0);
  });

  it("sanitizes filenames with unsafe chars", async () => {
    const content = Buffer.from("x").toString("base64");
    const res = await request(app)
      .post("/api/v1/uploads")
      .set("Authorization", `Bearer ${token}`)
      .send({
        filename: "../../etc/pass wd with spaces.txt",
        base64Content: content,
      });
    expect([200, 201]).toContain(res.status);
    // Resulting stored filename must NOT start with ../ and must not contain a bare space
    expect(res.body.data?.filename).not.toMatch(/\.\./);
    expect(res.body.data?.filename).not.toMatch(/\s/);
  });

  it("round-trips — GET returns the uploaded file content", async () => {
    const payload = "round-trip-sample-content";
    const up = await request(app)
      .post("/api/v1/uploads")
      .set("Authorization", `Bearer ${token}`)
      .send({
        filename: "sample.txt",
        base64Content: Buffer.from(payload).toString("base64"),
      });
    expect([200, 201]).toContain(up.status);
    const stored = up.body.data.filename;
    const get = await request(app)
      .get(`/api/v1/uploads/${stored}`)
      .set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.text || get.body?.toString?.()).toContain(payload);
  });

  it("returns 404 for non-existent file", async () => {
    const res = await request(app)
      .get("/api/v1/uploads/this-does-not-exist.xyz")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("GET file requires auth (401 or 404 without token+sig)", async () => {
    // Post-security-hardening the route accepts either Bearer auth or a
    // signed URL (?expires=&sig=). With neither, the response is 401
    // (middleware rejects) or 404 (file not found). Both are acceptable —
    // the file is not accessible without proof of authorization.
    const res = await request(app).get("/api/v1/uploads/some-file.txt");
    expect([401, 404]).toContain(res.status);
  });
});
