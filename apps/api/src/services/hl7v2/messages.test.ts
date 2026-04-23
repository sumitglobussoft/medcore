/**
 * Unit tests for HL7 v2.5.1 message builders, segment primitives, and parser.
 *
 * These tests cover the invariants in the HL7 v2 spec that legacy lab /
 * HIS integrations depend on — field positions, escaping, CR-only segment
 * terminators, and value-type inference for OBX-2.
 */

import { describe, it, expect } from "vitest";
import {
  buildADT_A04,
  buildORM_O01,
  buildORU_R01,
  HL7_VERSION,
  type HL7Patient,
  type HL7LabOrder,
  type HL7LabResult,
} from "./messages";
import {
  MSH,
  PID,
  escapeField,
  unescapeField,
  formatTs,
  formatDate,
} from "./segments";
import {
  parseMessage,
  getField,
  getComponent,
  getSegments,
  parseComponents,
} from "./parser";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const patient: HL7Patient = {
  id: "pat-001",
  mrNumber: "MR-12345",
  gender: "MALE",
  dateOfBirth: new Date("1985-06-15T00:00:00Z"),
  address: "12 Park Street, Kolkata",
  abhaId: "14-1234-5678-9012",
  user: {
    name: "Arjun Kumar Sharma",
    phone: "+919876543210",
    email: "arjun@example.com",
  },
};

const labOrder: HL7LabOrder = {
  id: "order-001",
  orderNumber: "LAB-2026-0001",
  orderedAt: new Date("2026-04-23T09:30:00Z"),
  collectedAt: new Date("2026-04-23T09:45:00Z"),
  completedAt: new Date("2026-04-23T11:00:00Z"),
  status: "COMPLETED",
  priority: "ROUTINE",
  patient,
  doctor: { id: "doc-001", user: { name: "Priya Nair" } },
  items: [
    { id: "item-1", test: { code: "CBC", name: "Complete Blood Count" } },
    { id: "item-2", test: { code: "LFT", name: "Liver Function Test" } },
  ],
};

const labResults: HL7LabResult[] = [
  {
    id: "res-1",
    orderItemId: "item-1",
    parameter: "Hemoglobin",
    value: "13.5",
    unit: "g/dL",
    normalRange: "12-16",
    flag: "NORMAL",
    verifiedAt: new Date("2026-04-23T11:00:00Z"),
    reportedAt: new Date("2026-04-23T10:55:00Z"),
  },
  {
    id: "res-2",
    orderItemId: "item-1",
    parameter: "Color",
    value: "Yellow",
    flag: "NORMAL",
    verifiedAt: new Date("2026-04-23T11:00:00Z"),
    reportedAt: new Date("2026-04-23T10:55:00Z"),
  },
  {
    id: "res-3",
    orderItemId: "item-2",
    parameter: "ALT",
    value: "85",
    unit: "U/L",
    normalRange: "7-56",
    flag: "HIGH",
    verifiedAt: new Date("2026-04-23T11:00:00Z"),
    reportedAt: new Date("2026-04-23T10:55:00Z"),
  },
];

// ─── Segment primitives ─────────────────────────────────────────────────────

describe("escapeField", () => {
  it("escapes all five reserved delimiters", () => {
    expect(escapeField("a|b")).toBe("a\\F\\b");
    expect(escapeField("a^b")).toBe("a\\S\\b");
    expect(escapeField("a~b")).toBe("a\\R\\b");
    expect(escapeField("a&b")).toBe("a\\T\\b");
    expect(escapeField("a\\b")).toBe("a\\E\\b");
  });

  it("returns empty string for null/undefined", () => {
    expect(escapeField(null)).toBe("");
    expect(escapeField(undefined)).toBe("");
  });

  it("escapes combined delimiters without double-escaping the escape char", () => {
    const input = "a|b^c\\d";
    const escaped = escapeField(input);
    // Must round-trip through unescape back to the original.
    expect(unescapeField(escaped)).toBe(input);
  });
});

describe("formatTs / formatDate", () => {
  it("produces YYYYMMDDHHMMSS from a Date", () => {
    expect(formatTs(new Date("2026-04-23T14:05:30Z"))).toBe("20260423140530");
  });
  it("produces YYYYMMDD from formatDate", () => {
    expect(formatDate(new Date("2026-04-23T14:05:30Z"))).toBe("20260423");
  });
  it("returns empty string for null", () => {
    expect(formatTs(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
  });
});

// ─── MSH segment shape ──────────────────────────────────────────────────────

describe("MSH segment", () => {
  const msh = MSH({
    sendingApplication: "MEDCORE",
    sendingFacility: "MEDCORE_HIS",
    receivingApplication: "LABCORP",
    receivingFacility: "LAB01",
    timestamp: new Date("2026-04-23T10:00:00Z"),
    messageType: { code: "ADT", trigger: "A04", structure: "ADT_A01" },
    controlId: "CTRL123",
  });

  it("starts with 'MSH|^~\\&|' (field sep then encoding chars)", () => {
    expect(msh.startsWith("MSH|^~\\&|")).toBe(true);
  });

  it("populates sender, receiver, message type and control id in the right slots", () => {
    const parts = msh.split("|");
    // parts[0]=MSH, parts[1]=encoding, parts[2]=sendingApp, parts[3]=sendingFac,
    // parts[4]=recvApp, parts[5]=recvFac, parts[6]=timestamp, parts[7]=security,
    // parts[8]=msgType, parts[9]=controlId, parts[10]=processingId, parts[11]=version
    expect(parts[0]).toBe("MSH");
    expect(parts[1]).toBe("^~\\&");
    expect(parts[2]).toBe("MEDCORE");
    expect(parts[3]).toBe("MEDCORE_HIS");
    expect(parts[4]).toBe("LABCORP");
    expect(parts[5]).toBe("LAB01");
    expect(parts[6]).toBe("20260423100000");
    expect(parts[8]).toBe("ADT^A04^ADT_A01");
    expect(parts[9]).toBe("CTRL123");
    expect(parts[10]).toBe("P");
    expect(parts[11]).toBe(HL7_VERSION);
  });

  it("carries UNICODE UTF-8 in MSH-18", () => {
    const parts = msh.split("|");
    // index in parts array: parts[1] is MSH-2; parts[17] is MSH-18
    expect(parts[17]).toBe("UNICODE UTF-8");
  });
});

// ─── PID segment ────────────────────────────────────────────────────────────

describe("PID segment", () => {
  const pid = PID({
    mrNumber: "MR-12345",
    familyName: "Sharma",
    givenName: "Arjun Kumar",
    dateOfBirth: new Date("1985-06-15T00:00:00Z"),
    gender: "M",
    phone: "+919876543210",
    address: { line: "12 Park Street", city: "Kolkata", state: "WB", country: "IN" },
  });

  it("places MR number at PID-3 (components: id^^^MR^MR)", () => {
    const parts = pid.split("|");
    expect(parts[0]).toBe("PID");
    // parts[1]=PID-1 set id, parts[3]=PID-3
    expect(parts[3].startsWith("MR-12345")).toBe(true);
    expect(parts[3]).toBe("MR-12345^^^MR^MR");
  });

  it("places name at PID-5 as family^given", () => {
    const parts = pid.split("|");
    expect(parts[5]).toBe("Sharma^Arjun Kumar");
  });

  it("places DOB at PID-7 in YYYYMMDD form", () => {
    const parts = pid.split("|");
    expect(parts[7]).toBe("19850615");
  });

  it("places gender at PID-8", () => {
    const parts = pid.split("|");
    expect(parts[8]).toBe("M");
  });

  it("places address at PID-11 with proper component structure", () => {
    const parts = pid.split("|");
    // line^otherDesignation^city^state^postalCode^country
    expect(parts[11]).toBe("12 Park Street^^Kolkata^WB^^IN");
  });
});

// ─── Field escaping — reserved chars in data ────────────────────────────────

describe("PID — reserved characters in patient name are escaped", () => {
  const pid = PID({
    mrNumber: "MR-1",
    familyName: "O|Brien",        // `|` should become \F\
    givenName: "Anne^Marie",       // `^` should become \S\
    gender: "F",
  });

  it("escapes | as \\F\\ in the family name", () => {
    expect(pid.includes("O\\F\\Brien")).toBe(true);
  });
  it("escapes ^ as \\S\\ in the given name", () => {
    expect(pid.includes("Anne\\S\\Marie")).toBe(true);
  });
  it("does NOT emit a literal | inside the name slot", () => {
    const parts = pid.split("|");
    // PID-5 should be exactly "O\F\Brien^Anne\S\Marie"
    expect(parts[5]).toBe("O\\F\\Brien^Anne\\S\\Marie");
  });
});

// ─── ADT^A04 round-trip: build → parse → verify ─────────────────────────────

describe("ADT^A04 round-trip", () => {
  const msg = buildADT_A04(patient, {
    visitNumber: "V-001",
    patientClass: "O",
    admittedAt: new Date("2026-04-23T09:00:00Z"),
    attendingDoctor: { id: "doc-001", name: "Priya Nair" },
  });

  it("message uses CR segment terminator (no LF anywhere)", () => {
    expect(msg.includes("\n")).toBe(false);
    expect(msg.includes("\r")).toBe(true);
  });

  it("ends with a trailing CR", () => {
    expect(msg.endsWith("\r")).toBe(true);
  });

  it("contains MSH, PID, and PV1 segments in order", () => {
    const segs = msg.split("\r").filter((s) => s.length > 0);
    expect(segs[0].startsWith("MSH")).toBe(true);
    expect(segs[1].startsWith("PID")).toBe(true);
    expect(segs[2].startsWith("PV1")).toBe(true);
  });

  it("parses back and PID-5 matches the original family/given names", () => {
    const parsed = parseMessage(msg);
    const pid5 = getField(parsed, "PID", 5);
    expect(pid5).toBeDefined();
    const [family, given] = parseComponents(pid5!);
    expect(family).toBe("Sharma");
    expect(given).toBe("Arjun Kumar");
  });

  it("parser exposes MSH message type as ADT^A04^ADT_A01 at field 9", () => {
    const parsed = parseMessage(msg);
    // For MSH, fields are: [id=MSH, fieldSep, encodingChars, sendApp, sendFac, recvApp, recvFac, ts, sec, msgType, ctrl, proc, ver, ...]
    // So message type is fields[9]
    const msgType = parsed.segments[0].fields[9];
    expect(msgType).toBe("ADT^A04^ADT_A01");
  });

  it("round-trip preserves escaped `|` inside a name", () => {
    const weird: HL7Patient = {
      ...patient,
      user: { name: "O|Brien Shaun", phone: "", email: "" },
    };
    const m = buildADT_A04(weird, {});
    const parsed = parseMessage(m);
    const pid5 = getField(parsed, "PID", 5);
    const [family] = parseComponents(pid5!);
    // Family is the LAST token after splitName -> "Shaun"? depends on our splitter:
    // splitName("O|Brien Shaun") -> family=Shaun, given=O|Brien.
    // The ESCAPE is the thing we really care about, so check given-name round-trip.
    const [, given] = parseComponents(pid5!);
    expect(given).toBe("O|Brien");
    expect(family).toBe("Shaun");
  });
});

// ─── ORM^O01 with multiple OBR segments ─────────────────────────────────────

describe("ORM^O01", () => {
  const msg = buildORM_O01(labOrder);
  const parsed = parseMessage(msg);

  it("emits one ORC and one OBR per order item (2 items → 2 ORC + 2 OBR)", () => {
    expect(getSegments(parsed, "ORC").length).toBe(2);
    expect(getSegments(parsed, "OBR").length).toBe(2);
  });

  it("OBR-4 carries test code^name (component structure)", () => {
    const obrs = getSegments(parsed, "OBR");
    const obr1 = obrs[0].fields[4];
    const [code, name] = parseComponents(obr1);
    expect(code).toBe("CBC");
    expect(name).toBe("Complete Blood Count");
  });

  it("uses CR segment terminator only (no LF)", () => {
    expect(msg.includes("\n")).toBe(false);
  });

  it("MSH-9 message type is ORM^O01^ORM_O01", () => {
    expect(parsed.segments[0].fields[9]).toBe("ORM^O01^ORM_O01");
  });
});

// ─── ORU^R01 with multiple OBX segments ─────────────────────────────────────

describe("ORU^R01", () => {
  const msg = buildORU_R01(labOrder, labResults);
  const parsed = parseMessage(msg);

  it("emits one OBX per lab result (3 results)", () => {
    expect(getSegments(parsed, "OBX").length).toBe(3);
  });

  it("emits one OBR per order item (2 items)", () => {
    expect(getSegments(parsed, "OBR").length).toBe(2);
  });

  it("MSH-9 is ORU^R01^ORU_R01", () => {
    expect(parsed.segments[0].fields[9]).toBe("ORU^R01^ORU_R01");
  });

  it("numeric result ('13.5') gets OBX-2 = NM", () => {
    const obxs = getSegments(parsed, "OBX");
    // First OBX is Hemoglobin=13.5 (NM)
    expect(obxs[0].fields[2]).toBe("NM");
  });

  it("string result ('Yellow') gets OBX-2 = ST", () => {
    const obxs = getSegments(parsed, "OBX");
    // Second OBX is Color=Yellow (ST)
    expect(obxs[1].fields[2]).toBe("ST");
  });

  it("HIGH flag maps to OBX-8 = 'H'", () => {
    const obxs = getSegments(parsed, "OBX");
    // Third OBX is ALT=85 with flag HIGH
    expect(obxs[2].fields[8]).toBe("H");
  });

  it("OBX-5 carries the raw value and OBX-6 carries the unit", () => {
    const obxs = getSegments(parsed, "OBX");
    expect(obxs[0].fields[5]).toBe("13.5");
    expect(obxs[0].fields[6]).toBe("g/dL");
  });

  it("OBX-7 carries the reference range", () => {
    const obxs = getSegments(parsed, "OBX");
    expect(obxs[0].fields[7]).toBe("12-16");
  });

  it("ends with a trailing CR", () => {
    expect(msg.endsWith("\r")).toBe(true);
  });
});

// ─── Character set / MSH-18 ─────────────────────────────────────────────────

describe("Character set", () => {
  it("MSH-18 carries UNICODE UTF-8 when patient name contains non-ASCII", () => {
    const unicodePatient: HL7Patient = {
      ...patient,
      user: { name: "राहुल शर्मा", phone: "", email: "" }, // Devanagari
    };
    const msg = buildADT_A04(unicodePatient, {});
    const parsed = parseMessage(msg);
    // MSH-18 is at fields[18]
    expect(parsed.segments[0].fields[18]).toBe("UNICODE UTF-8");
    // And the name survived round-trip.
    const pid5 = getField(parsed, "PID", 5);
    expect(pid5).toBeDefined();
    expect(pid5!.includes("शर्मा")).toBe(true);
  });
});

// ─── CR / LF assertions (belt and braces) ───────────────────────────────────

describe("segment terminator discipline", () => {
  it("buildORM_O01 produces no LF bytes", () => {
    const msg = buildORM_O01(labOrder);
    for (const ch of msg) {
      expect(ch).not.toBe("\n");
    }
  });

  it("buildORU_R01 ends with exactly one trailing CR after the last OBX", () => {
    const msg = buildORU_R01(labOrder, labResults);
    expect(msg.endsWith("\r")).toBe(true);
    // And it should not end with "\r\r" — only one trailing terminator.
    expect(msg.endsWith("\r\r")).toBe(false);
  });
});

// ─── parser: getComponent helper ────────────────────────────────────────────

describe("parser helpers", () => {
  const msg = buildADT_A04(patient, {});
  const parsed = parseMessage(msg);

  it("getComponent returns PID-5.1 (family name)", () => {
    expect(getComponent(parsed, "PID", 5, 1)).toBe("Sharma");
  });
  it("getComponent returns PID-5.2 (given name)", () => {
    expect(getComponent(parsed, "PID", 5, 2)).toBe("Arjun Kumar");
  });
  it("delimiters on the parsed message reflect the canonical set", () => {
    expect(parsed.delimiters).toEqual({
      field: "|",
      component: "^",
      repetition: "~",
      escape: "\\",
      subcomponent: "&",
    });
  });
});
