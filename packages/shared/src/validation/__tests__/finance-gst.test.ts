import { describe, it, expect } from "vitest";
import {
  categorizeService,
  computeLineItemTax,
  gstRateForCategory,
  hsnSacForCategory,
  GST_RATE_BY_CATEGORY,
} from "../finance";

describe("gstRateForCategory", () => {
  it("returns 0 for CONSULTATION (exempt)", () => {
    expect(gstRateForCategory("CONSULTATION")).toBe(0);
  });
  it("returns 12 for MEDICINE / LAB / RADIOLOGY / ROOM_CHARGE", () => {
    expect(gstRateForCategory("MEDICINE")).toBe(12);
    expect(gstRateForCategory("PHARMACY")).toBe(12);
    expect(gstRateForCategory("LAB")).toBe(12);
    expect(gstRateForCategory("RADIOLOGY")).toBe(12);
    expect(gstRateForCategory("ROOM_CHARGE")).toBe(12);
  });
  it("returns 18 for PROCEDURE / SURGERY / OTHER", () => {
    expect(gstRateForCategory("PROCEDURE")).toBe(18);
    expect(gstRateForCategory("SURGERY")).toBe(18);
    expect(gstRateForCategory("OTHER")).toBe(18);
  });
  it("is case-insensitive", () => {
    expect(gstRateForCategory("consultation")).toBe(0);
    expect(gstRateForCategory("surgery")).toBe(18);
  });
  it("falls back to DEFAULT_GST_PERCENT (18) for unknown categories", () => {
    expect(gstRateForCategory("XYZ")).toBe(18);
    expect(gstRateForCategory(null)).toBe(18);
    expect(gstRateForCategory(undefined)).toBe(18);
  });
  it("exposes an up-to-date table (sanity)", () => {
    expect(GST_RATE_BY_CATEGORY.CONSULTATION).toBe(0);
    expect(GST_RATE_BY_CATEGORY.SURGERY).toBe(18);
  });
});

describe("hsnSacForCategory", () => {
  it("uses SAC 9993 for health services", () => {
    expect(hsnSacForCategory("CONSULTATION")).toBe("9993");
    expect(hsnSacForCategory("PROCEDURE")).toBe("9993");
    expect(hsnSacForCategory("LAB")).toBe("9993");
    expect(hsnSacForCategory("RADIOLOGY")).toBe("9993");
    expect(hsnSacForCategory("ROOM_CHARGE")).toBe("9993");
    expect(hsnSacForCategory("SURGERY")).toBe("9993");
  });
  it("uses HSN 3004 for medicines (goods)", () => {
    expect(hsnSacForCategory("MEDICINE")).toBe("3004");
    expect(hsnSacForCategory("PHARMACY")).toBe("3004");
  });
  it("falls back to 9993 for unknown / null", () => {
    expect(hsnSacForCategory(null)).toBe("9993");
    expect(hsnSacForCategory("WIDGETS")).toBe("9993");
  });
});

describe("computeLineItemTax", () => {
  it("splits 18% GST into equal halves (CGST + SGST)", () => {
    const r = computeLineItemTax(1000, "SURGERY");
    expect(r.taxable).toBe(1000);
    expect(r.gstRate).toBe(18);
    expect(r.cgst).toBe(90);
    expect(r.sgst).toBe(90);
    expect(r.total).toBe(1180);
    expect(r.hsnSac).toBe("9993");
  });
  it("computes 12% on LAB", () => {
    const r = computeLineItemTax(500, "LAB");
    expect(r.cgst).toBe(30);
    expect(r.sgst).toBe(30);
    expect(r.total).toBe(560);
  });
  it("leaves CONSULTATION untaxed (exempt health-care service)", () => {
    const r = computeLineItemTax(800, "CONSULTATION");
    expect(r.cgst).toBe(0);
    expect(r.sgst).toBe(0);
    expect(r.total).toBe(800);
  });
  it("handles rounding-sensitive amounts without drift", () => {
    const r = computeLineItemTax(99.99, "MEDICINE");
    // 12% of 99.99 = 11.9988 → halves 5.9994 → round to 6.00 each
    // taxAmount rounded = 12.00, half = 6.00 each → cgst + sgst = 12.00.
    expect(+(r.cgst + r.sgst).toFixed(2)).toBe(12);
    expect(r.total).toBe(+(r.taxable + r.cgst + r.sgst).toFixed(2));
  });
});

describe("categorizeService", () => {
  it("maps imaging keywords to RADIOLOGY", () => {
    expect(categorizeService("X-Ray Chest")).toBe("RADIOLOGY");
    expect(categorizeService("X ray chest PA")).toBe("RADIOLOGY");
    expect(categorizeService("MRI Brain")).toBe("RADIOLOGY");
    expect(categorizeService("CT Abdomen")).toBe("RADIOLOGY");
    expect(categorizeService("Ultrasound Pelvis")).toBe("RADIOLOGY");
  });
  it("maps surgery terms to SURGERY", () => {
    expect(categorizeService("Appendectomy")).toBe("SURGERY");
    expect(categorizeService("Surgery — Hernia")).toBe("SURGERY");
  });
  it("maps procedure terms to PROCEDURE", () => {
    expect(categorizeService("Endoscopy")).toBe("PROCEDURE");
    expect(categorizeService("ECG")).toBe("PROCEDURE");
    expect(categorizeService("Dressing change")).toBe("PROCEDURE");
  });
  it("maps lab-y terms to LAB", () => {
    expect(categorizeService("Lipid Panel")).toBe("LAB");
    expect(categorizeService("CBC")).toBe("LAB");
    expect(categorizeService("Urine Culture")).toBe("LAB");
    expect(categorizeService("HbA1c")).toBe("LAB");
  });
  it("maps pharmacy terms to MEDICINE", () => {
    expect(categorizeService("Tablet Crocin 500mg")).toBe("MEDICINE");
    expect(categorizeService("Injection Vitamin B12")).toBe("MEDICINE");
    expect(categorizeService("Antibiotic Syrup")).toBe("MEDICINE");
  });
  it("maps bed / room terms to ROOM_CHARGE", () => {
    expect(categorizeService("ICU Bed")).toBe("ROOM_CHARGE");
    expect(categorizeService("Room charge — Deluxe")).toBe("ROOM_CHARGE");
    expect(categorizeService("Private Cabin")).toBe("ROOM_CHARGE");
  });
  it("maps consultation wording to CONSULTATION", () => {
    expect(categorizeService("Consultation — General Medicine")).toBe(
      "CONSULTATION"
    );
    expect(categorizeService("Follow-up visit")).toBe("CONSULTATION");
  });
  it("falls back to CONSULTATION for unknown / empty service names", () => {
    expect(categorizeService("")).toBe("CONSULTATION");
    expect(categorizeService(null)).toBe("CONSULTATION");
    expect(categorizeService(undefined)).toBe("CONSULTATION");
    expect(categorizeService("random service")).toBe("CONSULTATION");
  });
});
