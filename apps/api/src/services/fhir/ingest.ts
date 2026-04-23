/**
 * FHIR R4 → Prisma reverse mappers + transaction-bundle ingestion.
 *
 * Companion to `resources.ts` (forward mappers). Given an inbound FHIR
 * `transaction` bundle — typically the output of an ABDM/NDHM push or a
 * round-trip of our own `$everything` / `$export` endpoint — this module
 * upserts the contained resources into the MedCore domain schema.
 *
 * Design choices (intentional):
 *   • Atomicity: the entire bundle runs inside `prisma.$transaction` so any
 *     FK violation, constraint breach, or validation error rolls back every
 *     write. We return 400 with a single OperationOutcome in that case — no
 *     partial state.
 *   • Reference resolution: FHIR lets entries point at siblings via either
 *     `"Patient/<id>"` or the entry's own `fullUrl` (commonly a `urn:uuid:`).
 *     We build a two-way ref map so both forms resolve to the real Prisma id.
 *   • Topological ordering: Patients/Practitioners are always processed
 *     first, then Appointments/Encounters, then dependents (Composition,
 *     MedicationRequest, AllergyIntolerance). Entry order within the bundle
 *     is irrelevant to us.
 *   • Conservative scope: we only ingest resource types we have forward
 *     mappers for. Unknown types produce a `warning` OperationOutcome entry
 *     (not a failure). Ingest for Observation/DiagnosticReport/ServiceRequest
 *     is deliberately out of scope for this initial slice — those flows have
 *     their own MedCore models (LabOrder/LabResult) whose ownership and
 *     billing implications need separate design.
 *   • Upsert keys: Patient is keyed by MR number from
 *     `identifier[system=SYSTEMS.MR_NUMBER]`; Practitioner by our internal id
 *     identifier. New Patients without an existing `userId` cannot be created
 *     — FHIR Patients don't carry a MedCore User account. Callers who need to
 *     onboard a brand-new patient must first create the User via the auth API
 *     and then POST the bundle. This is mirrored for Practitioners.
 */

import { prisma } from "@medcore/db";
import {
  validateResource,
  type ValidationIssue,
} from "./validator";
import { SYSTEMS } from "./resources";
import type { FhirBundle, FhirBundleEntry } from "./bundle";
import type {
  FhirResource,
  FhirPatient,
  FhirPractitioner,
  FhirAppointment,
  FhirEncounter,
  FhirComposition,
  FhirMedicationRequest,
  FhirAllergyIntolerance,
  FhirReference,
} from "./resources";

// ─── Types ──────────────────────────────────────────────────────────────────

/** Transaction client type — Prisma's callback form accepts a scoped client. */
type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/** Action taken on a given resource. */
export type IngestAction = "create" | "update" | "noop";

export interface IngestResult {
  /** Prisma id of the resulting entity. */
  id: string;
  action: IngestAction;
  /** FHIR-style location, e.g. "Patient/abc-123". */
  location: string;
}

/** OperationOutcome-style issue used in per-entry response payloads. */
export interface OutcomeIssue {
  severity: "error" | "warning" | "information";
  code: string;
  diagnostics: string;
}

/**
 * Per-entry response in the returned transaction-response bundle. Mirrors
 * FHIR R4 `Bundle.entry.response` structure.
 */
export interface BundleEntryResponse {
  status: string; // e.g. "201 Created", "200 OK", "400 Bad Request"
  location?: string;
  outcome?: { resourceType: "OperationOutcome"; issue: OutcomeIssue[] };
}

/** Resource types we have forward mappers for and will ingest. */
const SUPPORTED_TYPES = new Set([
  "Patient",
  "Practitioner",
  "Appointment",
  "Encounter",
  "Composition",
  "MedicationRequest",
  "AllergyIntolerance",
]);

/** Topological priority — lower runs first. */
const PRIORITY: Record<string, number> = {
  Patient: 0,
  Practitioner: 0,
  Appointment: 1,
  Encounter: 1,
  Composition: 2,
  MedicationRequest: 2,
  AllergyIntolerance: 2,
};

// ─── Reference resolution ───────────────────────────────────────────────────

/**
 * The ref map maps both `Patient/<id>` style references and a bundle entry's
 * `fullUrl` (typically `urn:uuid:...`) to the real Prisma id we assign during
 * ingestion. Both forward and reverse directions are registered so mappers
 * can look up refs regardless of which form was used in the source bundle.
 */
class RefMap {
  private map = new Map<string, string>();

  /** Register that `key` (reference or fullUrl) resolves to `realId`. */
  set(key: string, realId: string): void {
    this.map.set(key, realId);
  }

  /**
   * Resolve an incoming reference string (e.g. `"Patient/urn:uuid:abc"`,
   * `"urn:uuid:abc"`, or `"Patient/pat-123"`) to the real Prisma id.
   * Returns `undefined` when no mapping exists — callers decide whether to
   * fall back to trusting the id or raise an error.
   */
  resolve(ref: FhirReference | string | undefined): string | undefined {
    if (!ref) return undefined;
    const r = typeof ref === "string" ? ref : ref.reference;
    if (!r) return undefined;
    const direct = this.map.get(r);
    if (direct) return direct;
    // "Patient/urn:uuid:xxx" → strip the type prefix and try the bare URN.
    const slashIdx = r.indexOf("/");
    if (slashIdx > 0) {
      const tail = r.slice(slashIdx + 1);
      const mapped = this.map.get(tail);
      if (mapped) return mapped;
      // Also accept the raw tail (id without resource prefix) as a last resort.
      return tail;
    }
    return r;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function findIdentifier(
  identifiers: Array<{ system?: string; value: string }> | undefined,
  system: string
): string | undefined {
  return identifiers?.find((i) => i.system === system)?.value;
}

function mapGenderBack(
  g: "male" | "female" | "other" | "unknown"
): "MALE" | "FEMALE" | "OTHER" {
  switch (g) {
    case "male":
      return "MALE";
    case "female":
      return "FEMALE";
    default:
      return "OTHER";
  }
}

function mapAppointmentStatusBack(
  s: FhirAppointment["status"]
):
  | "BOOKED"
  | "CHECKED_IN"
  | "IN_CONSULTATION"
  | "COMPLETED"
  | "CANCELLED"
  | "NO_SHOW" {
  switch (s) {
    case "booked":
      return "BOOKED";
    case "checked-in":
      return "CHECKED_IN";
    case "arrived":
      return "IN_CONSULTATION";
    case "fulfilled":
      return "COMPLETED";
    case "cancelled":
      return "CANCELLED";
    case "noshow":
      return "NO_SHOW";
    default:
      return "BOOKED";
  }
}

function mapAllergySeverityBack(
  criticality: FhirAllergyIntolerance["criticality"],
  reactionSeverity?: "mild" | "moderate" | "severe"
): "MILD" | "MODERATE" | "SEVERE" | "LIFE_THREATENING" {
  if (criticality === "high") return "SEVERE";
  if (reactionSeverity === "severe") return "SEVERE";
  if (reactionSeverity === "moderate" || criticality === "low") return "MODERATE";
  return "MILD";
}

/** Normalise a FHIR dateTime to JS Date (or undefined). */
function toDate(s: string | undefined | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

/** Normalise a FHIR date (YYYY-MM-DD) to a JS Date. */
function toDateOnly(s: string | undefined | null): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  return isNaN(d.getTime()) ? undefined : d;
}

/** Extract HH:MM from an ISO datetime — used to reconstruct Appointment.slot*. */
function toSlotTime(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Format a FHIR-style location pointer for use in transaction-response entries. */
function locationFor(resourceType: string, id: string): string {
  return `${resourceType}/${id}`;
}

// ─── Per-resource reverse mappers ───────────────────────────────────────────

/**
 * Upsert a Patient keyed on MR number. Updates demographic/contact fields when
 * a match exists; errors when no match is found AND no MedCore User exists to
 * bind to (FHIR Patients don't carry auth credentials, so brand-new patient
 * onboarding must go through the normal registration API first).
 *
 * Only the Patient table is touched — related `user` fields (name/phone/email)
 * are intentionally NOT updated here to avoid destroying login credentials on
 * a careless round-trip.
 */
export async function ingestPatient(
  tx: Tx,
  resource: FhirPatient
): Promise<IngestResult> {
  const mrNumber = findIdentifier(resource.identifier, SYSTEMS.MR_NUMBER);

  // Try MR number first (stable business key), then fall back to resource.id
  // — the id in a round-tripped bundle is the MedCore Patient.id, which is a
  // uuid and unique.
  let existing = null as Awaited<ReturnType<typeof tx.patient.findFirst>>;
  if (mrNumber) {
    existing = await tx.patient.findFirst({ where: { mrNumber } });
  }
  if (!existing && resource.id) {
    existing = await tx.patient.findUnique({ where: { id: resource.id } });
  }

  const birthDate = toDateOnly(resource.birthDate);
  const address = resource.address?.[0]?.line?.join(", ");
  const gender = mapGenderBack(resource.gender);
  const abhaId = findIdentifier(resource.identifier, SYSTEMS.ABHA);
  const aadhaarMasked = findIdentifier(resource.identifier, SYSTEMS.AADHAAR);

  if (existing) {
    const updated = await tx.patient.update({
      where: { id: existing.id },
      data: {
        gender,
        dateOfBirth: birthDate ?? existing.dateOfBirth,
        address: address ?? existing.address,
        abhaId: abhaId ?? existing.abhaId,
        aadhaarMasked: aadhaarMasked ?? existing.aadhaarMasked,
      },
    });
    return {
      id: updated.id,
      action: "update",
      location: locationFor("Patient", updated.id),
    };
  }

  // No existing patient — we cannot mint a Patient without a backing User.
  throw new Error(
    `ingestPatient: no existing Patient with mrNumber=${mrNumber ?? "<none>"} ` +
      `or id=${resource.id}. FHIR Patient ingest cannot create new User accounts; ` +
      `register the patient via the normal API first.`
  );
}

/**
 * Upsert a Practitioner by MedCore doctor id (the `SYSTEMS.DOCTOR_USER_ID`
 * identifier produced by the forward mapper). Like Patients, we refuse to
 * create new Doctor rows from a FHIR push because there's no corresponding
 * User account — updates only.
 */
export async function ingestPractitioner(
  tx: Tx,
  resource: FhirPractitioner
): Promise<IngestResult> {
  const doctorId = findIdentifier(resource.identifier, SYSTEMS.DOCTOR_USER_ID);

  let existing = null as Awaited<ReturnType<typeof tx.doctor.findUnique>>;
  if (doctorId) {
    existing = await tx.doctor.findUnique({ where: { id: doctorId } });
  }
  if (!existing && resource.id) {
    existing = await tx.doctor.findUnique({ where: { id: resource.id } });
  }

  if (!existing) {
    throw new Error(
      `ingestPractitioner: no existing Doctor with id=${doctorId ?? resource.id}. ` +
        `FHIR Practitioner ingest cannot create new User accounts.`
    );
  }

  // Pull qualification text/specialization from the first qualification.code
  const firstQual = resource.qualification?.[0]?.code;
  const qualification = firstQual?.text ?? existing.qualification;
  const specialization =
    firstQual?.coding?.[0]?.display ?? firstQual?.coding?.[0]?.code ?? existing.specialization;

  const updated = await tx.doctor.update({
    where: { id: existing.id },
    data: { qualification, specialization },
  });

  return {
    id: updated.id,
    action: "update",
    location: locationFor("Practitioner", updated.id),
  };
}

/**
 * Create or update an Appointment. Patient + Practitioner references must
 * already be registered in the ref map (topological ordering guarantees this
 * inside `processBundle`).
 */
export async function ingestAppointment(
  tx: Tx,
  resource: FhirAppointment,
  refs: RefMap
): Promise<IngestResult> {
  const patientRef = resource.participant.find((p) =>
    p.actor?.reference?.startsWith("Patient/")
  )?.actor;
  const doctorRef = resource.participant.find((p) =>
    p.actor?.reference?.startsWith("Practitioner/")
  )?.actor;

  const patientId = refs.resolve(patientRef);
  const doctorId = refs.resolve(doctorRef);
  if (!patientId) {
    throw new Error("ingestAppointment: could not resolve Patient reference");
  }
  if (!doctorId) {
    throw new Error("ingestAppointment: could not resolve Practitioner reference");
  }

  const startIso = resource.start;
  const slotStart = toSlotTime(startIso);
  const slotEnd = toSlotTime(resource.end);
  // FHIR start is an instant; strip to YYYY-MM-DD for the appointment.date column.
  const date = startIso
    ? new Date(startIso.slice(0, 10))
    : new Date();

  const status = mapAppointmentStatusBack(resource.status);
  const type =
    (resource.appointmentType?.text as string | undefined)?.toUpperCase() ?? "WALK_IN";

  const existing = resource.id
    ? await tx.appointment.findUnique({ where: { id: resource.id } })
    : null;

  if (existing) {
    const updated = await tx.appointment.update({
      where: { id: existing.id },
      data: {
        status,
        slotStart: slotStart ?? existing.slotStart,
        slotEnd: slotEnd ?? existing.slotEnd,
        notes: resource.description ?? existing.notes,
      },
    });
    return {
      id: updated.id,
      action: "update",
      location: locationFor("Appointment", updated.id),
    };
  }

  // Assign next token for the doctor/date pair — mimics the walk-in path.
  const last = await tx.appointment.findFirst({
    where: { doctorId, date },
    orderBy: { tokenNumber: "desc" },
    select: { tokenNumber: true },
  });
  const tokenNumber = (last?.tokenNumber ?? 0) + 1;

  const created = await tx.appointment.create({
    data: {
      patientId,
      doctorId,
      date,
      tokenNumber,
      type: (["WALK_IN", "CONSULTATION", "FOLLOWUP", "EMERGENCY"].includes(type)
        ? type
        : "WALK_IN") as any,
      status: status as any,
      slotStart,
      slotEnd,
      notes: resource.description,
    },
  });

  return {
    id: created.id,
    action: "create",
    location: locationFor("Appointment", created.id),
  };
}

/**
 * Ingest an Encounter — creates/updates the Consultation bound to the
 * referenced Appointment. FHIR Encounters without a matching Appointment are
 * rejected (consultations are 1:1 with appointments in MedCore).
 */
export async function ingestEncounter(
  tx: Tx,
  resource: FhirEncounter,
  refs: RefMap
): Promise<IngestResult> {
  const patientId = refs.resolve(resource.subject);
  const doctorId = refs.resolve(resource.participant?.[0]?.individual);
  if (!patientId) throw new Error("ingestEncounter: unresolved subject reference");
  if (!doctorId) throw new Error("ingestEncounter: unresolved practitioner reference");

  // Consultation.id matches Encounter.id per forward mapper — so look up by that.
  const existing = resource.id
    ? await tx.consultation.findUnique({ where: { id: resource.id } })
    : null;

  if (existing) {
    return {
      id: existing.id,
      action: "noop",
      location: locationFor("Encounter", existing.id),
    };
  }

  // To create a new Consultation we need an Appointment — try to find the most
  // recent appointment for this patient/doctor whose consultation slot is free.
  const appointment = await tx.appointment.findFirst({
    where: { patientId, doctorId, consultation: { is: null } },
    orderBy: { date: "desc" },
  });
  if (!appointment) {
    throw new Error(
      "ingestEncounter: no unlinked Appointment found for this patient/doctor pair"
    );
  }

  const created = await tx.consultation.create({
    data: {
      appointmentId: appointment.id,
      doctorId,
    },
  });

  return {
    id: created.id,
    action: "create",
    location: locationFor("Encounter", created.id),
  };
}

/**
 * Ingest a Composition — in MedCore a Composition is the narrative wrapper
 * around a Consultation (findings + notes). When a matching Consultation
 * exists (resolved via the Composition's encounter reference), we copy the
 * narrative sections into its findings/notes columns.
 */
export async function ingestComposition(
  tx: Tx,
  resource: FhirComposition,
  refs: RefMap
): Promise<IngestResult> {
  const consultationId = refs.resolve(resource.encounter);
  if (!consultationId) {
    throw new Error("ingestComposition: missing or unresolved encounter reference");
  }

  const existing = await tx.consultation.findUnique({
    where: { id: consultationId },
  });
  if (!existing) {
    throw new Error(`ingestComposition: Consultation ${consultationId} not found`);
  }

  const findings = resource.section?.find((s) => s.title === "Clinical findings")?.text?.div;
  const notes = resource.section?.find((s) => s.title === "Consultation note")?.text?.div;

  const updated = await tx.consultation.update({
    where: { id: consultationId },
    data: {
      findings: findings ? stripDiv(findings) : existing.findings,
      notes: notes ? stripDiv(notes) : existing.notes,
    },
  });

  return {
    id: updated.id,
    action: "update",
    location: locationFor("Composition", `comp-${updated.id}`),
  };
}

/**
 * Ingest a MedicationRequest — creates a Prescription (one per
 * patient/doctor/appointment triple) and appends a PrescriptionItem. Multiple
 * MedicationRequests in the same bundle that share subject+requester+encounter
 * are merged into a single Prescription with multiple items.
 *
 * The mapper looks up an existing unlinked Prescription for the most recent
 * Appointment of the patient/doctor pair; creates one if none is found.
 */
export async function ingestMedicationRequest(
  tx: Tx,
  resource: FhirMedicationRequest,
  refs: RefMap
): Promise<IngestResult> {
  const patientId = refs.resolve(resource.subject);
  const doctorId = refs.resolve(resource.requester);
  if (!patientId) throw new Error("ingestMedicationRequest: unresolved subject reference");
  if (!doctorId) throw new Error("ingestMedicationRequest: unresolved requester reference");

  const medName = resource.medicationCodeableConcept.text
    ?? resource.medicationCodeableConcept.coding?.[0]?.display
    ?? resource.medicationCodeableConcept.coding?.[0]?.code;
  if (!medName) {
    throw new Error("ingestMedicationRequest: medication has no text/coding");
  }

  const dosage = resource.dosageInstruction?.[0];
  const timingText = dosage?.timing?.code?.text ?? dosage?.timing?.code?.coding?.[0]?.display;

  // Parse the aggregated text back into dosage/frequency/duration when possible
  // (forward mapper joins them with " — ").
  const parts = (dosage?.text ?? "").split(" — ").map((p) => p.trim()).filter(Boolean);
  const dosageText = parts[0] ?? "As directed";
  const frequency = parts[1] ?? timingText ?? "As needed";
  const duration = parts[2] ?? "As needed";

  // Find or create the Prescription row. Idempotency key = most recent unlinked
  // appointment for this patient/doctor.
  const appointment = await tx.appointment.findFirst({
    where: { patientId, doctorId },
    orderBy: { date: "desc" },
  });
  if (!appointment) {
    throw new Error(
      "ingestMedicationRequest: no Appointment found for this patient/doctor pair"
    );
  }

  let prescription = await tx.prescription.findUnique({
    where: { appointmentId: appointment.id },
  });
  let action: IngestAction = "update";
  if (!prescription) {
    prescription = await tx.prescription.create({
      data: {
        appointmentId: appointment.id,
        patientId,
        doctorId,
        diagnosis: "Imported from FHIR bundle",
      },
    });
    action = "create";
  }

  await tx.prescriptionItem.create({
    data: {
      prescriptionId: prescription.id,
      medicineName: medName,
      dosage: dosageText,
      frequency,
      duration,
      refills: resource.dispenseRequest?.numberOfRepeatsAllowed ?? 0,
    },
  });

  return {
    id: prescription.id,
    action,
    location: locationFor("MedicationRequest", prescription.id),
  };
}

/**
 * Ingest an AllergyIntolerance — creates a PatientAllergy row. Duplicates are
 * detected by (patientId, allergen) — repeat ingestion is a no-op update.
 */
export async function ingestAllergyIntolerance(
  tx: Tx,
  resource: FhirAllergyIntolerance,
  refs: RefMap,
  recordedBy: string
): Promise<IngestResult> {
  const patientId = refs.resolve(resource.patient);
  if (!patientId) throw new Error("ingestAllergyIntolerance: unresolved patient reference");

  const allergen = resource.code?.text ?? resource.code?.coding?.[0]?.display;
  if (!allergen) throw new Error("ingestAllergyIntolerance: missing allergen code");

  const reactionText = resource.reaction?.[0]?.manifestation?.[0]?.text;
  const severity = mapAllergySeverityBack(
    resource.criticality,
    resource.reaction?.[0]?.severity
  );

  const existing = await tx.patientAllergy.findFirst({
    where: { patientId, allergen },
  });

  if (existing) {
    const updated = await tx.patientAllergy.update({
      where: { id: existing.id },
      data: { severity, reaction: reactionText ?? existing.reaction },
    });
    return {
      id: updated.id,
      action: "update",
      location: locationFor("AllergyIntolerance", updated.id),
    };
  }

  const created = await tx.patientAllergy.create({
    data: {
      patientId,
      allergen,
      severity,
      reaction: reactionText,
      notedBy: recordedBy,
      notedAt: toDate(resource.recordedDate) ?? new Date(),
    },
  });

  return {
    id: created.id,
    action: "create",
    location: locationFor("AllergyIntolerance", created.id),
  };
}

// ─── Bundle processing ──────────────────────────────────────────────────────

export interface ProcessBundleOptions {
  /**
   * MedCore User id to stamp on resources that track their creator
   * (e.g. PatientAllergy.notedBy). Defaults to "system".
   */
  recordedBy?: string;
}

export interface ProcessBundleResult {
  /** The FHIR transaction-response Bundle to return to the client. */
  bundle: FhirBundle;
  /** True when every entry succeeded; false when the transaction rolled back. */
  success: boolean;
  /** When success=false, the overall failure reason. */
  errorMessage?: string;
}

/**
 * Process a FHIR transaction bundle:
 *   1. Validate each entry's resource via `validateResource`.
 *   2. Skip-with-warning any unsupported resourceType.
 *   3. Topologically sort the remaining entries.
 *   4. Run everything inside a single `prisma.$transaction`.
 *   5. Build a `transaction-response` Bundle mirroring input entry order.
 *
 * On any error the transaction is rolled back and the returned bundle's
 * failing entry carries an OperationOutcome describing the cause. Prior
 * entries' responses will still show their would-be status for debugging,
 * but the DB state is unchanged.
 */
export async function processBundle(
  bundle: FhirBundle,
  opts: ProcessBundleOptions = {}
): Promise<ProcessBundleResult> {
  const recordedBy = opts.recordedBy ?? "system";
  const entries = bundle.entry ?? [];

  // Index each input entry by position so response entries align with input.
  const responses: BundleEntryResponse[] = entries.map(() => ({ status: "500 Internal Server Error" }));

  // First pass: filter to entries with a supported resourceType + validate.
  // Unsupported types get a warning OperationOutcome but don't block.
  const processable: Array<{ idx: number; entry: FhirBundleEntry }> = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const resource = entry?.resource as FhirResource | undefined;
    if (!resource) {
      responses[i] = {
        status: "400 Bad Request",
        outcome: toOutcome([{ severity: "error", path: "resource", message: "missing resource" }]),
      };
      return fail(bundle, responses, "missing resource");
    }

    const validation = validateResource(resource);
    const hardErrors = validation.issues.filter((x) => x.severity === "error");
    if (hardErrors.length > 0) {
      responses[i] = {
        status: "400 Bad Request",
        outcome: toOutcome(hardErrors),
      };
      return fail(bundle, responses, hardErrors.map((e) => e.message).join("; "));
    }

    if (!SUPPORTED_TYPES.has(resource.resourceType)) {
      responses[i] = {
        status: "200 OK",
        outcome: {
          resourceType: "OperationOutcome",
          issue: [
            {
              severity: "warning",
              code: "not-supported",
              diagnostics: `resourceType '${resource.resourceType}' is not supported by MedCore and was skipped`,
            },
          ],
        },
      };
      continue;
    }

    processable.push({ idx: i, entry });
  }

  // Topologically sort — stable sort by (PRIORITY[resourceType], originalIdx).
  processable.sort((a, b) => {
    const ra = (a.entry.resource as FhirResource).resourceType;
    const rb = (b.entry.resource as FhirResource).resourceType;
    const pa = PRIORITY[ra] ?? 99;
    const pb = PRIORITY[rb] ?? 99;
    if (pa !== pb) return pa - pb;
    return a.idx - b.idx;
  });

  // Run the whole lot inside one transaction.
  try {
    await prisma.$transaction(async (tx) => {
      const refs = new RefMap();

      for (const { idx, entry } of processable) {
        const resource = entry.resource as FhirResource;
        let result: IngestResult;

        switch (resource.resourceType) {
          case "Patient":
            result = await ingestPatient(tx, resource);
            break;
          case "Practitioner":
            result = await ingestPractitioner(tx, resource);
            break;
          case "Appointment":
            result = await ingestAppointment(tx, resource, refs);
            break;
          case "Encounter":
            result = await ingestEncounter(tx, resource, refs);
            break;
          case "Composition":
            result = await ingestComposition(tx, resource, refs);
            break;
          case "MedicationRequest":
            result = await ingestMedicationRequest(tx, resource, refs);
            break;
          case "AllergyIntolerance":
            result = await ingestAllergyIntolerance(tx, resource, refs, recordedBy);
            break;
          default:
            // Should never hit this — guarded by SUPPORTED_TYPES above.
            throw new Error(`Unsupported resourceType after filter: ${resource.resourceType}`);
        }

        // Register resolution keys for downstream entries.
        refs.set(`${resource.resourceType}/${resource.id}`, result.id);
        if (entry.fullUrl) {
          refs.set(entry.fullUrl, result.id);
          // Strip any "Type/urn:uuid:..." wrapping
          refs.set(`${resource.resourceType}/${entry.fullUrl}`, result.id);
        }

        responses[idx] = {
          status:
            result.action === "create"
              ? "201 Created"
              : result.action === "update"
                ? "200 OK"
                : "200 OK",
          location: result.location,
        };
      }
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Find the first entry that hasn't been marked 200/201 — it's the
    // failing one. (All entries start as 500; successful ones get upgraded.)
    let failedIdx = responses.findIndex((r) => !/^2\d\d /.test(r.status));
    if (failedIdx === -1) failedIdx = 0;
    responses[failedIdx] = {
      status: "400 Bad Request",
      outcome: {
        resourceType: "OperationOutcome",
        issue: [{ severity: "error", code: "processing", diagnostics: msg }],
      },
    };
    return fail(bundle, responses, msg);
  }

  return {
    bundle: buildResponseBundle(entries, responses),
    success: true,
  };
}

// ─── Output construction helpers ────────────────────────────────────────────

function toOutcome(issues: ValidationIssue[]): BundleEntryResponse["outcome"] {
  return {
    resourceType: "OperationOutcome",
    issue: issues.map((i) => ({
      severity: i.severity,
      code: i.severity === "error" ? "invalid" : "informational",
      diagnostics: `${i.path}: ${i.message}`,
    })),
  };
}

function buildResponseBundle(
  entries: FhirBundleEntry[],
  responses: BundleEntryResponse[]
): FhirBundle {
  return {
    resourceType: "Bundle",
    id: `txn-response-${Date.now()}`,
    type: "transaction-response",
    timestamp: new Date().toISOString(),
    entry: entries.map((e, i) => ({
      fullUrl: e.fullUrl,
      // `response` is the FHIR-standard field but our typed FhirBundleEntry
      // (defined in bundle.ts) keeps `request` — we cast to attach response
      // data in the exact FHIR R4 shape for clients.
      ...(({ response: responses[i] } as unknown) as { resource: FhirResource }),
    })) as FhirBundleEntry[],
  };
}

function fail(
  _bundle: FhirBundle,
  responses: BundleEntryResponse[],
  message: string
): ProcessBundleResult {
  return {
    bundle: buildResponseBundle(
      // Preserve entry count so responses align even on early failure.
      responses.map((_, i) => ({
        fullUrl: `urn:uuid:failed-${i}`,
        resource: { resourceType: "OperationOutcome", id: "x" } as unknown as FhirResource,
      })),
      responses
    ),
    success: false,
    errorMessage: message,
  };
}

// ─── Internal narrative helpers ─────────────────────────────────────────────

/** Strip the `<div xmlns="..."> ... </div>` wrapper produced by the forward mapper. */
function stripDiv(div: string): string {
  return div
    .replace(/^<div[^>]*>/, "")
    .replace(/<\/div>$/, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// Re-export RefMap for tests that want to inspect ref resolution behaviour.
export { RefMap };
