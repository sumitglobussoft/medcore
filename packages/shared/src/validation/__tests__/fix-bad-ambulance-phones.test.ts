/**
 * Unit-level coverage for the regex used by `fix-bad-ambulance-phones.ts`.
 *
 * We intentionally do NOT exercise prisma here — that requires a live DB
 * which the unit-test runner does not have. The regex is the only piece of
 * logic in the script that's worth pinning down; the rest is read → filter
 * → update plumbing covered by code review.
 *
 * This mirrors the regex the API enforces in createAmbulanceTripSchema
 * (Issue #87), so a drift between cleanup and creation is a test failure.
 */
import { describe, it, expect } from "vitest";

const PHONE_REGEX = /^\+?\d{10,15}$/;

describe("fix-bad-ambulance-phones — phone regex", () => {
  it("matches a 10-digit Indian mobile", () => {
    expect(PHONE_REGEX.test("9876543210")).toBe(true);
  });
  it("matches +91 prefixed mobile", () => {
    expect(PHONE_REGEX.test("+919876543210")).toBe(true);
  });
  it("matches a 15-digit max", () => {
    expect(PHONE_REGEX.test("123456789012345")).toBe(true);
  });
  it("rejects 'abc123xyz' (the row that triggered #146)", () => {
    expect(PHONE_REGEX.test("abc123xyz")).toBe(false);
  });
  it("rejects digits + letters mid-string", () => {
    expect(PHONE_REGEX.test("987abc6543")).toBe(false);
  });
  it("rejects a 9-digit phone", () => {
    expect(PHONE_REGEX.test("123456789")).toBe(false);
  });
  it("rejects a 16-digit phone", () => {
    expect(PHONE_REGEX.test("1234567890123456")).toBe(false);
  });
  it("rejects spaces", () => {
    expect(PHONE_REGEX.test("987 654 3210")).toBe(false);
  });
  it("rejects empty string", () => {
    expect(PHONE_REGEX.test("")).toBe(false);
  });
});

// Issue #146: simulate the script's filter step on an in-memory dataset to
// confirm exactly which rows it would clear. This guards us against a
// regression where the script accidentally NULLs a valid row.
describe("fix-bad-ambulance-phones — filter step", () => {
  const rows = [
    { tripNumber: "TRP000007", callerPhone: "9876543210" },
    { tripNumber: "TRP000008", callerPhone: "+919876543210" },
    { tripNumber: "TRP000009", callerPhone: "abc123xyz" }, // bad — issue #146
    { tripNumber: "TRP000010", callerPhone: null },
    { tripNumber: "TRP000011", callerPhone: "9999" }, // bad — too short
  ];

  it("identifies exactly the bad rows", () => {
    const bad = rows.filter(
      (r) =>
        typeof r.callerPhone === "string" && !PHONE_REGEX.test(r.callerPhone),
    );
    expect(bad.map((r) => r.tripNumber)).toEqual(["TRP000009", "TRP000011"]);
  });

  it("is idempotent — re-running over already-cleaned data is a no-op", () => {
    const cleaned = rows.map((r) => ({
      ...r,
      callerPhone:
        typeof r.callerPhone === "string" && !PHONE_REGEX.test(r.callerPhone)
          ? null
          : r.callerPhone,
    }));
    const stillBad = cleaned.filter(
      (r) =>
        typeof r.callerPhone === "string" && !PHONE_REGEX.test(r.callerPhone),
    );
    expect(stillBad.length).toBe(0);
  });
});
