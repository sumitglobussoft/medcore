// Smart Follow-up Scheduler (PRD §7.2).
//
// Parses the SOAP `plan.followUpTimeline` free-text from a finalised AI Scribe
// consultation and proposes an ISO date + available slot for the patient's
// next visit. Falls back to a same-specialty GP if the original doctor has no
// availability on the target day. Exposes `suggestFollowUp(consultationId)`
// as the importable helper for the AI Scribe `/finalize` hook.

import { tenantScopedPrisma as prisma } from "../tenant-prisma";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FollowUpSuggestion {
  consultationId: string;
  suggestedDate: string; // ISO yyyy-mm-dd
  slotStart: string | null; // "HH:MM" or null if no slot free
  doctorId: string;
  reason: string; // free-text, e.g. "Follow up in 2 weeks for BP review"
  fallbackUsed: boolean; // true when a different doctor (same specialty) was selected
}

// ── parseFollowUpTimeline ─────────────────────────────────────────────────────

/**
 * Parse a free-text follow-up timeline like "follow up in 2 weeks" or
 * "review after 10 days" into a concrete number of days from today.
 * Returns null if no time horizon can be extracted — callers should skip
 * suggestion generation in that case.
 */
export function parseFollowUpTimeline(text: string | null | undefined): number | null {
  if (!text || typeof text !== "string") return null;
  const lower = text.toLowerCase();

  // Try to find a numeric horizon first.
  const patterns: { re: RegExp; multiplier: number }[] = [
    { re: /(\d+)\s*(?:day|days|d)\b/, multiplier: 1 },
    { re: /(\d+)\s*(?:week|weeks|wk|wks)\b/, multiplier: 7 },
    { re: /(\d+)\s*(?:month|months|mo|mos)\b/, multiplier: 30 },
    { re: /(\d+)\s*(?:year|years|yr|yrs)\b/, multiplier: 365 },
  ];
  for (const { re, multiplier } of patterns) {
    const m = lower.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (!isNaN(n) && n > 0) return n * multiplier;
    }
  }

  // Word-number fallbacks
  const words: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
    seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
  };
  for (const [word, n] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\s+week`).test(lower)) return n * 7;
    if (new RegExp(`\\b${word}\\s+day`).test(lower)) return n;
    if (new RegExp(`\\b${word}\\s+month`).test(lower)) return n * 30;
  }

  // Bare "next week" / "tomorrow" style hints
  if (/\btomorrow\b/.test(lower)) return 1;
  if (/\bnext\s+week\b/.test(lower)) return 7;
  if (/\bnext\s+month\b/.test(lower)) return 30;
  if (/\bprn\b|\bas\s+needed\b|\bif\s+not\s+improving\b/.test(lower)) {
    // Soft heuristic: fuzzy "as needed" defaults to 7 days so we still
    // surface a suggestion rather than silently dropping it.
    return 7;
  }

  return null;
}

// ── findAvailableSlot ─────────────────────────────────────────────────────────

/**
 * Given a doctor and a target date, return the first free slot that day.
 * "Free" = a slot appearing in the doctor's weekly schedule for that
 * day-of-week that is not already booked (excluding cancelled/no-show).
 * Returns null if the doctor has no schedule for that weekday or every
 * slot is taken.
 */
async function findAvailableSlot(doctorId: string, date: Date): Promise<string | null> {
  const dayOfWeek = date.getDay();
  const schedules = await prisma.doctorSchedule.findMany({
    where: { doctorId, dayOfWeek },
  });
  if (schedules.length === 0) return null;

  const bookedAppointments = await prisma.appointment.findMany({
    where: {
      doctorId,
      date,
      status: { notIn: ["CANCELLED", "NO_SHOW"] },
    },
    select: { slotStart: true },
  });
  const bookedSlots = new Set(bookedAppointments.map((a: any) => a.slotStart).filter(Boolean));

  for (const schedule of schedules) {
    const slots = enumerateSlots(
      schedule.startTime,
      schedule.endTime,
      schedule.slotDurationMinutes ?? 15
    );
    for (const s of slots) {
      if (!bookedSlots.has(s)) return s;
    }
  }
  return null;
}

function enumerateSlots(startTime: string, endTime: string, duration: number): string[] {
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  const out: string[] = [];
  for (let t = startMin; t + duration <= endMin; t += duration) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    out.push(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`);
  }
  return out;
}

// ── suggestFollowUp ───────────────────────────────────────────────────────────

/**
 * Compute a follow-up suggestion from a finalised consultation. Reads the
 * consultation notes (produced by AI Scribe) to find the follow-up timeline,
 * computes the target date, and picks the first available slot on that date
 * for the original doctor. Falls back to any same-specialty doctor with an
 * open slot that day if the original doctor is fully booked.
 *
 * Returns `null` when no follow-up timeline is documented.
 */
export async function suggestFollowUp(consultationId: string): Promise<FollowUpSuggestion | null> {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: {
      appointment: { select: { id: true, patientId: true } },
      doctor: { select: { id: true, specialization: true } },
    },
  });

  if (!consultation) return null;

  const rawFollowUp = extractFollowUpText(consultation.notes ?? "");
  const days = parseFollowUpTimeline(rawFollowUp);
  if (days == null) return null;

  const targetDate = new Date();
  targetDate.setHours(0, 0, 0, 0);
  targetDate.setDate(targetDate.getDate() + days);

  const originalDoctorId = consultation.doctorId;
  let doctorId = originalDoctorId;
  let fallbackUsed = false;

  let slot = await findAvailableSlot(originalDoctorId, targetDate);

  if (!slot) {
    // Fallback: find another doctor with the same specialization who has an
    // open slot on the target date. Prefer General Medicine as a safety net.
    const specialty = consultation.doctor?.specialization;
    if (specialty) {
      const candidates = await prisma.doctor.findMany({
        where: {
          specialization: specialty,
          id: { not: originalDoctorId },
          user: { isActive: true },
        },
        select: { id: true },
        take: 10,
      });
      for (const c of candidates) {
        const s = await findAvailableSlot(c.id, targetDate);
        if (s) {
          doctorId = c.id;
          slot = s;
          fallbackUsed = true;
          break;
        }
      }
    }
    // Last-ditch: any GP / General Medicine doctor with a slot
    if (!slot) {
      const gps = await prisma.doctor.findMany({
        where: { specialization: { in: ["General Medicine", "General Physician"] }, user: { isActive: true } },
        select: { id: true },
        take: 5,
      });
      for (const g of gps) {
        if (g.id === originalDoctorId) continue;
        const s = await findAvailableSlot(g.id, targetDate);
        if (s) {
          doctorId = g.id;
          slot = s;
          fallbackUsed = true;
          break;
        }
      }
    }
  }

  return {
    consultationId,
    suggestedDate: targetDate.toISOString().slice(0, 10),
    slotStart: slot,
    doctorId,
    reason: rawFollowUp || "Follow-up after consultation",
    fallbackUsed,
  };
}

// ── extractFollowUpText ───────────────────────────────────────────────────────

/**
 * Pull the follow-up clause from a free-text consultation `notes` field.
 * AI Scribe writes notes in the shape:
 *   Plan: {"followUpTimeline":"7 days","patientInstructions":"..."}
 * So we parse the Plan JSON first and fall back to a loose regex for
 * hand-authored notes.
 */
function extractFollowUpText(notes: string): string | null {
  if (!notes) return null;

  // Try Plan: {...} JSON block
  const planMatch = notes.match(/Plan:\s*(\{[\s\S]*?\})/);
  if (planMatch) {
    try {
      const plan = JSON.parse(planMatch[1]);
      if (plan && typeof plan.followUpTimeline === "string" && plan.followUpTimeline.trim()) {
        return plan.followUpTimeline.trim();
      }
    } catch {
      // fall through to regex
    }
  }

  // Looser: "Follow up in X weeks/days/months"
  const loose = notes.match(/follow[\s-]*up[^.\n]*?(?:in|after)?\s*(\d+\s*(?:day|week|month|year)s?)/i);
  if (loose) return loose[0];

  return null;
}
