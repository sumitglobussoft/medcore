// UIP (Universal Immunization Programme) schedule lookups + date recomputer
// used by both the seed and the one-shot data-correction script for Issue #46.
//
// Kept here (packages/db) rather than in apps/api so scripts/ can import it
// without pulling in Express, and the seed file can share the same table.

export interface UIPEntry {
  /** Canonical vaccine label as stored in Immunization.vaccine. */
  vaccine: string;
  /** Age (in days) when the dose is due per UIP. */
  dueAgeDays: number;
  /** Typical dose number within the same vaccine's schedule. */
  doseNumber?: number;
}

// India National Immunization Schedule (UIP). Kept in the same order as the
// seed file so both reference the same canonical schedule.
export const UIP_SCHEDULE: UIPEntry[] = [
  { vaccine: "BCG", dueAgeDays: 0, doseNumber: 1 },
  { vaccine: "Hepatitis B", dueAgeDays: 0, doseNumber: 1 },
  { vaccine: "OPV", dueAgeDays: 0, doseNumber: 1 },
  { vaccine: "OPV", dueAgeDays: 42, doseNumber: 2 },
  { vaccine: "Pentavalent (DPT+HepB+Hib)", dueAgeDays: 42, doseNumber: 1 },
  { vaccine: "Rotavirus", dueAgeDays: 42, doseNumber: 1 },
  { vaccine: "fIPV", dueAgeDays: 42, doseNumber: 1 },
  { vaccine: "OPV", dueAgeDays: 70, doseNumber: 3 },
  { vaccine: "Pentavalent (DPT+HepB+Hib)", dueAgeDays: 70, doseNumber: 2 },
  { vaccine: "Rotavirus", dueAgeDays: 70, doseNumber: 2 },
  { vaccine: "OPV", dueAgeDays: 98, doseNumber: 4 },
  { vaccine: "Pentavalent (DPT+HepB+Hib)", dueAgeDays: 98, doseNumber: 3 },
  { vaccine: "Rotavirus", dueAgeDays: 98, doseNumber: 3 },
  { vaccine: "fIPV", dueAgeDays: 98, doseNumber: 2 },
  { vaccine: "MR (Measles-Rubella)", dueAgeDays: 270, doseNumber: 1 },
  { vaccine: "JE (Japanese Encephalitis)", dueAgeDays: 270, doseNumber: 1 },
  { vaccine: "Vitamin A (1st dose)", dueAgeDays: 270, doseNumber: 1 },
  { vaccine: "DPT Booster 1", dueAgeDays: 490, doseNumber: 1 },
  { vaccine: "MR (Measles-Rubella)", dueAgeDays: 490, doseNumber: 2 },
  { vaccine: "OPV Booster", dueAgeDays: 490, doseNumber: 1 },
  { vaccine: "JE (Japanese Encephalitis)", dueAgeDays: 490, doseNumber: 2 },
  { vaccine: "Vitamin A (2nd dose)", dueAgeDays: 547, doseNumber: 2 },
  // DPT booster 2 is given at age ~5y — after this, items are "pediatric"
  // in spirit but some older teens still receive them. See ADULT_THRESHOLD_DAYS.
  { vaccine: "DPT Booster 2", dueAgeDays: 1825, doseNumber: 2 },
  { vaccine: "Td", dueAgeDays: 3650, doseNumber: 1 },
  { vaccine: "Td", dueAgeDays: 5475, doseNumber: 2 },
];

/** Anything with due age < 16 years is "pediatric" for recomputation purposes. */
export const ADULT_THRESHOLD_DAYS = 16 * 365;

/** Adult threshold on the patient side: DOB older than 18y → adult. */
export const ADULT_PATIENT_AGE_DAYS = 18 * 365;

/**
 * Find the UIP entry matching a vaccine label + dose number. Used by the
 * correction script to recompute a realistic dueDate.
 *
 * Returns undefined when the label is adult-only (Influenza, HPV, etc.) or
 * doesn't match a known UIP entry — the caller should decide what to do.
 */
export function findUIPEntry(
  vaccine: string,
  doseNumber?: number | null
): UIPEntry | undefined {
  const normalized = vaccine.trim();
  // Prefer a match on both vaccine+dose; fall back to vaccine alone.
  const exact = UIP_SCHEDULE.find(
    (e) =>
      e.vaccine === normalized &&
      (doseNumber == null || e.doseNumber === doseNumber)
  );
  if (exact) return exact;
  return UIP_SCHEDULE.find((e) => e.vaccine === normalized);
}

export type RecomputeDecision =
  | {
      action: "RECOMPUTE";
      /** New due date (within a realistic window from "now"). */
      newDueDate: Date;
      /** Reason for the change, for logging + note. */
      reason: string;
    }
  | {
      action: "MISSED";
      /** Reason for marking MISSED. */
      reason: string;
    }
  | {
      action: "SKIP";
      reason: string;
    };

export interface RecomputeInput {
  vaccine: string;
  doseNumber: number | null;
  currentDueDate: Date;
  patientDateOfBirth: Date | null;
  now?: Date;
}

/**
 * Given a stale PENDING immunization row, decide whether to:
 *   - RECOMPUTE it to a realistic dueDate (7-60 days overdue, demo-friendly),
 *     anchored to the patient's DOB + the vaccine's UIP age offset.
 *   - MISSED: the patient has aged past pediatric schedule items — no
 *     plausible due date remains, mark the record as MISSED.
 *   - SKIP: the record doesn't look stale or we can't decide.
 *
 * The "MISSED" path is what adults currently see on pediatric entries.
 *
 * PURE function (no DB, no date libraries) — easy to unit-test.
 */
export function recomputeImmunizationDue(
  input: RecomputeInput
): RecomputeDecision {
  const now = input.now ?? new Date();
  const msPerDay = 86_400_000;

  const ageDays = diffDays(now, input.currentDueDate);
  // Not actually stale (due in the future or less than ~a year overdue) —
  // caller usually filters these out, but be defensive.
  if (ageDays < 365) {
    return {
      action: "SKIP",
      reason: `not-stale (due date is ${Math.round(ageDays)} days old)`,
    };
  }

  const dob = input.patientDateOfBirth;

  // No DOB → we can't anchor. Mark MISSED with a generic note; the record
  // remains in the system but stops cluttering the "due" view.
  if (!dob) {
    return {
      action: "MISSED",
      reason: "no date-of-birth on file; cannot recompute schedule anchor",
    };
  }

  const patientAgeDays = (now.getTime() - dob.getTime()) / msPerDay;

  // Lookup the vaccine in the UIP. If it's not a known pediatric item
  // (e.g. Influenza for an adult), recompute to a realistic overdue window
  // based on the CURRENT due date's intent — the patient just missed their
  // booster, not their infant DPT.
  const uip = findUIPEntry(input.vaccine, input.doseNumber);

  // Adult patient with a KNOWN pediatric schedule item → MISSED
  // (too late for BCG at age 30; keep the record as "vaccine not given").
  if (
    patientAgeDays > ADULT_PATIENT_AGE_DAYS &&
    uip &&
    uip.dueAgeDays < ADULT_THRESHOLD_DAYS
  ) {
    return {
      action: "MISSED",
      reason: `patient is ${Math.round(
        patientAgeDays / 365
      )}y; pediatric vaccine '${input.vaccine}' was due at ${Math.round(
        uip.dueAgeDays / 365
      )}y — too late to administer`,
    };
  }

  // Child patient: recompute based on DOB + UIP offset. If that's still in
  // the past, slide the due date into a realistic 7-60 day window so the
  // dashboard displays a sensible "overdue by N days".
  if (uip) {
    const anchored = new Date(dob.getTime() + uip.dueAgeDays * msPerDay);
    const anchoredAgeDays = diffDays(now, anchored);
    if (anchoredAgeDays > 60) {
      const overdueDays = 7 + Math.floor(pseudoRandom(input) * 54); // 7..60
      return {
        action: "RECOMPUTE",
        newDueDate: new Date(now.getTime() - overdueDays * msPerDay),
        reason: `UIP anchor was ${Math.round(
          anchoredAgeDays
        )}d old; clamped to ${overdueDays}d overdue for demo realism`,
      };
    }
    // Anchor is already within a reasonable window — use it.
    return {
      action: "RECOMPUTE",
      newDueDate: anchored,
      reason: `anchored to DOB + UIP offset (${uip.dueAgeDays}d)`,
    };
  }

  // Unknown vaccine (not in UIP): don't fabricate a schedule. Clamp the
  // existing stale date to a 7-60d window so the demo looks healthy.
  const overdueDays = 7 + Math.floor(pseudoRandom(input) * 54);
  return {
    action: "RECOMPUTE",
    newDueDate: new Date(now.getTime() - overdueDays * msPerDay),
    reason: `vaccine '${input.vaccine}' not in UIP; clamped to ${overdueDays}d overdue`,
  };
}

function diffDays(a: Date, b: Date): number {
  return (a.getTime() - b.getTime()) / 86_400_000;
}

// Deterministic pseudo-random in [0,1) derived from the input — so a given
// record recomputes to the same date across dry-run → apply, making the
// dry-run preview accurate.
function pseudoRandom(input: RecomputeInput): number {
  const str = `${input.vaccine}|${input.doseNumber ?? ""}|${
    input.currentDueDate.toISOString()
  }`;
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Convert to [0,1)
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}
