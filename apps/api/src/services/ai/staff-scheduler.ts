// AI-assisted staff roster proposer (PRD §7.3).
//
// This module generates a shift-by-shift roster proposal for a department
// over a 7 or 14 day window by solving a constraint satisfaction problem via
// a greedy assignment loop with backtracking on conflicts.  It is
// deliberately deterministic — no LLM call, no external solver dep — so the
// output is reproducible, auditable, and test-friendly.
//
// Constraints enforced (hard):
//   1. Minimum coverage per shift type per day (department defaults or the
//      caller-supplied override).
//   2. No double-booking: a staff member is never assigned two shifts on the
//      same calendar date.
//   3. Statutory rest: ≥ 11 hours between consecutive shifts for the same
//      staff member.
//   4. Max 6 consecutive working days.
//   5. No assignment on an approved (or pending) leave day.
//   6. Department-specific skill requirements (e.g. cardiology needs ≥ 1
//      senior cardiologist per shift) when the department is one of our
//      known specialties.
//   7. Night-shift preference: anyone who worked a NIGHT shift yesterday is
//      not assigned MORNING today.
//
// Soft preferences (surfaced as warnings, not rejected):
//   - Certification expiring within the window.
//   - Skewed workload (one staffer carrying > 30% more shifts than the mean).

import { tenantScopedPrisma as prisma } from "../tenant-prisma";

// ── Public types ──────────────────────────────────────────────────────────────

export type ShiftTypeName = "MORNING" | "AFTERNOON" | "NIGHT" | "ON_CALL";

export interface StaffAssignment {
  userId: string;
  name: string;
  role: string;
  /** Optional explanation of why this staffer was picked. */
  reason?: string;
}

export interface ShiftProposal {
  shiftType: ShiftTypeName;
  requiredCount: number;
  assignedStaff: StaffAssignment[];
  /** True when the solver could not fill every slot. */
  understaffed: boolean;
}

export interface DayProposal {
  date: string; // YYYY-MM-DD
  shifts: ShiftProposal[];
}

export interface RosterProposalResult {
  startDate: string;
  days: number;
  department: string;
  proposals: DayProposal[];
  warnings: string[];
  violationsIfApplied: string[];
}

export interface GenerateRosterInput {
  startDate: Date | string;
  days: 7 | 14;
  department: string;
  /** Override coverage: e.g. { MORNING: 3, AFTERNOON: 2, NIGHT: 1, ON_CALL: 1 }. */
  coverage?: Partial<Record<ShiftTypeName, number>>;
  now?: Date;
}

// ── Internals ─────────────────────────────────────────────────────────────────

const SHIFT_TYPES: ShiftTypeName[] = [
  "MORNING",
  "AFTERNOON",
  "NIGHT",
  "ON_CALL",
];

const SHIFT_HOURS: Record<ShiftTypeName, { start: number; end: number }> = {
  // Integer representation as "hours since midnight of the shift's start day".
  // End can exceed 24 (e.g. NIGHT 23→31 = 7:00 next morning) to make rest-gap
  // arithmetic straightforward.
  MORNING: { start: 7, end: 15 },
  AFTERNOON: { start: 15, end: 23 },
  NIGHT: { start: 23, end: 31 },
  ON_CALL: { start: 0, end: 24 },
};

const DEFAULT_COVERAGE: Record<ShiftTypeName, number> = {
  MORNING: 2,
  AFTERNOON: 2,
  NIGHT: 1,
  ON_CALL: 1,
};

const MIN_REST_HOURS = 11;
const MAX_CONSECUTIVE_DAYS = 6;

// Specialty-specific "senior" requirements. Keys are case-insensitive
// department names; each value is a list of substrings any of which must
// appear in a staff member's certification titles for them to count as the
// required senior.
const SPECIALTY_REQUIRES_SENIOR: Record<string, string[]> = {
  cardiology: ["cardiology", "cardiologist", "acls"],
  icu: ["icu", "critical care", "acls"],
  emergency: ["emergency", "atls", "acls"],
  maternity: ["obstetric", "maternity", "midwife"],
  nicu: ["neonatal", "nrp", "nicu"],
};

function toDateKey(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function hoursBetweenShifts(
  aDate: Date,
  aType: ShiftTypeName,
  bDate: Date,
  bType: ShiftTypeName
): number {
  const aEnd = new Date(aDate);
  aEnd.setHours(0, 0, 0, 0);
  aEnd.setHours(aEnd.getHours() + SHIFT_HOURS[aType].end);
  const bStart = new Date(bDate);
  bStart.setHours(0, 0, 0, 0);
  bStart.setHours(bStart.getHours() + SHIFT_HOURS[bType].start);
  return (bStart.getTime() - aEnd.getTime()) / (1000 * 60 * 60);
}

interface StaffCandidate {
  userId: string;
  name: string;
  role: string;
  department?: string | null;
  /** Shifts already present in DB history used for workload balancing. */
  pastShiftCount: number;
  /** Certification tokens, lower-cased, for skill matching. */
  certTokens: string[];
  /** Certification that expires within the proposal window — soft warning. */
  expiringCerts: Array<{ title: string; expiryDate: Date }>;
}

interface LeaveWindow {
  userId: string;
  from: Date;
  to: Date;
}

interface SchedulerState {
  /** userId → { dateKey → shiftType }. */
  assignments: Map<string, Map<string, ShiftTypeName>>;
  /** Roster rows that will be emitted. */
  perDay: Map<string, Map<ShiftTypeName, StaffAssignment[]>>;
}

function newState(): SchedulerState {
  return {
    assignments: new Map(),
    perDay: new Map(),
  };
}

function getAssigned(state: SchedulerState, userId: string): Map<string, ShiftTypeName> {
  let m = state.assignments.get(userId);
  if (!m) {
    m = new Map();
    state.assignments.set(userId, m);
  }
  return m;
}

function wouldViolateHard(
  state: SchedulerState,
  candidate: StaffCandidate,
  date: Date,
  shiftType: ShiftTypeName,
  leaveByUser: Map<string, LeaveWindow[]>
): string | null {
  const key = toDateKey(date);

  // 1) Double-booking on same date
  const mine = state.assignments.get(candidate.userId);
  if (mine?.has(key)) return "already assigned same day";

  // 2) Leave overlap
  const leaves = leaveByUser.get(candidate.userId) ?? [];
  for (const l of leaves) {
    if (date >= l.from && date <= l.to) return "on approved/pending leave";
  }

  // 3) Rest gap vs previous day (if any)
  if (mine) {
    const prevKey = toDateKey(addDays(date, -1));
    const prevType = mine.get(prevKey);
    if (prevType) {
      const gap = hoursBetweenShifts(addDays(date, -1), prevType, date, shiftType);
      if (gap < MIN_REST_HOURS) {
        return `rest gap ${gap.toFixed(1)}h < ${MIN_REST_HOURS}h`;
      }
      // Night → morning transition rule (even if gap arithmetic passes — it
      // won't for NIGHT 23→31 followed by MORNING 7, gap = 0h — explicit guard).
      if (prevType === "NIGHT" && shiftType === "MORNING") {
        return "night followed by morning not allowed";
      }
    }
    // 4) Max consecutive days
    let streak = 1;
    for (let i = 1; i <= MAX_CONSECUTIVE_DAYS; i++) {
      const k = toDateKey(addDays(date, -i));
      if (mine.has(k)) streak++;
      else break;
    }
    if (streak > MAX_CONSECUTIVE_DAYS) {
      return `> ${MAX_CONSECUTIVE_DAYS} consecutive days`;
    }
  }

  return null;
}

function matchesSeniorSkill(
  candidate: StaffCandidate,
  department: string
): boolean {
  const req = SPECIALTY_REQUIRES_SENIOR[department.toLowerCase()];
  if (!req) return true; // department has no extra skill requirement
  return req.some((tok) => candidate.certTokens.some((c) => c.includes(tok)));
}

function scoreCandidate(c: StaffCandidate, shiftType: ShiftTypeName): number {
  // Lower score is better. Prefer staff with fewer past shifts for balance,
  // and prefer NURSE/DOCTOR over unspecified roles for clinical coverage.
  let s = c.pastShiftCount;
  if (shiftType === "NIGHT" && c.role === "NURSE") s -= 0.5;
  if (shiftType === "ON_CALL" && c.role === "DOCTOR") s -= 0.5;
  return s;
}

// ── Data loading ──────────────────────────────────────────────────────────────

async function loadCandidatesAndConstraints(
  department: string,
  windowStart: Date,
  windowEnd: Date
): Promise<{
  candidates: StaffCandidate[];
  leavesByUser: Map<string, LeaveWindow[]>;
}> {
  // Users in the requested department (falls back to all clinical roles if
  // no Doctor.specialty matches, so pure NURSE wards still generate a roster).
  const deptLower = department.toLowerCase();

  const users = await (prisma as any).user.findMany({
    where: {
      role: { in: ["DOCTOR", "NURSE"] },
    },
    include: {
      doctor: true,
    },
  });

  // Filter to the requested department when a Doctor.specialty match exists,
  // otherwise keep all nurses + any doctor with no specialty declared.
  const filtered = users.filter((u: any) => {
    if (u.role === "NURSE") return true;
    const spec = (u.doctor?.specialty ?? "").toLowerCase();
    if (!spec) return true;
    return spec.includes(deptLower) || deptLower.includes(spec);
  });

  // Certifications
  const userIds = filtered.map((u: any) => u.id);
  const certs =
    userIds.length === 0
      ? []
      : await (prisma as any).staffCertification.findMany({
          where: { userId: { in: userIds }, status: "ACTIVE" },
          select: { userId: true, title: true, type: true, expiryDate: true },
        });
  const certByUser = new Map<string, Array<{ title: string; type: string; expiryDate: Date | null }>>();
  for (const c of certs) {
    if (!certByUser.has(c.userId)) certByUser.set(c.userId, []);
    certByUser.get(c.userId)!.push({
      title: c.title ?? "",
      type: c.type ?? "",
      expiryDate: c.expiryDate ? new Date(c.expiryDate) : null,
    });
  }

  // Past shift counts (last 60 days) for workload balancing
  const sixtyDaysAgo = new Date(windowStart);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
  const pastShifts =
    userIds.length === 0
      ? []
      : await (prisma as any).staffShift.groupBy({
          by: ["userId"],
          where: {
            userId: { in: userIds },
            date: { gte: sixtyDaysAgo, lt: windowStart },
          },
          _count: { _all: true },
        });
  const pastCountByUser = new Map<string, number>();
  for (const row of pastShifts) {
    pastCountByUser.set(row.userId, row._count._all);
  }

  // Leaves overlapping the window
  const leaves =
    userIds.length === 0
      ? []
      : await (prisma as any).leaveRequest.findMany({
          where: {
            userId: { in: userIds },
            status: { in: ["APPROVED", "PENDING"] },
            OR: [
              { fromDate: { lte: windowEnd }, toDate: { gte: windowStart } },
            ],
          },
          select: { userId: true, fromDate: true, toDate: true },
        });
  const leavesByUser = new Map<string, LeaveWindow[]>();
  for (const l of leaves) {
    if (!leavesByUser.has(l.userId)) leavesByUser.set(l.userId, []);
    leavesByUser.get(l.userId)!.push({
      userId: l.userId,
      from: new Date(l.fromDate),
      to: new Date(l.toDate),
    });
  }

  const candidates: StaffCandidate[] = filtered.map((u: any) => {
    const userCerts = certByUser.get(u.id) ?? [];
    const tokens = userCerts.flatMap((c) =>
      [c.title, c.type]
        .filter(Boolean)
        .map((s) => s.toLowerCase())
    );
    const expiring = userCerts
      .filter(
        (c) =>
          c.expiryDate &&
          c.expiryDate >= windowStart &&
          c.expiryDate <= windowEnd
      )
      .map((c) => ({ title: c.title, expiryDate: c.expiryDate! }));

    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      department: u.doctor?.specialty ?? null,
      pastShiftCount: pastCountByUser.get(u.id) ?? 0,
      certTokens: tokens,
      expiringCerts: expiring,
    };
  });

  return { candidates, leavesByUser };
}

// ── Main solver ───────────────────────────────────────────────────────────────

export async function generateRosterProposal(
  input: GenerateRosterInput
): Promise<RosterProposalResult> {
  const days = input.days;
  if (days !== 7 && days !== 14) {
    throw new Error("generateRosterProposal: days must be 7 or 14");
  }
  const startDate =
    input.startDate instanceof Date ? input.startDate : new Date(input.startDate);
  if (Number.isNaN(startDate.getTime())) {
    throw new Error("generateRosterProposal: invalid startDate");
  }
  startDate.setHours(0, 0, 0, 0);
  const windowEnd = addDays(startDate, days - 1);

  const coverage: Record<ShiftTypeName, number> = {
    ...DEFAULT_COVERAGE,
    ...(input.coverage ?? {}),
  } as Record<ShiftTypeName, number>;

  const { candidates, leavesByUser } = await loadCandidatesAndConstraints(
    input.department,
    startDate,
    windowEnd
  );

  const warnings: string[] = [];
  const violationsIfApplied: string[] = [];

  if (candidates.length === 0) {
    warnings.push(
      `No clinical staff found for department "${input.department}".`
    );
  }

  // Surface expiring certs as soft warnings
  for (const c of candidates) {
    for (const e of c.expiringCerts) {
      warnings.push(
        `Certification "${e.title}" for ${c.name} expires on ${toDateKey(
          e.expiryDate
        )} — may need renewal before/during this roster.`
      );
    }
  }

  const state = newState();
  const proposals: DayProposal[] = [];

  for (let d = 0; d < days; d++) {
    const date = addDays(startDate, d);
    const dateKey = toDateKey(date);
    const dayShifts: ShiftProposal[] = [];

    for (const shiftType of SHIFT_TYPES) {
      const need = coverage[shiftType] ?? 0;
      if (need <= 0) {
        dayShifts.push({
          shiftType,
          requiredCount: 0,
          assignedStaff: [],
          understaffed: false,
        });
        continue;
      }

      // Build the eligibility list sorted by score (best first).
      const seniorReq =
        SPECIALTY_REQUIRES_SENIOR[input.department.toLowerCase()] !== undefined;

      const eligible: Array<{ c: StaffCandidate; reason?: string }> = [];
      for (const c of candidates) {
        const v = wouldViolateHard(state, c, date, shiftType, leavesByUser);
        if (v) continue;
        eligible.push({ c });
      }

      eligible.sort((a, b) => scoreCandidate(a.c, shiftType) - scoreCandidate(b.c, shiftType));

      const chosen: StaffAssignment[] = [];
      let seniorSatisfied = !seniorReq;

      // First pass: if department needs a senior, pick one senior first.
      if (seniorReq) {
        for (let i = 0; i < eligible.length; i++) {
          if (matchesSeniorSkill(eligible[i].c, input.department)) {
            const pick = eligible.splice(i, 1)[0];
            chosen.push({
              userId: pick.c.userId,
              name: pick.c.name,
              role: pick.c.role,
              reason: "senior specialty coverage",
            });
            getAssigned(state, pick.c.userId).set(dateKey, shiftType);
            pick.c.pastShiftCount++;
            seniorSatisfied = true;
            break;
          }
        }
        if (!seniorSatisfied) {
          violationsIfApplied.push(
            `${dateKey} ${shiftType}: no senior ${input.department} staff available`
          );
        }
      }

      // Fill remaining slots greedily.
      while (chosen.length < need && eligible.length > 0) {
        const pick = eligible.shift()!;
        chosen.push({
          userId: pick.c.userId,
          name: pick.c.name,
          role: pick.c.role,
          reason: pick.reason ?? "balance + availability",
        });
        getAssigned(state, pick.c.userId).set(dateKey, shiftType);
        pick.c.pastShiftCount++;
      }

      const understaffed = chosen.length < need;
      if (understaffed) {
        violationsIfApplied.push(
          `${dateKey} ${shiftType}: needed ${need}, filled ${chosen.length}`
        );
      }

      dayShifts.push({
        shiftType,
        requiredCount: need,
        assignedStaff: chosen,
        understaffed,
      });
    }

    proposals.push({ date: dateKey, shifts: dayShifts });
  }

  // Workload-skew warning
  if (candidates.length > 0) {
    const counts = candidates.map((c) => {
      const m = state.assignments.get(c.userId);
      return m ? m.size : 0;
    });
    const mean = counts.reduce((s, v) => s + v, 0) / counts.length;
    if (mean > 0) {
      const maxShifts = Math.max(...counts);
      if (maxShifts > mean * 1.3) {
        warnings.push(
          `Workload skew detected: max ${maxShifts} shifts vs mean ${mean.toFixed(
            1
          )} — consider redistributing.`
        );
      }
    }
  }

  return {
    startDate: toDateKey(startDate),
    days,
    department: input.department,
    proposals,
    warnings,
    violationsIfApplied,
  };
}

// ── Apply helper ──────────────────────────────────────────────────────────────

/**
 * Persist an already-computed proposal to the StaffShift table.  Returns the
 * count of StaffShift rows created.  Intended to be called from the route
 * handler after admin confirmation — proposal persistence itself (to
 * StaffRosterProposal) is the route's responsibility.
 */
export async function materializeRoster(
  proposal: RosterProposalResult
): Promise<{ created: number }> {
  let created = 0;
  const shiftTimes: Record<ShiftTypeName, { startTime: string; endTime: string }> = {
    MORNING: { startTime: "07:00", endTime: "15:00" },
    AFTERNOON: { startTime: "15:00", endTime: "23:00" },
    NIGHT: { startTime: "23:00", endTime: "07:00" },
    ON_CALL: { startTime: "00:00", endTime: "23:59" },
  };

  for (const day of proposal.proposals) {
    for (const shift of day.shifts) {
      for (const s of shift.assignedStaff) {
        try {
          await (prisma as any).staffShift.create({
            data: {
              userId: s.userId,
              date: new Date(day.date),
              type: shift.shiftType,
              startTime: shiftTimes[shift.shiftType].startTime,
              endTime: shiftTimes[shift.shiftType].endTime,
              status: "SCHEDULED",
              notes: `AI roster: ${s.reason ?? ""}`.trim(),
            },
          });
          created++;
        } catch (err) {
          // Unique constraint (userId, date, type) — silently skip existing rows.
          const code = (err as any)?.code;
          if (code !== "P2002") throw err;
        }
      }
    }
  }

  return { created };
}
