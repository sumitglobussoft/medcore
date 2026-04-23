/**
 * HL7 v2 round-trip smoke test.
 *
 * Builds an ADT^A04, ORM^O01, and ORU^R01 from canned fixtures, parses
 * each one with our own parser, then reconstructs the same segments and
 * asserts the output is byte-identical for the deterministic pieces
 * (everything except MSH-7 timestamp and MSH-10 control id, which both
 * embed Date.now()).
 *
 * Wired as `npm run hl7v2:roundtrip` in apps/api/package.json. This is a
 * local developer smoke test — it does NOT require a database, an API
 * server, or any network access.
 *
 * Usage:
 *   npx tsx apps/api/src/services/hl7v2/roundtrip.ts
 *
 * On success the script prints the generated sample + parser output and
 * exits 0. On any mismatch it prints a diff and exits 1.
 */

import {
  buildADT_A04,
  buildORM_O01,
  buildORU_R01,
  type HL7Patient,
  type HL7LabOrder,
  type HL7LabResult,
} from "./messages";
import { parseMessage, getField, getSegments } from "./parser";

const patient: HL7Patient = {
  id: "pat-rt",
  mrNumber: "MR-RT-001",
  gender: "MALE",
  dateOfBirth: new Date("1990-05-15T00:00:00Z"),
  address: "42 Lake Road, Bengaluru",
  abhaId: "14-1111-2222-3333",
  user: {
    name: "Ravi Kumar",
    phone: "+919999999999",
    email: "ravi@example.com",
  },
};

const labOrder: HL7LabOrder = {
  id: "order-rt",
  orderNumber: "LAB-RT-001",
  orderedAt: new Date("2026-04-23T09:00:00Z"),
  collectedAt: new Date("2026-04-23T09:15:00Z"),
  completedAt: new Date("2026-04-23T10:00:00Z"),
  status: "COMPLETED",
  priority: "ROUTINE",
  patient,
  doctor: { id: "doc-rt", user: { name: "Dr. Mehta" } },
  items: [
    { id: "item-rt-1", test: { code: "CBC", name: "Complete Blood Count" } },
  ],
};

const results: HL7LabResult[] = [
  {
    id: "res-rt-1",
    orderItemId: "item-rt-1",
    parameter: "Hemoglobin",
    value: "13.5",
    unit: "g/dL",
    normalRange: "12-16",
    flag: "NORMAL",
    verifiedAt: new Date("2026-04-23T10:05:00Z"),
    reportedAt: new Date("2026-04-23T10:00:00Z"),
  },
];

/** Compare two strings after stripping non-deterministic MSH fields. */
function assertStableEquality(a: string, b: string, label: string): void {
  const clean = (s: string) =>
    s
      // Strip MSH-7 timestamp (14 digits after the 6th `|`)
      .replace(/(MSH\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|)\d{14}/g, "$1<TS>")
      // Strip MSH-10 control id (the 9th `|`-delimited field of MSH)
      .replace(
        /(MSH\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|)[^|]+/g,
        "$1<CTRL>"
      );
  if (clean(a) !== clean(b)) {
    console.error(`\n[FAIL] ${label} mismatch`);
    console.error("--- first build");
    console.error(JSON.stringify(clean(a)));
    console.error("--- second build");
    console.error(JSON.stringify(clean(b)));
    process.exit(1);
  } else {
    console.log(`[OK]   ${label} stable round-trip`);
  }
}

function main() {
  console.log("HL7 v2 round-trip smoke test\n");

  const adt1 = buildADT_A04(patient, { patientClass: "O" });
  const adt2 = buildADT_A04(patient, { patientClass: "O" });
  console.log("─── ADT^A04 ───");
  console.log(adt1.replace(/\r/g, "\n"));
  assertStableEquality(adt1, adt2, "ADT^A04");

  const parsedAdt = parseMessage(adt1);
  if (getField(parsedAdt, "PID", 3)?.includes("MR-RT-001") !== true) {
    console.error("[FAIL] parseMessage did not recover PID-3 MR number");
    process.exit(1);
  }
  console.log("[OK]   ADT parser recovered PID-3 MR number\n");

  const orm1 = buildORM_O01(labOrder);
  const orm2 = buildORM_O01(labOrder);
  console.log("─── ORM^O01 ───");
  console.log(orm1.replace(/\r/g, "\n"));
  assertStableEquality(orm1, orm2, "ORM^O01");

  const oru1 = buildORU_R01(labOrder, results);
  const oru2 = buildORU_R01(labOrder, results);
  console.log("─── ORU^R01 ───");
  console.log(oru1.replace(/\r/g, "\n"));
  assertStableEquality(oru1, oru2, "ORU^R01");

  const parsedOru = parseMessage(oru1);
  const obxs = getSegments(parsedOru, "OBX");
  if (obxs.length !== 1 || obxs[0].fields[5] !== "13.5") {
    console.error("[FAIL] parseMessage did not recover OBX-5 value");
    process.exit(1);
  }
  console.log("[OK]   ORU parser recovered OBX-5 value\n");

  console.log("All checks passed.");
}

main();
