// AI-driven claim drafting (PRD §7.2 — Auto ICD/CPT Coding → Claim Draft).
//
// Bridges the AI Scribe output (SOAP notes + ICD-10/CPT codes stored on
// `AIScribeSession`) into an `InsuranceClaim2` draft row so reception can
// review and fire it off to the TPA with a single click instead of re-keying
// the whole form.
//
// Fallback mode: until `NormalisedClaimStatus.DRAFT_PENDING_REVIEW` lands
// (see `.prisma-models-ai-claims.md`), draft rows are persisted as
// `status = "SUBMITTED"` with a `[AI DRAFT]` marker in `notes`. The
// `GET /pending-drafts` endpoint filters on that marker so reception still
// has a clean review queue. Once the enum value ships, flip `DRAFT_STATUS`
// below to `"DRAFT_PENDING_REVIEW"` and the marker becomes redundant.

import { prisma } from "@medcore/db";
import type {
  InsuranceClaimRow,
} from "./store";
import { createClaim } from "./store";
import {
  NormalisedClaimStatus,
  TpaProvider,
} from "./adapter";

/**
 * Until the new enum value lands, "draft" rows live at `SUBMITTED` + a notes
 * marker. Centralised here so switching is a one-line change.
 */
export const DRAFT_STATUS: NormalisedClaimStatus = "SUBMITTED";
export const DRAFT_MARKER = "[AI DRAFT] Needs review";

/** Shape of the ICD-10 entries the scribe stores on `AIScribeSession.icd10Codes`. */
interface ScribeIcdEntry {
  code?: string;
  description?: string;
  confidence?: number;
}

/** Output shape of `draftClaimFromConsultation`. */
export interface DraftClaimResult {
  claim: InsuranceClaimRow;
  warnings: string[];
}

/**
 * Extract a list of ICD-10 code strings from whatever shape Prisma returns.
 * The scribe stores `{code, description, ...}` objects; older rows may just
 * be plain strings.
 */
function extractIcdCodes(raw: unknown): string[] {
  if (!raw) return [];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      if (entry.trim()) out.push(entry.trim());
    } else if (entry && typeof entry === "object") {
      const code = (entry as ScribeIcdEntry).code;
      if (typeof code === "string" && code.trim()) out.push(code.trim());
    }
  }
  return out;
}

/** Try to parse the assessment.impression out of a final SOAP JSON blob. */
function extractImpression(soap: unknown): string | null {
  if (!soap || typeof soap !== "object") return null;
  const s = soap as Record<string, any>;
  const assessment = s.assessment;
  if (!assessment || typeof assessment !== "object") return null;
  const imp = assessment.impression;
  return typeof imp === "string" && imp.trim() ? imp.trim() : null;
}

/** Fallback: yank a diagnosis sentence out of the consultation `notes` text. */
function impressionFromNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const match = notes.match(/Assessment:\s*([^\n]+)/i);
  if (match && match[1]) return match[1].trim();
  // Also tolerate the older "Diagnosis:" marker some flows wrote.
  const dx = notes.match(/Diagnosis:\s*([^\n]+)/i);
  return dx?.[1]?.trim() ?? null;
}

/**
 * Given a Patient row with the Patient.insuranceProvider free-text field,
 * map to a `TpaProvider` enum if we can recognise the issuer. Returns null
 * when we can't infer — caller treats that as a warning.
 */
function inferTpaProvider(rawProvider: string | null | undefined): TpaProvider | null {
  if (!rawProvider) return null;
  const norm = rawProvider.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  // Heuristic: accept exact enum names first, then common brand aliases.
  const directMatches: TpaProvider[] = [
    "MEDI_ASSIST",
    "PARAMOUNT",
    "VIDAL",
    "FHPL",
    "ICICI_LOMBARD",
    "STAR_HEALTH",
    "MOCK",
  ];
  for (const p of directMatches) {
    if (norm.includes(p)) return p;
  }
  if (norm.includes("MEDI") && norm.includes("ASSIST")) return "MEDI_ASSIST";
  if (norm.includes("ICICI")) return "ICICI_LOMBARD";
  if (norm.includes("STAR")) return "STAR_HEALTH";
  if (norm.includes("PARAMOUNT")) return "PARAMOUNT";
  if (norm.includes("VIDAL")) return "VIDAL";
  if (norm.includes("FHPL")) return "FHPL";
  return null;
}

/**
 * Create a draft `InsuranceClaim2` row from an existing consultation.
 *
 * Data flow:
 *   Consultation ─► Appointment ─► Invoice (billId, totalAmount)
 *                    └► Patient (insurance metadata, TPA)
 *                    └► AIScribeSession (optional — ICD codes + final SOAP)
 *
 * Returns the created row plus a `warnings` list so the caller (and the
 * reviewing receptionist) know what still needs manual attention:
 *   - missing or empty ICD-10 codes
 *   - no TPA provider inferrable from `Patient.insuranceProvider`
 *   - no invoice attached to the appointment yet
 *   - no impression found in SOAP / consultation notes
 */
export async function draftClaimFromConsultation(
  consultationId: string,
  opts: { createdBy?: string } = {}
): Promise<DraftClaimResult> {
  const warnings: string[] = [];

  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: {
      appointment: {
        include: {
          patient: true,
          invoice: true,
        },
      },
    },
  });

  if (!consultation) {
    throw new Error("Consultation not found");
  }
  const appointment = consultation.appointment;
  if (!appointment) {
    throw new Error("Consultation has no appointment linkage");
  }
  const invoice = appointment.invoice;
  if (!invoice) {
    throw new Error("Appointment has no invoice — cannot draft a claim without a bill");
  }
  const patient = appointment.patient;

  // Pull SOAP + ICD from the scribe session if one exists for this
  // appointment. Graceful: a consultation without a scribe session is a
  // manually written note and still permits drafting (just with warnings).
  const scribe = await prisma.aIScribeSession.findUnique({
    where: { appointmentId: appointment.id },
  });

  const icd10Codes = scribe ? extractIcdCodes(scribe.icd10Codes) : [];
  if (icd10Codes.length === 0) {
    warnings.push(
      "No ICD-10 codes attached to the consultation — TPA will likely reject. Add codes before submitting."
    );
  }

  const impression =
    (scribe ? extractImpression(scribe.soapFinal) ?? extractImpression(scribe.soapDraft) : null) ??
    impressionFromNotes(consultation.notes) ??
    "Diagnosis pending — see consultation notes";
  if (impression.startsWith("Diagnosis pending")) {
    warnings.push("No assessment impression found — using placeholder diagnosis.");
  }

  const tpaProvider = inferTpaProvider(patient.insuranceProvider);
  if (!tpaProvider) {
    warnings.push(
      "Patient has no recognised TPA on their Insurance record — defaulting to MOCK so draft still saves. Update the patient's insuranceProvider before submission."
    );
  }

  const policyNumber = patient.insurancePolicyNumber || "UNKNOWN";
  if (!patient.insurancePolicyNumber) {
    warnings.push("Patient has no policyNumber on file — set it before submitting to the TPA.");
  }

  const insurerName = patient.insuranceProvider || "Unknown Insurer";
  if (!patient.insuranceProvider) {
    warnings.push("Patient has no insurerName on file.");
  }

  const amountClaimed = Number(invoice.totalAmount ?? 0);
  if (!(amountClaimed > 0)) {
    warnings.push("Invoice total is zero — verify billing before submission.");
  }

  const created = await createClaim({
    billId: invoice.id,
    patientId: patient.id,
    tpaProvider: tpaProvider ?? "MOCK",
    providerClaimRef: null,
    insurerName,
    policyNumber,
    memberId: null,
    preAuthRequestId: null,
    diagnosis: impression,
    icd10Codes,
    procedureName: null,
    admissionDate: null,
    dischargeDate: null,
    amountClaimed,
    amountApproved: null,
    status: DRAFT_STATUS,
    deniedReason: null,
    notes: `${DRAFT_MARKER} | consultationId=${consultationId}`,
    submittedAt: new Date().toISOString(),
    approvedAt: null,
    settledAt: null,
    cancelledAt: null,
    lastSyncedAt: null,
    createdBy: opts.createdBy ?? "AI_CODER",
  });

  return { claim: created, warnings };
}

/**
 * List claim rows that are still in the AI-drafted / pending-review bucket.
 * Today filters on the notes marker; when `DRAFT_PENDING_REVIEW` lands this
 * flips to `status = "DRAFT_PENDING_REVIEW"` (see `.prisma-models-ai-claims.md`).
 */
export async function listPendingDrafts(): Promise<InsuranceClaimRow[]> {
  const rows = await prisma.insuranceClaim2.findMany({
    where: {
      status: DRAFT_STATUS,
      notes: { contains: "[AI DRAFT]" },
    },
    orderBy: { createdAt: "desc" },
  });
  // Import the mapper lazily — store.ts also exports one, but it's not
  // re-exported on the module surface. We rebuild the ISO-ified shape here
  // so callers get `InsuranceClaimRow` directly.
  return rows.map((row: any) => ({
    id: row.id,
    billId: row.billId,
    patientId: row.patientId,
    tpaProvider: row.tpaProvider as TpaProvider,
    providerClaimRef: row.providerClaimRef ?? null,
    insurerName: row.insurerName,
    policyNumber: row.policyNumber,
    memberId: row.memberId ?? null,
    preAuthRequestId: row.preAuthRequestId ?? null,
    diagnosis: row.diagnosis,
    icd10Codes: Array.isArray(row.icd10Codes)
      ? row.icd10Codes.filter((v: unknown) => typeof v === "string")
      : [],
    procedureName: row.procedureName ?? null,
    admissionDate: row.admissionDate ? new Date(row.admissionDate).toISOString() : null,
    dischargeDate: row.dischargeDate ? new Date(row.dischargeDate).toISOString() : null,
    amountClaimed: Number(row.amountClaimed),
    amountApproved:
      row.amountApproved === null || row.amountApproved === undefined
        ? null
        : Number(row.amountApproved),
    status: row.status as NormalisedClaimStatus,
    deniedReason: row.deniedReason ?? null,
    notes: row.notes ?? null,
    submittedAt: row.submittedAt
      ? new Date(row.submittedAt).toISOString()
      : new Date().toISOString(),
    approvedAt: row.approvedAt ? new Date(row.approvedAt).toISOString() : null,
    settledAt: row.settledAt ? new Date(row.settledAt).toISOString() : null,
    cancelledAt: row.cancelledAt ? new Date(row.cancelledAt).toISOString() : null,
    lastSyncedAt: row.lastSyncedAt ? new Date(row.lastSyncedAt).toISOString() : null,
    createdBy: row.createdBy,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
}
