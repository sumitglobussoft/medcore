/**
 * HL7 v2.5.1 message builders — compose segments into complete messages.
 *
 * Each builder takes plain data objects (shape-compatible with Prisma models)
 * and returns a single string with segments joined by `\r` (HL7 segment
 * terminator). The final segment also ends with `\r` — many legacy parsers
 * expect the terminator on every segment including the last.
 *
 * Why we do NOT use \r\n: HL7 v2 §2.3 explicitly defines the segment
 * terminator as carriage return (0x0D). LF is reserved and many parsers
 * will treat it as part of the previous field's data.
 */

import {
  MSH,
  PID,
  PV1,
  ORC,
  OBR,
  OBX,
  SEGMENT_TERMINATOR,
  HL7_VERSION,
  type MSHData,
  type PIDData,
  type PV1Data,
  type ORCData,
  type OBRData,
  type OBXData,
} from "./segments";

// Re-export version for consumers
export { HL7_VERSION };

// ─── Input shapes ───────────────────────────────────────────────────────────

/** A thin patient projection — populated from `prisma.patient.findUnique({ include: { user: true } })`. */
export interface HL7Patient {
  id: string;
  mrNumber: string;
  gender: string | null;
  dateOfBirth: Date | string | null;
  address: string | null;
  abhaId?: string | null;
  user?: { name: string; phone?: string | null; email?: string | null } | null;
}

/** Admission data for ADT^A04 (registration). */
export interface HL7Admission {
  /** Visit / admission number. */
  visitNumber?: string;
  /** I=inpatient, O=outpatient, E=emergency. Defaults to O for A04 registration. */
  patientClass?: "I" | "O" | "E";
  ward?: string;
  room?: string;
  bed?: string;
  facility?: string;
  admittedAt?: Date | string | null;
  dischargedAt?: Date | string | null;
  attendingDoctor?: { id: string; name: string } | null;
}

/** Lab order projection. */
export interface HL7LabOrder {
  id: string;
  orderNumber: string;
  orderedAt: Date | string;
  collectedAt?: Date | string | null;
  completedAt?: Date | string | null;
  status: string; // ORDERED | SAMPLE_COLLECTED | IN_PROGRESS | COMPLETED | CANCELLED
  priority?: string | null; // ROUTINE | URGENT | STAT
  patient: HL7Patient;
  doctor: { id: string; user?: { name: string } | null } | null;
  items: Array<{
    id: string;
    test: { code: string; name: string };
  }>;
}

/** A single lab result (OBX). */
export interface HL7LabResult {
  id: string;
  orderItemId: string;
  parameter: string;
  value: string;
  unit?: string | null;
  normalRange?: string | null;
  flag?: string | null; // NORMAL | HIGH | LOW | CRITICAL_HIGH | CRITICAL_LOW | ABNORMAL
  verifiedAt?: Date | string | null;
  reportedAt: Date | string;
  verifier?: { id: string; name: string } | null;
  /** Optional — the test code/name for OBX-3. Falls back to parameter if absent. */
  testCode?: string;
  testName?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Best-effort split of "Given Middle Family" into {familyName, givenName}. */
function splitName(full: string | null | undefined): { familyName: string; givenName: string } {
  const text = (full || "").trim();
  if (!text) return { familyName: "Unknown", givenName: "" };
  const parts = text.split(/\s+/);
  if (parts.length === 1) return { familyName: parts[0], givenName: "" };
  return { familyName: parts[parts.length - 1], givenName: parts.slice(0, -1).join(" ") };
}

function mapGender(g: string | null | undefined): "M" | "F" | "O" | "U" {
  switch ((g || "").toUpperCase()) {
    case "MALE":
      return "M";
    case "FEMALE":
      return "F";
    case "OTHER":
      return "O";
    default:
      return "U";
  }
}

/** Map LabResultFlag → OBX-8 abnormal flag codes. */
function mapFlag(flag: string | null | undefined): string | undefined {
  switch ((flag || "").toUpperCase()) {
    case "HIGH":
      return "H";
    case "LOW":
      return "L";
    case "CRITICAL_HIGH":
      return "HH";
    case "CRITICAL_LOW":
      return "LL";
    case "ABNORMAL":
      return "A";
    case "NORMAL":
      return "N";
    default:
      return undefined;
  }
}

/** Map priority string → HL7 OBR-27 priority code. */
function mapPriority(p: string | null | undefined): "S" | "A" | "R" | undefined {
  switch ((p || "").toUpperCase()) {
    case "STAT":
      return "S";
    case "URGENT":
      return "A";
    case "ROUTINE":
      return "R";
    default:
      return undefined;
  }
}

/**
 * Decide OBX-2 value type. If the value parses as a finite number it's NM
 * (numeric); otherwise ST (string). This mirrors how most receivers route
 * values — NM goes to numeric columns, ST to text.
 */
function inferValueType(value: string): "NM" | "ST" {
  if (value === "" || value == null) return "ST";
  const n = Number(value);
  if (!Number.isNaN(n) && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(value.trim())) {
    return "NM";
  }
  return "ST";
}

/**
 * Generate an HL7 control id. Uses timestamp + 4 random digits; 20 chars max
 * per HL7 MSH-10. Deterministic enough for in-flight tracing without pulling
 * in a UUID library.
 */
function generateControlId(): string {
  const ts = Date.now().toString();
  const rnd = Math.floor(Math.random() * 10000).toString().padStart(4, "0");
  return `MC${ts}${rnd}`.slice(0, 20);
}

/** Join a list of segment strings with CR and ensure a trailing CR. */
function assemble(segments: string[]): string {
  return segments.join(SEGMENT_TERMINATOR) + SEGMENT_TERMINATOR;
}

/** Default MSH fields — callers can override via options. */
function defaultMsh(
  messageType: MSHData["messageType"],
  timestamp: Date
): Omit<MSHData, "controlId"> {
  return {
    sendingApplication: "MEDCORE",
    sendingFacility: "MEDCORE_HIS",
    receivingApplication: "RECEIVER",
    receivingFacility: "EXTERNAL",
    timestamp,
    messageType,
    processingId: "P",
    characterSet: "UNICODE UTF-8",
  };
}

// ─── ADT^A04 ────────────────────────────────────────────────────────────────

/**
 * Build an ADT^A04 "Register a Patient" message. Sent when a new patient is
 * registered (often the outpatient equivalent of an admission event). Per
 * HL7 v2.5.1 §3.3.4, the minimum required segments are MSH, EVN, PID, PV1.
 *
 * We omit EVN for brevity (most receivers treat it as optional for A04) —
 * but PV1 is included with the admission context.
 */
export function buildADT_A04(patient: HL7Patient, admission: HL7Admission = {}): string {
  const now = new Date();
  const mshBase = defaultMsh(
    { code: "ADT", trigger: "A04", structure: "ADT_A01" },
    now
  );

  const { familyName, givenName } = splitName(patient.user?.name);

  const mshData: MSHData = { ...mshBase, controlId: generateControlId() };

  const pidData: PIDData = {
    mrNumber: patient.mrNumber,
    familyName,
    givenName,
    dateOfBirth: patient.dateOfBirth ?? undefined,
    gender: mapGender(patient.gender),
    phone: patient.user?.phone ?? undefined,
    address: patient.address
      ? { line: patient.address, country: "IN" }
      : undefined,
    abhaId: patient.abhaId ?? undefined,
  };

  const attending = admission.attendingDoctor;
  const attendingSplit = attending ? splitName(attending.name) : null;

  const pv1Data: PV1Data = {
    patientClass: admission.patientClass ?? "O",
    assignedLocation:
      admission.ward || admission.room || admission.bed
        ? {
            pointOfCare: admission.ward,
            room: admission.room,
            bed: admission.bed,
            facility: admission.facility ?? "MEDCORE",
          }
        : undefined,
    attendingDoctor:
      attending && attendingSplit
        ? {
            id: attending.id,
            familyName: attendingSplit.familyName,
            givenName: attendingSplit.givenName,
          }
        : undefined,
    visitNumber: admission.visitNumber,
    admitDateTime: admission.admittedAt ?? now,
    dischargeDateTime: admission.dischargedAt ?? undefined,
  };

  return assemble([MSH(mshData), PID(pidData), PV1(pv1Data)]);
}

// ─── ORM^O01 ────────────────────────────────────────────────────────────────

/**
 * Build an ORM^O01 "Order" message for a lab order. Per HL7 v2.5.1 §4.3.1,
 * the structure is: MSH, PID, PV1?, {ORC, OBR, OBX*}. We emit one ORC+OBR
 * pair per test item on the order so the receiver can flag failures per test.
 */
export function buildORM_O01(labOrder: HL7LabOrder): string {
  const now = new Date();
  const mshData: MSHData = {
    ...defaultMsh({ code: "ORM", trigger: "O01", structure: "ORM_O01" }, now),
    controlId: generateControlId(),
  };

  const { familyName, givenName } = splitName(labOrder.patient.user?.name);
  const pidData: PIDData = {
    mrNumber: labOrder.patient.mrNumber,
    familyName,
    givenName,
    dateOfBirth: labOrder.patient.dateOfBirth ?? undefined,
    gender: mapGender(labOrder.patient.gender),
    phone: labOrder.patient.user?.phone ?? undefined,
    address: labOrder.patient.address
      ? { line: labOrder.patient.address, country: "IN" }
      : undefined,
    abhaId: labOrder.patient.abhaId ?? undefined,
  };

  const doctor = labOrder.doctor;
  const doctorSplit = doctor?.user?.name ? splitName(doctor.user.name) : null;
  const orderingProvider = doctor && doctorSplit
    ? { id: doctor.id, familyName: doctorSplit.familyName, givenName: doctorSplit.givenName }
    : undefined;

  const segments: string[] = [MSH(mshData), PID(pidData)];

  labOrder.items.forEach((item, idx) => {
    const orc: ORCData = {
      orderControl: "NW",
      placerOrderNumber: labOrder.orderNumber,
      fillerOrderNumber: item.id,
      orderStatus: "SC",
      transactionDateTime: labOrder.orderedAt,
      orderingProvider,
    };
    const obr: OBRData = {
      setId: idx + 1,
      placerOrderNumber: labOrder.orderNumber,
      fillerOrderNumber: item.id,
      testCode: item.test.code,
      testName: item.test.name,
      codingSystem: "LN",
      requestedDateTime: labOrder.orderedAt,
      observationDateTime: labOrder.collectedAt ?? undefined,
      orderingProvider,
      priority: mapPriority(labOrder.priority),
    };
    segments.push(ORC(orc), OBR(obr));
  });

  return assemble(segments);
}

// ─── ORU^R01 ────────────────────────────────────────────────────────────────

/**
 * Build an ORU^R01 "Unsolicited Observation Result" message. Per HL7 v2.5.1
 * §7.3.1, the structure is: MSH, {PID, {OBR, {OBX*}}*}*. We group results by
 * their parent order item so each OBR is followed by its own OBX segments.
 */
export function buildORU_R01(labOrder: HL7LabOrder, labResults: HL7LabResult[]): string {
  const now = new Date();
  const mshData: MSHData = {
    ...defaultMsh({ code: "ORU", trigger: "R01", structure: "ORU_R01" }, now),
    controlId: generateControlId(),
  };

  const { familyName, givenName } = splitName(labOrder.patient.user?.name);
  const pidData: PIDData = {
    mrNumber: labOrder.patient.mrNumber,
    familyName,
    givenName,
    dateOfBirth: labOrder.patient.dateOfBirth ?? undefined,
    gender: mapGender(labOrder.patient.gender),
    phone: labOrder.patient.user?.phone ?? undefined,
    address: labOrder.patient.address
      ? { line: labOrder.patient.address, country: "IN" }
      : undefined,
    abhaId: labOrder.patient.abhaId ?? undefined,
  };

  const doctor = labOrder.doctor;
  const doctorSplit = doctor?.user?.name ? splitName(doctor.user.name) : null;
  const orderingProvider =
    doctor && doctorSplit
      ? { id: doctor.id, familyName: doctorSplit.familyName, givenName: doctorSplit.givenName }
      : undefined;

  const segments: string[] = [MSH(mshData), PID(pidData)];

  // Group results by orderItemId so each OBR group contains its own OBX*.
  const resultsByItem = new Map<string, HL7LabResult[]>();
  for (const r of labResults) {
    const list = resultsByItem.get(r.orderItemId) ?? [];
    list.push(r);
    resultsByItem.set(r.orderItemId, list);
  }

  labOrder.items.forEach((item, idx) => {
    const itemResults = resultsByItem.get(item.id) ?? [];
    const anyVerified = itemResults.some((r) => r.verifiedAt);
    const lastReported = itemResults.reduce<Date | null>((acc, r) => {
      const t = r.verifiedAt ?? r.reportedAt;
      const d = t instanceof Date ? t : new Date(t);
      if (!acc || d > acc) return d;
      return acc;
    }, null);

    const obr: OBRData = {
      setId: idx + 1,
      placerOrderNumber: labOrder.orderNumber,
      fillerOrderNumber: item.id,
      testCode: item.test.code,
      testName: item.test.name,
      codingSystem: "LN",
      requestedDateTime: labOrder.orderedAt,
      observationDateTime: labOrder.collectedAt ?? labOrder.orderedAt,
      orderingProvider,
      resultsReportedDateTime: lastReported ?? labOrder.completedAt ?? undefined,
      resultStatus: anyVerified ? "F" : "P",
      priority: mapPriority(labOrder.priority),
    };
    segments.push(OBR(obr));

    itemResults.forEach((result, obxIdx) => {
      const verifier = result.verifier;
      const verifierSplit = verifier ? splitName(verifier.name) : null;
      const obx: OBXData = {
        setId: obxIdx + 1,
        valueType: inferValueType(result.value),
        code: result.testCode ?? result.parameter,
        name: result.testName ?? result.parameter,
        codingSystem: "LN",
        value: result.value,
        units: result.unit ?? undefined,
        referenceRange: result.normalRange ?? undefined,
        abnormalFlags: mapFlag(result.flag),
        resultStatus: result.verifiedAt ? "F" : "P",
        observationDateTime: result.reportedAt,
        performer:
          verifier && verifierSplit
            ? { id: verifier.id, familyName: verifierSplit.familyName, givenName: verifierSplit.givenName }
            : undefined,
      };
      segments.push(OBX(obx));
    });
  });

  return assemble(segments);
}
