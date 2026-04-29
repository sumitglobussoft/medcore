// Tests for the canonical INR currency formatter (Issue #298).
//
// Guards the invariants:
//   1. always uses the ₹ glyph — never "Rs." / "INR " / "INR."
//   2. uses Indian-locale grouping (1,23,456 not 123,456)
//   3. always renders 2 decimal places for whole-rupee values
//   4. degrades gracefully to "—" for null/undefined/NaN/Infinity
import { describe, it, expect } from "vitest";
import { formatINR, formatINRorDash } from "../currency";

describe("formatINR — Issue #298 canonical INR formatter", () => {
  it("uses Indian-locale comma grouping (1,23,456 not 123,456)", () => {
    const out = formatINR(123456);
    expect(out).toContain("1,23,456");
  });

  it("renders the ₹ glyph, never 'Rs.' or 'INR'", () => {
    const out = formatINR(1234.5);
    expect(out).toContain("₹");
    expect(out).not.toMatch(/Rs\./);
    expect(out).not.toMatch(/\bINR\b/);
  });

  it("always shows two decimal places for whole rupees", () => {
    expect(formatINR(0)).toMatch(/\.00/);
    expect(formatINR(100)).toMatch(/\.00/);
    expect(formatINR(99.5)).toMatch(/\.50/);
  });

  it("returns the placeholder em-dash for null / undefined", () => {
    expect(formatINR(null)).toBe("—");
    expect(formatINR(undefined)).toBe("—");
  });

  it("returns placeholder for NaN / Infinity (no IEEE-754 leakage)", () => {
    expect(formatINR(NaN)).toBe("—");
    expect(formatINR(Infinity)).toBe("—");
    expect(formatINR(-Infinity)).toBe("—");
  });

  it("formats negative amounts with the leading minus sign", () => {
    const out = formatINR(-12345);
    expect(out).toContain("12,345");
    expect(out.startsWith("-") || out.startsWith("−") || out.includes("-")).toBe(true);
  });

  it("formats zero as ₹0.00 (column-alignment-friendly)", () => {
    const out = formatINR(0);
    expect(out).toContain("0.00");
    expect(out).toContain("₹");
  });

  it("handles big-money (lakh, crore) rupee values without precision loss", () => {
    // 1 crore = 10000000 → "1,00,00,000.00"
    expect(formatINR(10000000)).toContain("1,00,00,000");
    // 99 crore exact: the over-payment scenario from Issue #281
    expect(formatINR(990000000)).toContain("99,00,00,000");
  });
});

describe("formatINRorDash — empty-zero variant", () => {
  it("renders ₹0.00 for zero by default", () => {
    expect(formatINRorDash(0)).toContain("0.00");
  });

  it("renders the dash for zero when treatZeroAsEmpty=true", () => {
    expect(formatINRorDash(0, true)).toBe("—");
  });

  it("still renders non-zero values normally with treatZeroAsEmpty=true", () => {
    expect(formatINRorDash(123, true)).toContain("123");
  });
});
