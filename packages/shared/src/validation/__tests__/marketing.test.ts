// Unit tests for the shared marketingEnquirySchema (Issue #45).
//
// The web form AND the API both run this schema, so every branch of the
// schema matters. We cover happy path + each rejection path the form can
// surface inline.
import { describe, it, expect } from "vitest";
import {
  marketingEnquirySchema,
  zodIssuesToFieldErrors,
} from "../marketing";

const base = {
  fullName: "Dr. Meera Rao",
  email: "meera@asha.in",
  hospitalName: "Asha Hospital",
  hospitalSize: "10-50" as const,
  role: "Administrator" as const,
  message: "Looking for a demo please",
};

describe("marketingEnquirySchema", () => {
  it("accepts a fully populated valid payload", () => {
    const parsed = marketingEnquirySchema.safeParse({
      ...base,
      phone: "+91 9876543210",
      preferredContactTime: "Morning" as const,
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a payload with phone omitted (phone is optional)", () => {
    const parsed = marketingEnquirySchema.safeParse(base);
    expect(parsed.success).toBe(true);
  });

  it("accepts phone as empty string (normalized to undefined)", () => {
    const parsed = marketingEnquirySchema.safeParse({
      ...base,
      phone: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.phone).toBeUndefined();
  });

  it("rejects an empty name", () => {
    const parsed = marketingEnquirySchema.safeParse({ ...base, fullName: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path[0] === "fullName");
      expect(issue).toBeTruthy();
    }
  });

  it("rejects a 1-character name (below min 2)", () => {
    const parsed = marketingEnquirySchema.safeParse({ ...base, fullName: "X" });
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid email (Issue #45 repro: 'abc')", () => {
    const parsed = marketingEnquirySchema.safeParse({ ...base, email: "abc" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path[0] === "email");
      expect(issue).toBeTruthy();
      expect(issue?.message).toMatch(/email/i);
    }
  });

  it("rejects a short message (below min 10 chars)", () => {
    const parsed = marketingEnquirySchema.safeParse({
      ...base,
      message: "too short",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const issue = parsed.error.issues.find((i) => i.path[0] === "message");
      expect(issue).toBeTruthy();
    }
  });

  it("rejects a non-Indian phone number", () => {
    const parsed = marketingEnquirySchema.safeParse({
      ...base,
      phone: "12345",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.find((i) => i.path[0] === "phone")
      ).toBeTruthy();
    }
  });

  it("accepts a bare 10-digit Indian mobile", () => {
    const parsed = marketingEnquirySchema.safeParse({
      ...base,
      phone: "9876543210",
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts phone with 0 prefix", () => {
    const parsed = marketingEnquirySchema.safeParse({
      ...base,
      phone: "09876543210",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown hospitalSize enum", () => {
    const parsed = marketingEnquirySchema.safeParse({
      ...base,
      hospitalSize: "giant" as unknown as "1-10",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects unknown role enum", () => {
    const parsed = marketingEnquirySchema.safeParse({
      ...base,
      role: "CEO" as unknown as "Doctor",
    });
    expect(parsed.success).toBe(false);
  });
});

describe("zodIssuesToFieldErrors", () => {
  it("maps issues onto {field, message} pairs keyed by dotted path", () => {
    const parsed = marketingEnquirySchema.safeParse({
      fullName: "",
      email: "abc",
      hospitalName: "",
      hospitalSize: "giant",
      role: "CEO",
      message: "tiny",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const errors = zodIssuesToFieldErrors(parsed.error.issues);
      const fields = errors.map((e) => e.field);
      expect(fields).toEqual(
        expect.arrayContaining([
          "fullName",
          "email",
          "hospitalName",
          "hospitalSize",
          "role",
          "message",
        ])
      );
      for (const e of errors) {
        expect(typeof e.message).toBe("string");
        expect(e.message.length).toBeGreaterThan(0);
      }
    }
  });

  it("returns '_root' for issues without a path", () => {
    const errors = zodIssuesToFieldErrors([
      {
        code: "custom",
        message: "general failure",
        path: [],
      } as unknown as Parameters<typeof zodIssuesToFieldErrors>[0][number],
    ]);
    expect(errors[0]?.field).toBe("_root");
  });
});
