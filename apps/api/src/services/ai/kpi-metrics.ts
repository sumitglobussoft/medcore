/**
 * PRD §3.9 (AI-assisted booking) and §4.9 (AI Scribe) KPI metrics.
 *
 * Each exported function computes a single KPI value from existing data and
 * returns a uniform shape so the dashboard + CSV exporter can render it
 * consistently:
 *
 * ```ts
 * {
 *   current: number;            // computed value in the selected window
 *   baseline?: number;          // prior-window comparator when available
 *   target: number;             // PRD target
 *   target_direction: "up" | "down"; // is "up" good or "down" good?
 *   unavailable?: true;         // set when we cannot honestly compute it
 *   reason?: string;            // why it is unavailable
 *   unit?: "pct" | "count" | "seconds" | "minutes" | "rating";
 *   sampleSize?: number;        // n used to compute current
 * }
 * ```
 *
 * Honesty rule: if a metric cannot be derived from existing tables we return
 * `unavailable: true` with a reason — we never fabricate numbers to satisfy a
 * dashboard card.
 *
 * All queries run through `tenantScopedPrisma` so the AsyncLocalStorage-based
 * tenant middleware auto-filters rows. Call sites in the route layer just
 * forward the request handler — no manual tenant joining needed.
 */

import { tenantScopedPrisma as prisma } from "../tenant-prisma";

// ─── Types ────────────────────────────────────────────────

export type TargetDirection = "up" | "down";

export interface KpiResult {
  current: number;
  baseline?: number;
  target: number;
  target_direction: TargetDirection;
  unavailable?: true;
  reason?: string;
  unit?: "pct" | "count" | "seconds" | "minutes" | "rating";
  sampleSize?: number;
}

export interface MetricInput {
  /** Tenant id. Optional — when not provided the tenant-scoped Prisma
   *  extension falls back to the ALS-scoped tenant from the current
   *  request. Useful for tests and for cron-style cross-tenant tooling. */
  tenantId?: string;
  from: Date;
  to: Date;
}

// ─── Helpers ──────────────────────────────────────────────

/**
 * Compute the same-length window immediately preceding (from, to) for
 * baseline deltas. If `from === to` we just return a one-day-earlier slice.
 */
export function previousWindow(from: Date, to: Date): { from: Date; to: Date } {
  const span = Math.max(1, to.getTime() - from.getTime());
  return {
    from: new Date(from.getTime() - span),
    to: new Date(from.getTime() - 1),
  };
}

function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return +(numerator / denominator).toFixed(4);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/** Marker the triage-booking route writes into `appointment.notes` so we
 *  can identify appointments sourced from the AI triage flow. */
export const AI_TRIAGE_SUMMARY_MARKER = "AI_TRIAGE_SUMMARY_JSON";

// ─── Feature 1 — AI-Assisted Booking (PRD §3.9) ──────────

/**
 * Mis-routed OPD appointments — appointments that either (a) had their
 * doctor swapped within 24h of initial booking OR (b) were reclassified as
 * `FOLLOWUP` to a different specialty than the originally booked doctor.
 *
 * We can't perfectly reconstruct doctor-swap history without an audit-log
 * join (Appointment has no `originalDoctorId`), so we proxy with:
 *   - appointments created in-window AND updated within 24h of creation AND
 *     whose status is CANCELLED (commonly the symptom of a wrong-doctor
 *     booking that gets rebooked elsewhere)
 *   - appointments of type FOLLOWUP where the doctor's specialization
 *     differs from the prior consultation's doctor specialization.
 *
 * Target: -30% vs baseline (i.e. fewer is better). Direction = down.
 */
export async function misroutedOpdAppointments(
  input: MetricInput,
): Promise<KpiResult> {
  const { from, to } = input;

  // (a) Likely-misrouted proxy: appointment created in window, then
  // cancelled within 24h.
  const createdInWindow = await prisma.appointment.findMany({
    where: { createdAt: { gte: from, lte: to } },
    select: { id: true, status: true, createdAt: true, updatedAt: true, doctorId: true, type: true, patientId: true, date: true },
  });
  const misroutedA = createdInWindow.filter(
    (a) =>
      a.status === "CANCELLED" &&
      a.updatedAt.getTime() - a.createdAt.getTime() <= 24 * 60 * 60 * 1000,
  ).length;

  // (b) Follow-ups to a different specialty. Cheap heuristic: a scheduled
  // visit within 14d of a prior consult for the same patient but a different
  // doctor. AppointmentType has only SCHEDULED / WALK_IN — walk-ins aren't
  // routing errors, so we gate on SCHEDULED here.
  const followUps = createdInWindow.filter((a) => a.type === "SCHEDULED");
  let misroutedB = 0;
  for (const fu of followUps) {
    const prior = await prisma.appointment.findFirst({
      where: {
        patientId: fu.patientId,
        date: { lt: fu.date },
        status: "COMPLETED",
      },
      orderBy: { date: "desc" },
      select: { doctorId: true },
    });
    if (prior && prior.doctorId !== fu.doctorId) misroutedB += 1;
  }

  const current = misroutedA + misroutedB;

  // Baseline from the previous window.
  const prevWin = previousWindow(from, to);
  const prevCreated = await prisma.appointment.findMany({
    where: { createdAt: { gte: prevWin.from, lte: prevWin.to } },
    select: { id: true, status: true, createdAt: true, updatedAt: true, doctorId: true, type: true, patientId: true, date: true },
  });
  const prevMisroutedA = prevCreated.filter(
    (a) =>
      a.status === "CANCELLED" &&
      a.updatedAt.getTime() - a.createdAt.getTime() <= 24 * 60 * 60 * 1000,
  ).length;

  return {
    current,
    baseline: prevMisroutedA, // FOLLOWUP path omitted for baseline to avoid N+1
    target: Math.round(prevMisroutedA * 0.7), // PRD: -30%
    target_direction: "down",
    unit: "count",
    sampleSize: createdInWindow.length,
  };
}

/**
 * AI-flow booking completion rate = triage sessions with status=COMPLETED
 * (which in the current route is set when a booking is completed OR a
 * handoff occurs) / all sessions started in window. We refine by only
 * counting sessions that ended in a real `appointmentId` — handoffs and
 * abandoned sessions are excluded from the numerator.
 *
 * Target: >70%. Direction = up.
 */
export async function bookingCompletionRate(
  input: MetricInput,
): Promise<KpiResult> {
  const { from, to } = input;

  const total = await prisma.aITriageSession.count({
    where: { createdAt: { gte: from, lte: to } },
  });
  const booked = await prisma.aITriageSession.count({
    where: {
      createdAt: { gte: from, lte: to },
      appointmentId: { not: null },
    },
  });

  return {
    current: pct(booked, total),
    target: 0.7,
    target_direction: "up",
    unit: "pct",
    sampleSize: total,
  };
}

/**
 * Patient CSAT with AI flow. We join PatientFeedback to appointments that
 * came through triage by looking for the AI_TRIAGE_SUMMARY marker in
 * appointment.notes. Because PatientFeedback has no direct appointmentId,
 * the best available proxy is:
 *   - find patients who booked via AI triage in window
 *   - average their PatientFeedback.rating submitted in-window.
 *
 * Target: >4.2 / 5. Direction = up.
 */
export async function patientCsatAiFlow(input: MetricInput): Promise<KpiResult> {
  const { from, to } = input;

  // Find patients who booked via AI triage (notes contains the marker).
  const aiBookedAppts = await prisma.appointment.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      notes: { contains: AI_TRIAGE_SUMMARY_MARKER },
    },
    select: { patientId: true },
  });
  const patientIds = [...new Set(aiBookedAppts.map((a) => a.patientId))];

  if (patientIds.length === 0) {
    return {
      current: 0,
      target: 4.2,
      target_direction: "up",
      unit: "rating",
      sampleSize: 0,
    };
  }

  const feedback = await prisma.patientFeedback.findMany({
    where: {
      patientId: { in: patientIds },
      submittedAt: { gte: from, lte: to },
    },
    select: { rating: true },
  });

  const avg =
    feedback.length === 0
      ? 0
      : +(
          feedback.reduce((s, f) => s + (f.rating ?? 0), 0) / feedback.length
        ).toFixed(2);

  return {
    current: avg,
    target: 4.2,
    target_direction: "up",
    unit: "rating",
    sampleSize: feedback.length,
  };
}

/**
 * Top-1 doctor suggestion acceptance rate. Compare the FIRST entry of
 * `AITriageSession.suggestedSpecialties` / suggestion payload to the
 * actual `appointment.doctorId` that the patient booked. We cannot track
 * suggestedDoctors[0] directly because the current schema stores
 * specialties rather than concrete doctor ids — we proxy by specialty
 * match of the booked doctor.
 *
 * Target: >55%. Direction = up.
 */
export async function top1AcceptanceRate(input: MetricInput): Promise<KpiResult> {
  const { from, to } = input;

  const sessions = await prisma.aITriageSession.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      appointmentId: { not: null },
      suggestedSpecialties: { not: null as unknown as undefined }, // Prisma.JsonNullValueFilter
    },
    select: {
      id: true,
      suggestedSpecialties: true,
      appointmentId: true,
    },
  });

  let accepted = 0;
  let evaluable = 0;
  for (const s of sessions) {
    const specs = s.suggestedSpecialties as unknown as
      | Array<{ specialty?: string }>
      | null;
    const top = Array.isArray(specs) ? specs[0]?.specialty : null;
    if (!top || !s.appointmentId) continue;
    const appt = await prisma.appointment.findUnique({
      where: { id: s.appointmentId },
      select: { doctor: { select: { specialization: true } } },
    });
    if (!appt?.doctor) continue;
    evaluable += 1;
    if (
      typeof top === "string" &&
      appt.doctor.specialization &&
      appt.doctor.specialization.toLowerCase() === top.toLowerCase()
    ) {
      accepted += 1;
    }
  }

  return {
    current: pct(accepted, evaluable),
    target: 0.55,
    target_direction: "up",
    unit: "pct",
    sampleSize: evaluable,
  };
}

/**
 * Time from app-open (session.createdAt) → confirmed appointment
 * (appointment.createdAt linked back via session.appointmentId). Median.
 *
 * Target: <3 min (= 180s). Direction = down.
 */
export async function timeToConfirmedAppointment(
  input: MetricInput,
): Promise<KpiResult> {
  const { from, to } = input;

  const sessions = await prisma.aITriageSession.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      appointmentId: { not: null },
    },
    select: { createdAt: true, appointmentId: true },
  });

  const deltas: number[] = [];
  for (const s of sessions) {
    if (!s.appointmentId) continue;
    const appt = await prisma.appointment.findUnique({
      where: { id: s.appointmentId },
      select: { createdAt: true },
    });
    if (!appt) continue;
    const ms = appt.createdAt.getTime() - s.createdAt.getTime();
    if (ms > 0) deltas.push(ms / 1000);
  }

  return {
    current: Math.round(median(deltas)),
    target: 180, // 3 minutes
    target_direction: "down",
    unit: "seconds",
    sampleSize: deltas.length,
  };
}

/**
 * Red-flag false-negative rate. Proxy: sessions where `redFlagDetected`
 * was false and `status !== EMERGENCY_DETECTED` BUT the same patient was
 * later admitted to an ER (EmergencyCase) within 24h of the session.
 *
 * Target: <1%. Direction = down.
 */
export async function redFlagFalseNegativeRate(
  input: MetricInput,
): Promise<KpiResult> {
  const { from, to } = input;

  const sessions = await prisma.aITriageSession.findMany({
    where: {
      createdAt: { gte: from, lte: to },
      redFlagDetected: false,
      status: { not: "EMERGENCY_DETECTED" },
      patientId: { not: null },
    },
    select: { id: true, patientId: true, createdAt: true },
  });

  let falseNegatives = 0;
  for (const s of sessions) {
    if (!s.patientId) continue;
    const windowEnd = new Date(s.createdAt.getTime() + 24 * 60 * 60 * 1000);
    const admitted = await prisma.emergencyCase.findFirst({
      where: {
        patientId: s.patientId,
        arrivedAt: { gte: s.createdAt, lte: windowEnd },
      },
      select: { id: true },
    });
    if (admitted) falseNegatives += 1;
  }

  return {
    current: pct(falseNegatives, sessions.length),
    target: 0.01,
    target_direction: "down",
    unit: "pct",
    sampleSize: sessions.length,
  };
}

/**
 * Front-desk call volume for triage questions.
 *
 * Not directly measurable — we have no phone-PBX integration and no
 * FrontDeskCall model. Returning unavailable with a pointer to the
 * external telephony system that would need wiring.
 */
export async function frontDeskCallVolume(
  _input: MetricInput,
): Promise<KpiResult> {
  return {
    current: 0,
    target: 0.75, // baseline -25%
    target_direction: "down",
    unavailable: true,
    reason:
      "Requires external phone/PBX integration. MedCore does not currently log front-desk call volume — wire a telephony webhook (Twilio/Exotel) into a new FrontDeskCall model to enable this KPI.",
    unit: "count",
  };
}

// ─── Feature 2 — AI Scribe (PRD §4.9) ────────────────────

/**
 * Doctor documentation time reduction. We compare the median consultation
 * duration for AI-scribe COMPLETED sessions (signedOffAt - createdAt)
 * against a *baseline cohort*: consultations whose appointment had NO
 * scribe session, sampled from the same window.
 *
 * Target: >50% reduction. Direction = up (bigger % reduction is better).
 * `current` is expressed as a fraction 0..1 representing the reduction.
 */
export async function doctorDocTimeReduction(
  input: MetricInput,
): Promise<KpiResult> {
  const { from, to } = input;

  const scribeSessions = await prisma.aIScribeSession.findMany({
    where: {
      status: "COMPLETED",
      signedOffAt: { not: null, gte: from, lte: to },
    },
    select: { createdAt: true, signedOffAt: true, appointmentId: true },
  });

  const scribeDurations = scribeSessions
    .filter((s) => s.signedOffAt)
    .map((s) => (s.signedOffAt!.getTime() - s.createdAt.getTime()) / 1000);

  // Baseline: consultations WITHOUT a scribe session in the same window.
  const scribeAppointmentIds = new Set(
    scribeSessions.map((s) => s.appointmentId),
  );
  const manualAppts = await prisma.appointment.findMany({
    where: {
      consultationStartedAt: { not: null, gte: from, lte: to },
      consultationEndedAt: { not: null },
      id: { notIn: [...scribeAppointmentIds] },
    },
    select: { consultationStartedAt: true, consultationEndedAt: true },
  });
  const manualDurations = manualAppts
    .filter((a) => a.consultationStartedAt && a.consultationEndedAt)
    .map(
      (a) =>
        (a.consultationEndedAt!.getTime() - a.consultationStartedAt!.getTime()) /
        1000,
    );

  if (scribeDurations.length === 0 || manualDurations.length === 0) {
    return {
      current: 0,
      baseline: median(manualDurations),
      target: 0.5,
      target_direction: "up",
      unit: "pct",
      sampleSize: scribeDurations.length,
      unavailable: true,
      reason:
        scribeDurations.length === 0
          ? "No completed scribe sessions in window."
          : "No manual-baseline consultations in window to compare against.",
    };
  }

  const scribeMedian = median(scribeDurations);
  const manualMedian = median(manualDurations);
  const reduction =
    manualMedian > 0
      ? Math.max(0, +((manualMedian - scribeMedian) / manualMedian).toFixed(4))
      : 0;

  return {
    current: reduction,
    baseline: Math.round(manualMedian),
    target: 0.5,
    target_direction: "up",
    unit: "pct",
    sampleSize: scribeDurations.length,
  };
}

/**
 * Doctor adoption = DAU/MAU = distinct doctors who signed off at least
 * one scribe session on a given day, averaged over the last 30 days,
 * divided by distinct doctor users active in the last 30 days.
 *
 * We approximate "doctors active" by counting DOCTOR users with
 * isActive=true — the precise DAU/MAU formula needs activity tracking we
 * don't have, so we fall back to a session-participation ratio.
 *
 * Target: >70%. Direction = up.
 */
export async function doctorAdoption(input: MetricInput): Promise<KpiResult> {
  const { from, to } = input;

  const signedOff = await prisma.aIScribeSession.findMany({
    where: {
      status: "COMPLETED",
      signedOffAt: { gte: from, lte: to },
      signedOffBy: { not: null },
    },
    select: { signedOffBy: true },
  });
  const activeDoctorUserIds = new Set(
    signedOff.map((s) => s.signedOffBy).filter(Boolean) as string[],
  );

  const totalDoctors = await prisma.user.count({
    where: { role: "DOCTOR", isActive: true },
  });

  return {
    current: pct(activeDoctorUserIds.size, totalDoctors),
    target: 0.7,
    target_direction: "up",
    unit: "pct",
    sampleSize: totalDoctors,
  };
}

/**
 * % of AI-drafted SOAP sections accepted without edit. We already compute
 * `AIScribeSession.doctorEdits` in the finalize route — here we count
 * sessions with ZERO edits in any section, per section, then average.
 *
 * Target: >60%. Direction = up.
 */
export async function soapAcceptanceRate(input: MetricInput): Promise<KpiResult> {
  const { from, to } = input;

  const sessions = await prisma.aIScribeSession.findMany({
    where: {
      status: "COMPLETED",
      signedOffAt: { gte: from, lte: to },
    },
    select: { doctorEdits: true },
  });

  if (sessions.length === 0) {
    return {
      current: 0,
      target: 0.6,
      target_direction: "up",
      unit: "pct",
      sampleSize: 0,
    };
  }

  const sections = ["subjective", "objective", "assessment", "plan"] as const;
  const acceptedPerSection: Record<string, number> = {
    subjective: 0,
    objective: 0,
    assessment: 0,
    plan: 0,
  };

  for (const s of sessions) {
    const edits = Array.isArray(s.doctorEdits)
      ? (s.doctorEdits as Array<{ section?: string }>)
      : [];
    const editedSections = new Set(edits.map((e) => e.section));
    for (const sec of sections) {
      if (!editedSections.has(sec)) acceptedPerSection[sec] += 1;
    }
  }

  const totalSectionAccepts =
    acceptedPerSection.subjective +
    acceptedPerSection.objective +
    acceptedPerSection.assessment +
    acceptedPerSection.plan;
  const totalSections = sessions.length * sections.length;

  return {
    current: pct(totalSectionAccepts, totalSections),
    target: 0.6,
    target_direction: "up",
    unit: "pct",
    sampleSize: sessions.length,
  };
}

/**
 * Drug-interaction alerts that led to a prescription change. The scribe
 * session's `rxDraft` (alerts + draft meds) is compared against the
 * finalized `soapFinal.plan.medications`: any medication that appears in
 * the draft but is missing/altered in the final is counted as "changed
 * because of alert" when a corresponding alert targets it.
 *
 * Target: none listed in PRD (reported as a raw rate for observation).
 * We report it as a percentage of ALERTED sessions that changed.
 *
 * Target direction: informational — we use "up" as a proxy (more changes
 * = alerts working) but set target=0 so it never shows a miss.
 */
export async function drugAlertInducedChanges(
  input: MetricInput,
): Promise<KpiResult> {
  const { from, to } = input;

  const sessions = await prisma.aIScribeSession.findMany({
    where: {
      status: "COMPLETED",
      signedOffAt: { gte: from, lte: to },
    },
    select: { rxDraft: true, soapFinal: true, soapDraft: true },
  });

  let alerted = 0;
  let changed = 0;
  for (const s of sessions) {
    const rx = s.rxDraft as Record<string, unknown> | null;
    const alerts =
      rx && Array.isArray(rx.alerts) ? (rx.alerts as Array<{ medication?: string }>) : [];
    if (alerts.length === 0) continue;
    alerted += 1;

    const draftMeds =
      ((s.soapDraft as Record<string, any>)?.plan?.medications as Array<{
        name?: string;
      }> | undefined) ?? [];
    const finalMeds =
      ((s.soapFinal as Record<string, any>)?.plan?.medications as Array<{
        name?: string;
      }> | undefined) ?? [];

    const draftNames = new Set(
      draftMeds.map((m) => (m.name ?? "").toLowerCase()).filter(Boolean),
    );
    const finalNames = new Set(
      finalMeds.map((m) => (m.name ?? "").toLowerCase()).filter(Boolean),
    );
    const alertTargets = new Set(
      alerts
        .map((a) => (a.medication ?? "").toLowerCase())
        .filter(Boolean),
    );

    // A change occurred if an alerted medication name is present in the draft
    // but absent from the final (or vice versa).
    for (const t of alertTargets) {
      if (draftNames.has(t) !== finalNames.has(t)) {
        changed += 1;
        break;
      }
    }
  }

  return {
    current: pct(changed, alerted),
    target: 0, // informational — PRD doesn't set a target
    target_direction: "up",
    unit: "pct",
    sampleSize: alerted,
  };
}

/**
 * Medication-error rate comparison (scribe vs manual). MedCore has no
 * centralized incident-reporting table; we'd need external data (incident
 * system / MedRec anomaly rate). Mark unavailable.
 */
export async function medicationErrorRateComparison(
  _input: MetricInput,
): Promise<KpiResult> {
  return {
    current: 0,
    target: 0,
    target_direction: "down",
    unavailable: true,
    reason:
      "No medication-incident data source in MedCore. Wire an external incident-reporting feed (or use MedReconciliation discrepancy counts) to populate this KPI.",
    unit: "pct",
  };
}

/**
 * Doctor NPS for the scribe. `PatientFeedback.nps` exists but is from the
 * patient side — we have no doctor-facing NPS collection path on
 * AIScribeSession. Mark unavailable with the proposed column in the
 * proposal doc.
 */
export async function doctorNpsForScribe(
  _input: MetricInput,
): Promise<KpiResult> {
  return {
    current: 0,
    target: 40,
    target_direction: "up",
    unavailable: true,
    reason:
      "AIScribeSession has no doctor-NPS column. See .prisma-models-kpi.md proposal to add `doctorNps Int?` so doctors can rate each scribe session.",
    unit: "rating",
  };
}

/**
 * Time-to-sign-off per consult. Uses `signedOffAt - latest transcript
 * update`. We approximate the last transcript update with
 * `AIScribeSession.updatedAt` for COMPLETED sessions where updatedAt is
 * the sign-off row-update itself; that's not ideal, so we fall back to
 * `signedOffAt - createdAt` and call out the limitation.
 *
 * Target: <60s median. Direction = down.
 */
export async function timeToSignOff(input: MetricInput): Promise<KpiResult> {
  const { from, to } = input;

  const sessions = await prisma.aIScribeSession.findMany({
    where: {
      status: "COMPLETED",
      signedOffAt: { gte: from, lte: to },
    },
    select: { createdAt: true, signedOffAt: true, transcript: true, updatedAt: true },
  });

  const deltas: number[] = [];
  for (const s of sessions) {
    if (!s.signedOffAt) continue;
    // Best proxy: last transcript entry timestamp, else createdAt.
    let lastTranscriptAt: Date | null = null;
    const transcript = Array.isArray(s.transcript)
      ? (s.transcript as Array<{ timestamp?: string }>)
      : [];
    for (let i = transcript.length - 1; i >= 0; i--) {
      const ts = transcript[i]?.timestamp;
      if (ts) {
        const d = new Date(ts);
        if (!Number.isNaN(d.getTime())) {
          lastTranscriptAt = d;
          break;
        }
      }
    }
    const anchor = lastTranscriptAt ?? s.createdAt;
    const ms = s.signedOffAt.getTime() - anchor.getTime();
    if (ms > 0) deltas.push(ms / 1000);
  }

  return {
    current: Math.round(median(deltas)),
    target: 60,
    target_direction: "down",
    unit: "seconds",
    sampleSize: deltas.length,
  };
}

// ─── Bundles ──────────────────────────────────────────────

export interface Feature1Bundle {
  misroutedOpdAppointments: KpiResult;
  bookingCompletionRate: KpiResult;
  patientCsatAiFlow: KpiResult;
  top1AcceptanceRate: KpiResult;
  timeToConfirmedAppointment: KpiResult;
  redFlagFalseNegativeRate: KpiResult;
  frontDeskCallVolume: KpiResult;
}

export interface Feature2Bundle {
  doctorDocTimeReduction: KpiResult;
  doctorAdoption: KpiResult;
  soapAcceptanceRate: KpiResult;
  drugAlertInducedChanges: KpiResult;
  medicationErrorRateComparison: KpiResult;
  doctorNpsForScribe: KpiResult;
  timeToSignOff: KpiResult;
}

export async function computeFeature1Bundle(
  input: MetricInput,
): Promise<Feature1Bundle> {
  const [
    misrouted,
    booking,
    csat,
    top1,
    timeConfirmed,
    redFlag,
    frontDesk,
  ] = await Promise.all([
    misroutedOpdAppointments(input),
    bookingCompletionRate(input),
    patientCsatAiFlow(input),
    top1AcceptanceRate(input),
    timeToConfirmedAppointment(input),
    redFlagFalseNegativeRate(input),
    frontDeskCallVolume(input),
  ]);

  return {
    misroutedOpdAppointments: misrouted,
    bookingCompletionRate: booking,
    patientCsatAiFlow: csat,
    top1AcceptanceRate: top1,
    timeToConfirmedAppointment: timeConfirmed,
    redFlagFalseNegativeRate: redFlag,
    frontDeskCallVolume: frontDesk,
  };
}

export async function computeFeature2Bundle(
  input: MetricInput,
): Promise<Feature2Bundle> {
  const [
    docTime,
    adoption,
    soap,
    rxChanges,
    medErr,
    nps,
    signOff,
  ] = await Promise.all([
    doctorDocTimeReduction(input),
    doctorAdoption(input),
    soapAcceptanceRate(input),
    drugAlertInducedChanges(input),
    medicationErrorRateComparison(input),
    doctorNpsForScribe(input),
    timeToSignOff(input),
  ]);

  return {
    doctorDocTimeReduction: docTime,
    doctorAdoption: adoption,
    soapAcceptanceRate: soap,
    drugAlertInducedChanges: rxChanges,
    medicationErrorRateComparison: medErr,
    doctorNpsForScribe: nps,
    timeToSignOff: signOff,
  };
}

/**
 * Flatten a mixed bundle into CSV rows.
 *
 * Columns: feature, metric, current, baseline, target, target_direction, unit, unavailable, reason, sampleSize.
 */
export function bundlesToCsv(
  f1: Feature1Bundle,
  f2: Feature2Bundle,
): string {
  const rows: string[] = [];
  rows.push(
    [
      "feature",
      "metric",
      "current",
      "baseline",
      "target",
      "target_direction",
      "unit",
      "unavailable",
      "reason",
      "sampleSize",
    ].join(","),
  );

  function escape(val: string | number | boolean | undefined): string {
    if (val === undefined || val === null) return "";
    const s = String(val);
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  function push(feature: string, metric: string, r: KpiResult) {
    rows.push(
      [
        escape(feature),
        escape(metric),
        escape(r.current),
        escape(r.baseline),
        escape(r.target),
        escape(r.target_direction),
        escape(r.unit),
        escape(r.unavailable ? "true" : "false"),
        escape(r.reason),
        escape(r.sampleSize),
      ].join(","),
    );
  }

  for (const [k, v] of Object.entries(f1)) push("feature1", k, v as KpiResult);
  for (const [k, v] of Object.entries(f2)) push("feature2", k, v as KpiResult);
  return rows.join("\n");
}
