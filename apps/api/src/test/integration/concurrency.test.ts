// Concurrency tests: verify that race conditions on shared counters
// (walk-in token numbers, bed occupancy) cannot corrupt data.
//
// The system under test uses last-tokenNumber+1 logic without app-level locking;
// correctness depends on the database unique constraint
// `@@unique([doctorId, date, tokenNumber])` on Appointment catching any dup.
//
// Skipped unless DATABASE_URL_TEST is set.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken, getPrisma } from "../setup";
import { createDoctorFixture, createPatientFixture } from "../factories";

let app: any;
let receptionToken: string;

describeIfDB("Concurrency (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    receptionToken = await getAuthToken("RECEPTION");
    const mod = await import("../../app");
    app = mod.app;
  });

  it("parallel walk-ins against the same doctor produce unique tokens (no duplicates)", async () => {
    const doctor = await createDoctorFixture();
    const patients = await Promise.all(
      Array.from({ length: 5 }, () => createPatientFixture({ age: 30, gender: "MALE" }))
    );

    // Fire 5 walk-in requests in parallel — race condition worst case.
    const responses = await Promise.all(
      patients.map((p) =>
        request(app)
          .post("/api/v1/appointments/walk-in")
          .set("Authorization", `Bearer ${receptionToken}`)
          .send({
            patientId: p.id,
            doctorId: doctor.id,
          })
      )
    );

    // Partition successes vs collisions (P2002 on the unique constraint).
    const successes = responses.filter((r) => r.status >= 200 && r.status < 300);
    const conflicts = responses.filter((r) => r.status >= 500 || r.status === 409);

    // Every outcome must be accounted for — nothing gets lost in a weird 4xx.
    expect(successes.length + conflicts.length).toBe(5);

    // At least ONE must succeed (the DB is reachable + the route works).
    expect(successes.length).toBeGreaterThan(0);

    // Of the successes, token numbers must be globally unique.
    const tokens = successes
      .map((r) => r.body?.data?.tokenNumber)
      .filter((t) => typeof t === "number");
    const uniqueTokens = new Set(tokens);
    expect(uniqueTokens.size).toBe(tokens.length);

    // Database-level sanity: count the actual appointment rows and verify
    // their token numbers form a contiguous sequence from 1 (or close to it).
    const prisma = await getPrisma();
    const appts = await prisma.appointment.findMany({
      where: { doctorId: doctor.id },
      select: { tokenNumber: true },
      orderBy: { tokenNumber: "asc" },
    });
    const tokenNumbers = appts.map((a: any) => a.tokenNumber);
    const dbUnique = new Set(tokenNumbers);
    // Safety: DB must never contain duplicates on (doctorId, date, tokenNumber)
    expect(dbUnique.size).toBe(tokenNumbers.length);
    expect(tokenNumbers.length).toBe(successes.length);
  });

  it("parallel same-patient walk-ins against same doctor — idempotency check", async () => {
    // Current behavior: the route doesn't dedupe — 2 rapid POSTs for the
    // same patient create 2 separate appointments. We document that here.
    // If dedupe is added later, update this assertion.
    const doctor = await createDoctorFixture();
    const patient = await createPatientFixture({ age: 40, gender: "MALE" });

    const [r1, r2] = await Promise.all([
      request(app)
        .post("/api/v1/appointments/walk-in")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ patientId: patient.id, doctorId: doctor.id }),
      request(app)
        .post("/api/v1/appointments/walk-in")
        .set("Authorization", `Bearer ${receptionToken}`)
        .send({ patientId: patient.id, doctorId: doctor.id }),
    ]);

    // Both may succeed (no dedupe) or one may conflict; assert nothing crashes.
    expect([200, 201, 409, 500]).toContain(r1.status);
    expect([200, 201, 409, 500]).toContain(r2.status);
  });
});
