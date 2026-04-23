/**
 * Clinical-scenario fixtures for FHIR round-trip testing.
 *
 * Each builder seeds a realistic Prisma-side graph for one clinical workflow
 * and returns an `expectedBundleShape` description that the round-trip tests
 * use to assert "the exported bundle contains at least these counts of these
 * resource types". The Prisma seeds are keyed with deterministic IDs so tests
 * can inspect the post-ingest DB state by known ids.
 *
 * IMPORTANT — NO PHI: every name / phone / address is synthetic and not
 * derived from any real patient record. Hindi-script fields are stock phrases
 * drawn from public-domain Wikipedia sample text.
 *
 * Usage pattern:
 *
 *   const { prismaSeeds, expectedBundleShape, patientId } = buildOPConsultationScenario();
 *   await prismaSeeds(prisma);
 *   const bundle = await exportFhirBundleForPatient(prisma, patientId);
 *   expect(bundle.entry.length).toBeGreaterThanOrEqual(expectedBundleShape.minEntries);
 *   …
 *
 * Design notes:
 *   • Builders are pure — they just assemble plain data and return a seeder
 *     function, so tests can call them outside a DB context too (e.g. to
 *     stress-shape the fixture without actually persisting anything).
 *   • Seeders assume a schema-fresh DB (resetDB) — no uniqueness collision
 *     handling beyond the per-scenario unique id prefix.
 *   • The builders write through the typed Prisma client delegates (no
 *     `as any` on delegate calls). Casts appear only where we need to stamp a
 *     literal id on a create (Prisma's TS types mark `id` as optional).
 */

import type { PrismaClient } from "@medcore/db";
import bcrypt from "bcryptjs";

// ─── Expected-shape description ─────────────────────────────────────────────

/**
 * What the round-trip test expects the exported searchset Bundle to look like
 * at minimum. Used as loose assertion material — tests only insist on the
 * listed counts being present; extras are fine (e.g. an encounter may or may
 * not produce a Composition depending on the forward mapper's guards).
 */
export interface ExpectedBundleShape {
  /** Minimum total entries (often the sum of the per-type counts, sometimes more). */
  minEntries: number;
  /** Minimum count of each resource type we must see in the exported bundle. */
  resourceCounts: {
    Patient?: number;
    Practitioner?: number;
    Appointment?: number;
    Encounter?: number;
    Composition?: number;
    MedicationRequest?: number;
    AllergyIntolerance?: number;
    ServiceRequest?: number;
    Observation?: number;
    DiagnosticReport?: number;
  };
  /** Optional free-form notes describing what this scenario exercises. */
  notes?: string;
}

export interface Scenario {
  /** Patient whose `$everything` export we'll round-trip. */
  patientId: string;
  /** Human-readable scenario label, surfaced in test names. */
  name: string;
  /** Seed everything this scenario needs into the provided Prisma client. */
  prismaSeeds: (prisma: PrismaClient) => Promise<void>;
  /** Expected minimum bundle contents after $everything export. */
  expectedBundleShape: ExpectedBundleShape;
}

// ─── Shared helpers ─────────────────────────────────────────────────────────

const PWD_HASH = bcrypt.hashSync("roundtrip-test-pwd", 4);

/**
 * Hash we use for every synthetic user — avoids bcrypt cost per-seed when a
 * scenario creates a dozen users. Calling code must treat these accounts as
 * read-only test data.
 */
export function testPasswordHash(): string {
  return PWD_HASH;
}

/** Build a deterministic email address given a scenario prefix + role + sequence. */
function emailFor(prefix: string, role: string, seq: number): string {
  return `${prefix}-${role}-${seq}@roundtrip.test.local`;
}

/** Build a deterministic 10-digit phone number. */
function phoneFor(seed: number): string {
  // Pad with leading digits to guarantee 10 digits.
  const base = (9000000000 + seed).toString();
  return base.length === 10 ? base : base.slice(0, 10);
}

interface UserRow {
  id: string;
  email: string;
  name: string;
  phone: string;
  passwordHash: string;
  role: "ADMIN" | "DOCTOR" | "NURSE" | "PATIENT";
}

/** Stamp explicit ids on the User row so the test can look it up later. */
function userRow(args: { id: string; email: string; name: string; phone: string; role: UserRow["role"] }): UserRow {
  return {
    id: args.id,
    email: args.email,
    name: args.name,
    phone: args.phone,
    passwordHash: PWD_HASH,
    role: args.role,
  };
}

// ─── Scenario 1: OP consultation ────────────────────────────────────────────

/**
 * Full OP (outpatient) consultation:
 *   • 1 Patient (with User row)
 *   • 1 Practitioner (Doctor + User)
 *   • 1 Appointment
 *   • 1 Consultation (Encounter + Composition)
 *   • 2 MedicationRequests (one medication with frequency/duration, one PRN)
 *   • 1 AllergyIntolerance
 *
 * Note: MedicationRequests are derived from a single Prescription with two
 * items (one PrescriptionItem per medication). Forward mapper emits one
 * `MedicationRequest` per `PrescriptionItem`, so the scenario asserts that
 * 2 MedicationRequests land in the bundle from 1 Prescription+2 items.
 */
export function buildOPConsultationScenario(): Scenario {
  const prefix = "rt-op";
  const patientUserId = `${prefix}-pat-user`;
  const patientId = `${prefix}-pat`;
  const doctorUserId = `${prefix}-doc-user`;
  const doctorId = `${prefix}-doc`;
  const appointmentId = `${prefix}-appt`;
  const consultationId = `${prefix}-cons`;
  const prescriptionId = `${prefix}-rx`;
  const allergyId = `${prefix}-alg`;

  return {
    name: "OPConsultation",
    patientId,
    expectedBundleShape: {
      minEntries: 7,
      resourceCounts: {
        Patient: 1,
        Practitioner: 1,
        Appointment: 1,
        Encounter: 1,
        Composition: 1,
        MedicationRequest: 2,
        AllergyIntolerance: 1,
      },
      notes: "Single OPD visit; tests the common happy-path Consult Note NDHM profile.",
    },
    prismaSeeds: async (prisma) => {
      await prisma.user.create({
        data: userRow({
          id: patientUserId,
          email: emailFor(prefix, "pat", 1),
          name: "Ramesh Kumar Gupta",
          phone: phoneFor(101),
          role: "PATIENT",
        }),
      });
      await prisma.user.create({
        data: userRow({
          id: doctorUserId,
          email: emailFor(prefix, "doc", 1),
          name: "Priya Ramachandran",
          phone: phoneFor(201),
          role: "DOCTOR",
        }),
      });
      await prisma.patient.create({
        data: {
          id: patientId,
          userId: patientUserId,
          mrNumber: `${prefix}-MR-1001`,
          dateOfBirth: new Date("1972-08-14"),
          gender: "MALE",
          address: "Flat 4B, Rose Apartments, Koramangala, Bengaluru",
          bloodGroup: "B+",
          abhaId: "14-1234-5678-9012",
          aadhaarMasked: "XXXX-XXXX-4421",
        },
      });
      await prisma.doctor.create({
        data: {
          id: doctorId,
          userId: doctorUserId,
          specialization: "General Medicine",
          qualification: "MBBS, MD (General Medicine)",
        },
      });
      await prisma.appointment.create({
        data: {
          id: appointmentId,
          patientId,
          doctorId,
          date: new Date("2026-04-22"),
          slotStart: "10:30",
          slotEnd: "10:45",
          tokenNumber: 4,
          type: "SCHEDULED",
          status: "COMPLETED",
          priority: "NORMAL",
          consultationStartedAt: new Date("2026-04-22T10:32:00Z"),
          consultationEndedAt: new Date("2026-04-22T10:58:00Z"),
          notes: "Follow-up for hypertension.",
        },
      });
      await prisma.consultation.create({
        data: {
          id: consultationId,
          appointmentId,
          doctorId,
          findings: "BP 138/88. Heart sounds normal, no murmurs. Weight 78 kg.",
          notes: "Continue Telmisartan 40mg OD. Add Metformin 500mg BD for newly-diagnosed Type 2 DM. Review in 4 weeks.",
        },
      });
      await prisma.prescription.create({
        data: {
          id: prescriptionId,
          patientId,
          doctorId,
          appointmentId,
          diagnosis: "Essential hypertension; Type 2 diabetes mellitus without complications",
          advice: "Low-salt diet; daily 30-min walk; monitor home BP.",
          items: {
            create: [
              {
                medicineName: "Telmisartan 40mg",
                dosage: "1 tablet",
                frequency: "OD",
                duration: "30 days",
                instructions: "Morning, before breakfast",
                refills: 2,
              },
              {
                medicineName: "Metformin 500mg",
                dosage: "1 tablet",
                frequency: "BD",
                duration: "30 days",
                instructions: "After food",
                refills: 2,
              },
            ],
          },
        },
      });
      await prisma.patientAllergy.create({
        data: {
          id: allergyId,
          patientId,
          allergen: "Sulfa drugs",
          severity: "SEVERE",
          reaction: "Stevens-Johnson syndrome",
          notedBy: doctorUserId,
          notedAt: new Date("2020-03-10"),
        },
      });
    },
  };
}

// ─── Scenario 2: Lab workup (CBC) ───────────────────────────────────────────

/**
 * A simple lab workup: one ServiceRequest with four Observations (CBC panel:
 * Hemoglobin, WBC, Platelets, Hematocrit) bundled into a DiagnosticReport.
 * Tests the lab flow: ServiceRequest + Observations + DiagnosticReport.
 */
export function buildLabWorkupScenario(): Scenario {
  const prefix = "rt-lab";
  const patientUserId = `${prefix}-pat-user`;
  const patientId = `${prefix}-pat`;
  const doctorUserId = `${prefix}-doc-user`;
  const doctorId = `${prefix}-doc`;
  const labOrderId = `${prefix}-lo`;
  const cbcTestId = `${prefix}-test-cbc`;
  const cbcOrderItemId = `${prefix}-loi-cbc`;

  return {
    name: "LabWorkup",
    patientId,
    expectedBundleShape: {
      minEntries: 7,
      resourceCounts: {
        Patient: 1,
        Practitioner: 1,
        ServiceRequest: 1,
        Observation: 4,
        DiagnosticReport: 1,
      },
      notes: "Full CBC panel: 4 numeric Observations grouped under one DiagnosticReport.",
    },
    prismaSeeds: async (prisma) => {
      await prisma.user.create({
        data: userRow({
          id: patientUserId,
          email: emailFor(prefix, "pat", 1),
          name: "Arjun Sivaraman",
          phone: phoneFor(301),
          role: "PATIENT",
        }),
      });
      await prisma.user.create({
        data: userRow({
          id: doctorUserId,
          email: emailFor(prefix, "doc", 1),
          name: "Sheela Nair",
          phone: phoneFor(401),
          role: "DOCTOR",
        }),
      });
      await prisma.patient.create({
        data: {
          id: patientId,
          userId: patientUserId,
          mrNumber: `${prefix}-MR-2001`,
          dateOfBirth: new Date("1990-02-27"),
          gender: "MALE",
          address: "21 Pondy Bazaar, T.Nagar, Chennai",
          bloodGroup: "O+",
        },
      });
      await prisma.doctor.create({
        data: {
          id: doctorId,
          userId: doctorUserId,
          specialization: "Hematology",
          qualification: "MBBS, MD (Pathology)",
        },
      });
      await prisma.labTest.create({
        data: {
          id: cbcTestId,
          code: "CBC-RT-LAB",
          name: "Complete Blood Count",
          category: "Hematology",
          price: 300,
          sampleType: "Blood",
          unit: "various",
        },
      });
      // Seed a matching appointment so the ingest path (and analytics) isn't
      // surprised by an orphan lab order; export path works regardless.
      await prisma.appointment.create({
        data: {
          id: `${prefix}-appt`,
          patientId,
          doctorId,
          date: new Date("2026-04-21"),
          slotStart: "09:00",
          slotEnd: "09:15",
          tokenNumber: 2,
          type: "SCHEDULED",
          status: "COMPLETED",
          priority: "NORMAL",
        },
      });
      await prisma.labOrder.create({
        data: {
          id: labOrderId,
          orderNumber: `LO-${prefix}-01`,
          patientId,
          doctorId,
          status: "COMPLETED",
          priority: "ROUTINE",
          stat: false,
          orderedAt: new Date("2026-04-21T09:30:00Z"),
          collectedAt: new Date("2026-04-21T09:45:00Z"),
          completedAt: new Date("2026-04-21T11:15:00Z"),
          items: {
            create: [{ id: cbcOrderItemId, testId: cbcTestId, status: "COMPLETED" }],
          },
        },
      });
      await prisma.labResult.createMany({
        data: [
          {
            id: `${prefix}-res-hgb`,
            orderItemId: cbcOrderItemId,
            parameter: "Hemoglobin",
            value: "14.2",
            unit: "g/dL",
            normalRange: "13.0-17.0 g/dL",
            flag: "NORMAL",
            enteredBy: doctorUserId,
            reportedAt: new Date("2026-04-21T11:00:00Z"),
            verifiedAt: new Date("2026-04-21T11:10:00Z"),
            verifiedBy: doctorUserId,
          },
          {
            id: `${prefix}-res-wbc`,
            orderItemId: cbcOrderItemId,
            parameter: "WBC Count",
            value: "11500",
            unit: "/uL",
            normalRange: "4000-11000 /uL",
            flag: "HIGH",
            enteredBy: doctorUserId,
            reportedAt: new Date("2026-04-21T11:00:00Z"),
            verifiedAt: new Date("2026-04-21T11:10:00Z"),
            verifiedBy: doctorUserId,
          },
          {
            id: `${prefix}-res-plt`,
            orderItemId: cbcOrderItemId,
            parameter: "Platelets",
            value: "265000",
            unit: "/uL",
            normalRange: "150000-400000 /uL",
            flag: "NORMAL",
            enteredBy: doctorUserId,
            reportedAt: new Date("2026-04-21T11:00:00Z"),
            verifiedAt: new Date("2026-04-21T11:10:00Z"),
            verifiedBy: doctorUserId,
          },
          {
            id: `${prefix}-res-hct`,
            orderItemId: cbcOrderItemId,
            parameter: "Hematocrit",
            value: "42.35",
            unit: "%",
            normalRange: "40-54 %",
            flag: "NORMAL",
            enteredBy: doctorUserId,
            reportedAt: new Date("2026-04-21T11:00:00Z"),
            verifiedAt: new Date("2026-04-21T11:10:00Z"),
            verifiedBy: doctorUserId,
          },
        ],
      });
    },
  };
}

// ─── Scenario 3: Chronic-care (18 months of hypertension + DM follow-up) ────

/**
 * Realistic chronic-care patient:
 *   • 3 Practitioners (GP, Cardiologist, Nurse — the nurse has a User but no
 *     Doctor row, so the exported bundle still emits 2 Practitioners for the
 *     two Doctor rows; we note this explicitly in expectedBundleShape).
 *   • 6 Encounters spread over 18 months
 *   • 4 MedicationRequests total (across multiple prescriptions with dose
 *     changes — telmisartan 40 → 80 mg mid-course, metformin added, aspirin
 *     added).
 *   • 3 AllergyIntolerances
 *   • 2 lab workups (HbA1c + Lipid panel)
 */
export function buildChronicCareScenario(): Scenario {
  const prefix = "rt-chr";
  const patientUserId = `${prefix}-pat-user`;
  const patientId = `${prefix}-pat`;
  const gpUserId = `${prefix}-gp-user`;
  const gpId = `${prefix}-gp`;
  const cardioUserId = `${prefix}-cardio-user`;
  const cardioId = `${prefix}-cardio`;
  // Nurse is stored as a USER only (no Doctor row) — the export mapper only
  // emits FHIR Practitioner for MedCore Doctor rows, so the nurse won't appear
  // in the bundle. We still seed the user to reflect real-world data.
  const nurseUserId = `${prefix}-nurse-user`;

  // 6 encounters at ~3-month cadence.
  const visitDates = [
    "2024-10-15",
    "2025-01-20",
    "2025-04-12",
    "2025-07-05",
    "2025-10-18",
    "2026-02-22",
  ];

  return {
    name: "ChronicCare",
    patientId,
    expectedBundleShape: {
      // 1 Patient + 2 Practitioners + 6 Appointments + 6 Encounters + ≤6 Compositions
      // + ≥4 MedicationRequests + 3 AllergyIntolerances + 2 ServiceRequests + ≥2
      // Observations + 2 DiagnosticReports ≈ at least 26 entries.
      minEntries: 26,
      resourceCounts: {
        Patient: 1,
        Practitioner: 2,
        Appointment: 6,
        Encounter: 6,
        MedicationRequest: 4,
        AllergyIntolerance: 3,
        ServiceRequest: 2,
        Observation: 2,
        DiagnosticReport: 2,
      },
      notes:
        "Hypertensive + diabetic 18-month timeline; two lab workups (HbA1c panel + Lipid panel). " +
        "Nurse user exists but has no Doctor row, so it is not exported as a Practitioner.",
    },
    prismaSeeds: async (prisma) => {
      await prisma.user.createMany({
        data: [
          userRow({
            id: patientUserId,
            email: emailFor(prefix, "pat", 1),
            name: "Vikram Seshadri",
            phone: phoneFor(501),
            role: "PATIENT",
          }),
          userRow({
            id: gpUserId,
            email: emailFor(prefix, "gp", 1),
            name: "Anupama Menon",
            phone: phoneFor(601),
            role: "DOCTOR",
          }),
          userRow({
            id: cardioUserId,
            email: emailFor(prefix, "cardio", 1),
            name: "Rajesh Bhatia",
            phone: phoneFor(701),
            role: "DOCTOR",
          }),
          userRow({
            id: nurseUserId,
            email: emailFor(prefix, "nurse", 1),
            name: "Suman Reddy",
            phone: phoneFor(801),
            role: "NURSE",
          }),
        ],
      });
      await prisma.patient.create({
        data: {
          id: patientId,
          userId: patientUserId,
          mrNumber: `${prefix}-MR-3001`,
          dateOfBirth: new Date("1958-11-04"),
          gender: "MALE",
          address: "Plot 11, Sector 5, Salt Lake, Kolkata",
          bloodGroup: "A+",
          abhaId: "14-5555-6666-7777",
        },
      });
      await prisma.doctor.createMany({
        data: [
          {
            id: gpId,
            userId: gpUserId,
            specialization: "Family Medicine",
            qualification: "MBBS, DFM",
          },
          {
            id: cardioId,
            userId: cardioUserId,
            specialization: "Cardiology",
            qualification: "MBBS, MD, DM (Cardiology)",
          },
        ],
      });
      await prisma.patientAllergy.createMany({
        data: [
          {
            id: `${prefix}-alg-1`,
            patientId,
            allergen: "Penicillin",
            severity: "MODERATE",
            reaction: "Urticaria",
            notedBy: gpUserId,
            notedAt: new Date("2023-05-11"),
          },
          {
            id: `${prefix}-alg-2`,
            patientId,
            allergen: "Latex",
            severity: "MILD",
            reaction: "Localised contact dermatitis",
            notedBy: gpUserId,
            notedAt: new Date("2023-05-11"),
          },
          {
            id: `${prefix}-alg-3`,
            patientId,
            allergen: "Iodinated contrast",
            severity: "SEVERE",
            reaction: "Anaphylactoid reaction, bronchospasm",
            notedBy: cardioUserId,
            notedAt: new Date("2024-01-19"),
          },
        ],
      });

      // 6 appointments — alternating GP / cardio.
      for (let i = 0; i < visitDates.length; i++) {
        const doctorId = i % 2 === 0 ? gpId : cardioId;
        const apptId = `${prefix}-appt-${i + 1}`;
        await prisma.appointment.create({
          data: {
            id: apptId,
            patientId,
            doctorId,
            date: new Date(visitDates[i]),
            slotStart: "11:00",
            slotEnd: "11:20",
            tokenNumber: i + 1,
            type: "SCHEDULED",
            status: "COMPLETED",
            priority: "NORMAL",
            consultationStartedAt: new Date(`${visitDates[i]}T11:00:00Z`),
            consultationEndedAt: new Date(`${visitDates[i]}T11:18:00Z`),
          },
        });
        await prisma.consultation.create({
          data: {
            id: `${prefix}-cons-${i + 1}`,
            appointmentId: apptId,
            doctorId,
            findings:
              i === 0
                ? "BP 162/98 at presentation. Resting ECG: LVH criteria."
                : `Visit ${i + 1}/6 — BP ${150 - i * 3}/${92 - i}. Weight trending down.`,
            notes: `Plan: continue current regimen. Next review in 3 months.`,
          },
        });
      }

      // 2 prescriptions across 4 items (dose-change history).
      await prisma.prescription.create({
        data: {
          id: `${prefix}-rx-early`,
          patientId,
          doctorId: gpId,
          appointmentId: `${prefix}-appt-1`,
          diagnosis: "Stage 2 essential hypertension",
          items: {
            create: [
              { medicineName: "Telmisartan 40mg", dosage: "1 tablet", frequency: "OD", duration: "90 days", refills: 3 },
              { medicineName: "Amlodipine 5mg", dosage: "1 tablet", frequency: "OD", duration: "90 days", refills: 3 },
            ],
          },
        },
      });
      await prisma.prescription.create({
        data: {
          id: `${prefix}-rx-late`,
          patientId,
          doctorId: cardioId,
          appointmentId: `${prefix}-appt-6`,
          diagnosis: "Hypertension, controlled; Type 2 DM newly diagnosed",
          items: {
            create: [
              { medicineName: "Telmisartan 80mg", dosage: "1 tablet", frequency: "OD", duration: "90 days", refills: 3 },
              { medicineName: "Metformin 500mg", dosage: "1 tablet", frequency: "BD", duration: "90 days", refills: 3 },
            ],
          },
        },
      });

      // 2 lab workups — HbA1c + lipid panel.
      await prisma.labTest.createMany({
        data: [
          { id: `${prefix}-test-hba1c`, code: `HBA1C-${prefix}`, name: "Hemoglobin A1c", category: "Biochemistry", price: 500 },
          { id: `${prefix}-test-lipid`, code: `LIPID-${prefix}`, name: "Lipid Panel", category: "Biochemistry", price: 700 },
        ],
      });
      await prisma.labOrder.create({
        data: {
          id: `${prefix}-lo-hba1c`,
          orderNumber: `LO-${prefix}-HBA1C`,
          patientId,
          doctorId: cardioId,
          status: "COMPLETED",
          priority: "ROUTINE",
          stat: false,
          orderedAt: new Date("2026-02-20"),
          completedAt: new Date("2026-02-21T08:00:00Z"),
          items: {
            create: [{ id: `${prefix}-loi-hba1c`, testId: `${prefix}-test-hba1c`, status: "COMPLETED" }],
          },
        },
      });
      await prisma.labResult.create({
        data: {
          id: `${prefix}-res-hba1c`,
          orderItemId: `${prefix}-loi-hba1c`,
          parameter: "HbA1c",
          value: "7.8",
          unit: "%",
          normalRange: "4.0-5.6 %",
          flag: "HIGH",
          enteredBy: cardioUserId,
          reportedAt: new Date("2026-02-21T08:00:00Z"),
          verifiedAt: new Date("2026-02-21T08:15:00Z"),
          verifiedBy: cardioUserId,
        },
      });
      await prisma.labOrder.create({
        data: {
          id: `${prefix}-lo-lipid`,
          orderNumber: `LO-${prefix}-LIPID`,
          patientId,
          doctorId: cardioId,
          status: "COMPLETED",
          priority: "ROUTINE",
          stat: false,
          orderedAt: new Date("2026-02-20"),
          completedAt: new Date("2026-02-21T08:00:00Z"),
          items: {
            create: [{ id: `${prefix}-loi-lipid`, testId: `${prefix}-test-lipid`, status: "COMPLETED" }],
          },
        },
      });
      await prisma.labResult.create({
        data: {
          id: `${prefix}-res-lipid`,
          orderItemId: `${prefix}-loi-lipid`,
          parameter: "Total Cholesterol",
          value: "186",
          unit: "mg/dL",
          normalRange: "< 200 mg/dL",
          flag: "NORMAL",
          enteredBy: cardioUserId,
          reportedAt: new Date("2026-02-21T08:00:00Z"),
          verifiedAt: new Date("2026-02-21T08:15:00Z"),
          verifiedBy: cardioUserId,
        },
      });
    },
  };
}

// ─── Scenario 4: Paediatric patient ─────────────────────────────────────────

/**
 * A 6-year-old paediatric patient with immunisation history and growth records.
 * Exercises the under-18 age edge case and the "single given name, no family
 * name" naming convention common in Indian paediatric records.
 *
 * Immunization + GrowthRecord are NOT in the forward-mapper scope (see
 * resources.ts comments). Only the Patient row + 1 appointment + 1 allergy
 * round-trip; the Immunization / GrowthRecord rows exist in the DB but don't
 * appear in the FHIR bundle. This is deliberate — the scenario documents
 * the gap so a future PR that adds Immunization mapping knows what the
 * baseline looked like.
 */
export function buildPaediatricScenario(): Scenario {
  const prefix = "rt-ped";
  const patientUserId = `${prefix}-pat-user`;
  const patientId = `${prefix}-pat`;
  const doctorUserId = `${prefix}-doc-user`;
  const doctorId = `${prefix}-doc`;

  return {
    name: "Paediatric",
    patientId,
    expectedBundleShape: {
      minEntries: 4,
      resourceCounts: {
        Patient: 1,
        Practitioner: 1,
        Appointment: 1,
        Encounter: 1,
        AllergyIntolerance: 1,
      },
      notes:
        "Paediatric patient (age < 18) with single given name; Immunization + GrowthRecord " +
        "rows exist in the DB but forward mappers don't emit them yet — deliberately documented.",
    },
    prismaSeeds: async (prisma) => {
      await prisma.user.create({
        data: userRow({
          id: patientUserId,
          email: emailFor(prefix, "pat", 1),
          // Single-given-name convention (no family name).
          name: "Aarav",
          phone: phoneFor(901),
          role: "PATIENT",
        }),
      });
      await prisma.user.create({
        data: userRow({
          id: doctorUserId,
          email: emailFor(prefix, "doc", 1),
          name: "Meera Jayakumar",
          phone: phoneFor(902),
          role: "DOCTOR",
        }),
      });
      await prisma.patient.create({
        data: {
          id: patientId,
          userId: patientUserId,
          mrNumber: `${prefix}-MR-4001`,
          dateOfBirth: new Date("2019-12-03"),
          age: 6,
          gender: "MALE",
          address: "A-12, Green Park, New Delhi",
          bloodGroup: "O+",
        },
      });
      await prisma.doctor.create({
        data: {
          id: doctorId,
          userId: doctorUserId,
          specialization: "Paediatrics",
          qualification: "MBBS, DCH",
        },
      });
      await prisma.appointment.create({
        data: {
          id: `${prefix}-appt`,
          patientId,
          doctorId,
          date: new Date("2026-04-20"),
          slotStart: "10:00",
          slotEnd: "10:15",
          tokenNumber: 3,
          type: "SCHEDULED",
          status: "COMPLETED",
          priority: "NORMAL",
          consultationStartedAt: new Date("2026-04-20T10:00:00Z"),
          consultationEndedAt: new Date("2026-04-20T10:12:00Z"),
        },
      });
      await prisma.consultation.create({
        data: {
          id: `${prefix}-cons`,
          appointmentId: `${prefix}-appt`,
          doctorId,
          findings: "Well child. Growth on 50th percentile.",
          notes: "Next immunisation (Tdap booster) due at age 10.",
        },
      });
      await prisma.patientAllergy.create({
        data: {
          id: `${prefix}-alg`,
          patientId,
          allergen: "Peanut",
          severity: "SEVERE",
          reaction: "Oral swelling",
          notedBy: doctorUserId,
          notedAt: new Date("2023-01-15"),
        },
      });
      // Paediatric-specific rows that are *not* in FHIR mapper scope — kept
      // so the DB state mirrors a real paediatric chart.
      await prisma.immunization.createMany({
        data: [
          {
            patientId,
            vaccine: "BCG",
            doseNumber: 1,
            dateGiven: new Date("2019-12-05"),
            administeredBy: doctorUserId,
          },
          {
            patientId,
            vaccine: "DTP",
            doseNumber: 3,
            dateGiven: new Date("2020-06-04"),
            administeredBy: doctorUserId,
          },
        ],
      });
      await prisma.growthRecord.create({
        data: {
          patientId,
          measurementDate: new Date("2026-04-20"),
          ageMonths: 76,
          weightKg: 22.4,
          heightCm: 117.2,
          weightPercentile: 48,
          heightPercentile: 55,
          recordedBy: doctorUserId,
        },
      });
    },
  };
}

// ─── Scenario 5: Hindi (devanagari) patient ─────────────────────────────────

/**
 * Patient whose User.name and Patient.address use Devanagari script. Tests
 * UTF-8 round-trip without mojibake through the JSON bundle + DB columns.
 * The Hindi strings are intentionally plain ("रमेश कुमार", etc.) — all names
 * are fictitious and not linked to any real individual.
 */
export function buildHindiPatientScenario(): Scenario {
  const prefix = "rt-hin";
  const patientUserId = `${prefix}-pat-user`;
  const patientId = `${prefix}-pat`;
  const doctorUserId = `${prefix}-doc-user`;
  const doctorId = `${prefix}-doc`;

  const hindiName = "रमेश कुमार वर्मा";
  const hindiAddress = "१२३, गांधी मार्ग, नई दिल्ली ११०००१";

  return {
    name: "HindiPatient",
    patientId,
    expectedBundleShape: {
      minEntries: 3,
      resourceCounts: {
        Patient: 1,
        Practitioner: 1,
        Appointment: 1,
      },
      notes: "Edge case: non-latin (devanagari) characters must round-trip byte-identical.",
    },
    prismaSeeds: async (prisma) => {
      await prisma.user.create({
        data: userRow({
          id: patientUserId,
          email: emailFor(prefix, "pat", 1),
          name: hindiName,
          phone: phoneFor(1001),
          role: "PATIENT",
        }),
      });
      await prisma.user.create({
        data: userRow({
          id: doctorUserId,
          email: emailFor(prefix, "doc", 1),
          name: "Sunita Agarwal",
          phone: phoneFor(1002),
          role: "DOCTOR",
        }),
      });
      await prisma.patient.create({
        data: {
          id: patientId,
          userId: patientUserId,
          mrNumber: `${prefix}-MR-5001`,
          dateOfBirth: new Date("1965-07-19"),
          gender: "MALE",
          address: hindiAddress,
          bloodGroup: "AB+",
        },
      });
      await prisma.doctor.create({
        data: {
          id: doctorId,
          userId: doctorUserId,
          specialization: "General Medicine",
          qualification: "MBBS",
        },
      });
      await prisma.appointment.create({
        data: {
          id: `${prefix}-appt`,
          patientId,
          doctorId,
          date: new Date("2026-04-19"),
          slotStart: "12:00",
          slotEnd: "12:20",
          tokenNumber: 5,
          type: "SCHEDULED",
          status: "COMPLETED",
          priority: "NORMAL",
          consultationStartedAt: new Date("2026-04-19T12:00:00Z"),
          consultationEndedAt: new Date("2026-04-19T12:15:00Z"),
        },
      });
    },
  };
}

// ─── Public catalog ─────────────────────────────────────────────────────────

/** All scenarios the round-trip test should exercise by default. */
export const ALL_SCENARIOS = [
  buildOPConsultationScenario,
  buildLabWorkupScenario,
  buildChronicCareScenario,
  buildPaediatricScenario,
  buildHindiPatientScenario,
] as const;

// ─── Exported Hindi-specific constants (assertion material) ─────────────────

/** The exact Hindi name seeded by `buildHindiPatientScenario` — tests compare bytes. */
export const HINDI_PATIENT_NAME = "रमेश कुमार वर्मा";
/** The exact Hindi address seeded by `buildHindiPatientScenario`. */
export const HINDI_PATIENT_ADDRESS = "१२३, गांधी मार्ग, नई दिल्ली ११०००१";
