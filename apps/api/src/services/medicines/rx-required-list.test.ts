import { describe, it, expect } from "vitest";
import {
  isRxRequired,
  matchingRxSubstrings,
  RX_REQUIRED_SUBSTRINGS,
} from "./rx-required-list";
import { serializeMedicine } from "./serialize";

describe("isRxRequired", () => {
  // ── Regression for Issue #40: prescription-only drugs must return true ──
  it.each([
    ["Amlodipine 5mg"],
    ["AMLODIPINE 10MG"],
    ["amlodipine besylate"],
    ["Atenolol 50mg"],
    ["Atorvastatin 10mg"],
    ["Rosuvastatin 20mg"],
    ["Losartan 50mg"],
    ["Enalapril 5mg"],
    ["Metoprolol 25mg"],
    ["Clopidogrel 75mg"],
    ["Warfarin 5mg"],
    ["Rivaroxaban 15mg"],
    ["Apixaban 2.5mg"],
    ["Insulin Regular 100IU/ml"],
    ["Metformin 500mg"],
    ["Glimepiride 2mg"],
    ["Sitagliptin 100mg"],
    ["Empagliflozin 10mg"],
    ["Sertraline 50mg"],
    ["Escitalopram 10mg"],
    ["Fluoxetine 20mg"],
    ["Alprazolam 0.25mg"],
    ["Clonazepam 0.5mg"],
    ["Diazepam 5mg"],
    ["Zolpidem 10mg"],
    ["Amitriptyline 25mg"],
    ["Quetiapine 100mg"],
    ["Olanzapine 5mg"],
    ["Risperidone 2mg"],
    ["Amoxicillin 500mg"],
    ["Azithromycin 500mg"],
    ["Ciprofloxacin 500mg"],
    ["Levofloxacin 500mg"],
    ["Metronidazole 400mg"],
    ["Ceftriaxone 1g"],
    ["Doxycycline 100mg"],
    ["Erythromycin 250mg"],
    ["Levothyroxine 50mcg"],
    ["Methotrexate 2.5mg"],
    ["Prednisolone 5mg"],
    ["Tramadol 50mg"],
    ["Codeine 15mg"],
    ["Morphine 10mg"],
  ])("%s is flagged as prescription-only", (name) => {
    expect(isRxRequired(name)).toBe(true);
  });

  // ── Genuinely OTC drugs must stay false ────────────────────────────────
  it.each([
    ["Paracetamol 500mg"],
    ["Ibuprofen 400mg"],
    ["Cetirizine 10mg"],
    ["Loratadine 10mg"],
    ["Folic Acid 5mg"],
    ["Vitamin B12 1500mcg"],
    ["Vitamin D3 60000IU"],
    ["Calcium Carbonate 500mg"],
    ["ORS Sachet"],
    ["Iron + Folic Acid"],
  ])("%s is NOT flagged (OTC)", (name) => {
    expect(isRxRequired(name)).toBe(false);
  });

  it("handles object inputs (name + genericName)", () => {
    expect(
      isRxRequired({ name: "Amlokind 5mg", genericName: "Amlodipine" })
    ).toBe(true);
    expect(
      isRxRequired({ name: "Crocin 500mg", genericName: "Paracetamol" })
    ).toBe(false);
  });

  it("handles empty / null inputs gracefully", () => {
    expect(isRxRequired("")).toBe(false);
    expect(isRxRequired({ name: null, genericName: null })).toBe(false);
    expect(isRxRequired({})).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isRxRequired("AMOXICILLIN")).toBe(true);
    expect(isRxRequired("amoxicillin")).toBe(true);
    expect(isRxRequired("Amoxicillin")).toBe(true);
  });
});

describe("matchingRxSubstrings", () => {
  it("returns all matching substrings for combo products", () => {
    const matches = matchingRxSubstrings("Amoxicillin + Clavulanate 625mg");
    expect(matches).toContain("amoxicillin");
  });

  it("returns an empty array for OTC drugs", () => {
    expect(matchingRxSubstrings("Paracetamol 500mg")).toEqual([]);
  });
});

describe("RX_REQUIRED_SUBSTRINGS catalog invariants", () => {
  it("has no duplicate entries", () => {
    const set = new Set(RX_REQUIRED_SUBSTRINGS);
    expect(set.size).toBe(RX_REQUIRED_SUBSTRINGS.length);
  });

  it("entries are all lowercase and trimmed", () => {
    for (const s of RX_REQUIRED_SUBSTRINGS) {
      expect(s).toBe(s.toLowerCase());
      expect(s).toBe(s.trim());
      expect(s.length).toBeGreaterThan(2);
    }
  });

  it("does NOT contain known OTC drugs (regression guard)", () => {
    const otc = [
      "paracetamol",
      "ibuprofen",
      "cetirizine",
      "loratadine",
      "folic acid",
      "calcium carbonate",
      "ors",
    ];
    for (const o of otc) {
      expect(RX_REQUIRED_SUBSTRINGS).not.toContain(o);
    }
  });
});

describe("serializeMedicine (API alias layer)", () => {
  it("exposes rxRequired as alias of prescriptionRequired", () => {
    const row = {
      id: "m1",
      name: "Amlodipine 5mg",
      prescriptionRequired: true,
      brand: "Amlokind",
    };
    const out = serializeMedicine(row);
    expect(out.rxRequired).toBe(true);
    expect(out.manufacturer).toBe("Amlokind");
    // Raw fields are preserved for backward compat
    expect(out.prescriptionRequired).toBe(true);
    expect(out.brand).toBe("Amlokind");
  });

  it("defaults rxRequired=true when prescriptionRequired is null/undefined", () => {
    const row = { id: "m1", name: "Unknown drug" };
    const out = serializeMedicine(row);
    expect(out.rxRequired).toBe(true);
  });

  it("passes null manufacturer through (not string 'null')", () => {
    const row = {
      id: "m1",
      name: "Paracetamol",
      prescriptionRequired: false,
      brand: null,
    };
    const out = serializeMedicine(row);
    expect(out.manufacturer).toBeNull();
    expect(out.rxRequired).toBe(false);
  });
});
