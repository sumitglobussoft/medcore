import { describe, it, expect } from "vitest";
import {
  sanitizeUserInput,
  containsHtmlOrScript,
  validatePasswordStrength,
  isCommonPassword,
  COMMON_PASSWORD_DENYLIST,
} from "../security";
import { registerSchema, changePasswordSchema, resetPasswordSchema } from "../auth";

describe("sanitizeUserInput (Issues #248, #260, #265, #284, #292)", () => {
  it("accepts an ordinary name", () => {
    const r = sanitizeUserInput("Alice Smith", { field: "Name" });
    expect(r.ok).toBe(true);
    expect(r.value).toBe("Alice Smith");
  });

  it("collapses internal whitespace", () => {
    const r = sanitizeUserInput("  Alice    Smith  ");
    expect(r.ok).toBe(true);
    expect(r.value).toBe("Alice Smith");
  });

  it("rejects empty / whitespace-only", () => {
    expect(sanitizeUserInput("   ").ok).toBe(false);
    expect(sanitizeUserInput("").ok).toBe(false);
  });

  it("rejects strings exceeding maxLength", () => {
    const r = sanitizeUserInput("A".repeat(101), { maxLength: 100 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/at most 100/);
  });

  // Issue #284: staff name XSS payloads
  it("rejects <script> tag (Issue #284)", () => {
    const r = sanitizeUserInput("Staff <script>alert(1)</script>");
    expect(r.ok).toBe(false);
  });

  // Issue #265: profile name → sidebar XSS
  it("rejects profile-name `<script>alert(\"xss\")</script>` (Issue #265)", () => {
    const r = sanitizeUserInput('<script>alert("xss")</script>');
    expect(r.ok).toBe(false);
  });

  // Issue #248: profile Full Name raw HTML
  it("rejects raw <img> tag (Issue #248)", () => {
    const r = sanitizeUserInput('<img src=x onerror=alert(1)>');
    expect(r.ok).toBe(false);
  });

  // Issue #260: walk-in patient name with html
  it("rejects walk-in name with `<b>X</b>` (Issue #260)", () => {
    const r = sanitizeUserInput("<b>Walk-in</b>");
    expect(r.ok).toBe(false);
  });

  // Issue #292: holiday name partial-strip vector
  it('rejects "Test Holiday <script>alert(1)</script>" (Issue #292)', () => {
    const r = sanitizeUserInput("Test Holiday <script>alert(1)</script>");
    expect(r.ok).toBe(false);
    // CRITICAL: should NOT silently strip and keep "Test Holiday alert(1)".
    expect(r.value).toBeUndefined();
  });

  it("rejects javascript: URL scheme", () => {
    expect(sanitizeUserInput("javascript:alert(1)").ok).toBe(false);
  });

  it("rejects inline event handlers like onerror=", () => {
    expect(sanitizeUserInput("hello onerror=alert(1)").ok).toBe(false);
  });

  it("rejects HTML-entity-encoded < (e.g. &lt;)", () => {
    expect(sanitizeUserInput("foo &lt;script&gt;").ok).toBe(false);
  });
});

describe("containsHtmlOrScript", () => {
  it("returns true for tag-shaped substrings", () => {
    expect(containsHtmlOrScript("<i>")).toBe(true);
    expect(containsHtmlOrScript("not a < tag")).toBe(false);
  });
});

describe("validatePasswordStrength + COMMON_PASSWORD_DENYLIST (Issues #266, #285)", () => {
  it("rejects passwords shorter than 8 chars", () => {
    expect(validatePasswordStrength("a1").ok).toBe(false);
  });

  it("rejects 12345678 (no letter)", () => {
    expect(validatePasswordStrength("12345678").ok).toBe(false);
  });

  it("rejects abcdefgh (no digit)", () => {
    expect(validatePasswordStrength("abcdefgh").ok).toBe(false);
  });

  // Issue #266: the `123456` regression — must reject explicitly.
  it("rejects `123456` even with the new rules (Issue #266)", () => {
    expect(validatePasswordStrength("123456").ok).toBe(false);
  });

  // Issue #285: the `password1` denylist hit.
  it("rejects `password1` via denylist (Issue #285)", () => {
    expect(validatePasswordStrength("password1").ok).toBe(false);
    expect(isCommonPassword("password1")).toBe(true);
  });

  it("rejects denylisted variants regardless of case", () => {
    expect(isCommonPassword("Password1")).toBe(true);
    expect(isCommonPassword("PASSWORD1")).toBe(true);
    expect(isCommonPassword("admin123")).toBe(true);
    expect(isCommonPassword("qwerty123")).toBe(true);
  });

  it("denylist contains at least 100 entries", () => {
    expect(COMMON_PASSWORD_DENYLIST.size).toBeGreaterThanOrEqual(100);
  });

  it("accepts a strong unique password", () => {
    expect(validatePasswordStrength("Br0nzeFalc0n!").ok).toBe(true);
  });
});

describe("registerSchema enforces strong password (Issues #266, #285)", () => {
  const valid = {
    name: "Alice",
    email: "alice@example.com",
    phone: "9000000000",
    role: "DOCTOR" as const,
  };
  it("rejects `123456`", () => {
    expect(
      registerSchema.safeParse({ ...valid, password: "123456" }).success
    ).toBe(false);
  });
  it("rejects `password1`", () => {
    expect(
      registerSchema.safeParse({ ...valid, password: "password1" }).success
    ).toBe(false);
  });
  it("rejects `admin123`", () => {
    expect(
      registerSchema.safeParse({ ...valid, password: "admin123" }).success
    ).toBe(false);
  });
  it("accepts a strong unique password", () => {
    expect(
      registerSchema.safeParse({ ...valid, password: "Br0nzeFalc0n!" }).success
    ).toBe(true);
  });
});

describe("changePasswordSchema rejects denylisted new password (Issue #266)", () => {
  it("rejects `password1` for newPassword", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "anything",
        newPassword: "password1",
      }).success
    ).toBe(false);
  });
});

describe("resetPasswordSchema rejects denylisted new password (Issue #266)", () => {
  it("rejects `qwerty123` for newPassword", () => {
    expect(
      resetPasswordSchema.safeParse({
        email: "a@b.com",
        code: "123456",
        newPassword: "qwerty123",
      }).success
    ).toBe(false);
  });
});
