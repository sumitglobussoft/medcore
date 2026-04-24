#!/usr/bin/env tsx
/**
 * backfill-default-tenant
 * ─────────────────────────────────────────────────────────────────────────────
 * Step 2 of the multi-tenant rollout.
 *
 * After migrations `20260423000004_tenant_foundation` and
 * `20260423000005_tenant_scope_extended` have shipped, every tenant-scoped
 * table now has a NULLABLE `tenantId TEXT` column populated with NULL for
 * every pre-existing row. This script:
 *
 *   1. Upserts a single `DEFAULT` tenant (subdomain `default`).
 *   2. Walks the 57 tenant-scoped tables (20 foundation + 37 extended) and
 *      sets `tenantId = <DEFAULT.id>` on every row where `tenantId IS NULL`.
 *   3. Reports per-table counts so the operator can spot-check that every
 *      expected row got labelled.
 *
 * A follow-up migration will then flip `tenantId` to `NOT NULL`.
 *
 * Design notes
 * ─────────────
 * • Dry-run by default. Pass `--apply` to write.
 * • `updateMany({ where: { tenantId: null } })` — idempotent. Re-runs simply
 *   find zero rows to update.
 * • Uses the raw `prisma` client (no tenant scoping) on purpose — backfill
 *   must be cross-tenant.
 * • stderr carries progress logging; stdout carries a single JSON summary.
 *
 * Usage
 * ─────
 *   # dry-run (DEFAULT):
 *   npx tsx scripts/backfill-default-tenant.ts
 *
 *   # apply:
 *   npx tsx scripts/backfill-default-tenant.ts --apply
 */

import { config as loadEnv } from "dotenv";
import path from "path";
import { prisma } from "@medcore/db";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), "apps/api/.env") });

if (!process.env.DATABASE_URL) {
  console.error(
    "[backfill] FATAL: DATABASE_URL is not set. Aborting before any DB work.",
  );
  process.exit(2);
}

// ── CLI parsing ─────────────────────────────────────────────────────────────

interface CliArgs {
  apply: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--help" || arg === "-h") {
      console.error(
        "Usage: tsx scripts/backfill-default-tenant.ts [--apply]",
      );
      process.exit(0);
    }
  }
  return { apply };
}

const args = parseArgs(process.argv.slice(2));
const MODE: "DRY_RUN" | "APPLY" = args.apply ? "APPLY" : "DRY_RUN";

// ── Tenant-scoped table driver ──────────────────────────────────────────────

/**
 * Each entry binds a human-readable label to the matching Prisma model
 * delegate. We call `count` and `updateMany` through the delegate so that
 * the TypeScript compiler keeps us honest about typos — no raw SQL.
 */
const TABLES: Array<{
  label: string;
  count: () => Promise<number>;
  updateNullToDefault: (defaultId: string) => Promise<{ count: number }>;
}> = [
  {
    label: "users",
    count: () => prisma.user.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.user.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "doctors",
    count: () => prisma.doctor.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.doctor.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "patients",
    count: () => prisma.patient.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.patient.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "appointments",
    count: () => prisma.appointment.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.appointment.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "consultations",
    count: () => prisma.consultation.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.consultation.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "prescriptions",
    count: () => prisma.prescription.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.prescription.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "invoices",
    count: () => prisma.invoice.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.invoice.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "payments",
    count: () => prisma.payment.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.payment.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "lab_orders",
    count: () => prisma.labOrder.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.labOrder.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "lab_results",
    count: () => prisma.labResult.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.labResult.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "admissions",
    count: () => prisma.admission.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.admission.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "medication_orders",
    count: () => prisma.medicationOrder.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.medicationOrder.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "nurse_rounds",
    count: () => prisma.nurseRound.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.nurseRound.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "referrals",
    count: () => prisma.referral.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.referral.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "surgeries",
    count: () => prisma.surgery.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.surgery.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "staff_shifts",
    count: () => prisma.staffShift.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.staffShift.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "leave_requests",
    count: () => prisma.leaveRequest.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.leaveRequest.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "telemedicine_sessions",
    count: () => prisma.telemedicineSession.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.telemedicineSession.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "emergency_cases",
    count: () => prisma.emergencyCase.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.emergencyCase.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "notifications",
    count: () => prisma.notification.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.notification.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  // ── Extended scope (2026-04-23 — migration
  //    20260423000005_tenant_scope_extended) ─────────────────────────────────
  {
    label: "patient_allergies",
    count: () => prisma.patientAllergy.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.patientAllergy.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "chronic_conditions",
    count: () => prisma.chronicCondition.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.chronicCondition.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "family_history",
    count: () => prisma.familyHistory.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.familyHistory.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "immunizations",
    count: () => prisma.immunization.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.immunization.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "patient_documents",
    count: () => prisma.patientDocument.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.patientDocument.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "vitals",
    count: () => prisma.vitals.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.vitals.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "ipd_vitals",
    count: () => prisma.ipdVitals.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.ipdVitals.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "patient_family_links",
    count: () => prisma.patientFamilyLink.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.patientFamilyLink.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "medication_administrations",
    count: () =>
      prisma.medicationAdministration.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.medicationAdministration.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "antenatal_cases",
    count: () => prisma.antenatalCase.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.antenatalCase.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "anc_visits",
    count: () => prisma.ancVisit.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.ancVisit.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "growth_records",
    count: () => prisma.growthRecord.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.growthRecord.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "med_reconciliations",
    count: () => prisma.medReconciliation.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.medReconciliation.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "preauth_requests",
    count: () => prisma.preAuthRequest.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.preAuthRequest.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "ai_scribe_sessions",
    count: () => prisma.aIScribeSession.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.aIScribeSession.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "ai_triage_sessions",
    count: () => prisma.aITriageSession.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.aITriageSession.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "lab_report_explanations",
    count: () =>
      prisma.labReportExplanation.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.labReportExplanation.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "adherence_schedules",
    count: () => prisma.adherenceSchedule.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.adherenceSchedule.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "consent_artefacts",
    count: () => prisma.consentArtefact.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.consentArtefact.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "waitlist_entries",
    count: () => prisma.waitlistEntry.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.waitlistEntry.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "coordinated_visits",
    count: () => prisma.coordinatedVisit.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.coordinatedVisit.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "health_packages",
    count: () => prisma.healthPackage.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.healthPackage.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "package_purchases",
    count: () => prisma.packagePurchase.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.packagePurchase.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "payment_plans",
    count: () => prisma.paymentPlan.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.paymentPlan.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "payment_plan_installments",
    count: () =>
      prisma.paymentPlanInstallment.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.paymentPlanInstallment.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "scheduled_reports",
    count: () => prisma.scheduledReport.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.scheduledReport.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "report_runs",
    count: () => prisma.reportRun.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.reportRun.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "patient_feedback",
    count: () => prisma.patientFeedback.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.patientFeedback.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "complaints",
    count: () => prisma.complaint.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.complaint.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "staff_certifications",
    count: () =>
      prisma.staffCertification.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.staffCertification.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "overtime_records",
    count: () => prisma.overtimeRecord.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.overtimeRecord.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "holidays",
    count: () => prisma.holiday.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.holiday.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "beds",
    count: () => prisma.bed.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.bed.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "wards",
    count: () => prisma.ward.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.ward.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "chat_rooms",
    count: () => prisma.chatRoom.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.chatRoom.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "chat_messages",
    count: () => prisma.chatMessage.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.chatMessage.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "chat_participants",
    count: () => prisma.chatParticipant.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.chatParticipant.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  // ── Extended scope (2026-04-24 — migration
  //    20260424000002_admission_dama_and_tenant_extension) ──────────────
  {
    label: "doctor_schedules",
    count: () => prisma.doctorSchedule.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.doctorSchedule.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "schedule_overrides",
    count: () => prisma.scheduleOverride.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.scheduleOverride.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "prescription_templates",
    count: () =>
      prisma.prescriptionTemplate.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.prescriptionTemplate.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "insurance_claims",
    count: () => prisma.insuranceClaim.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.insuranceClaim.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "ipd_intake_output",
    count: () => prisma.ipdIntakeOutput.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.ipdIntakeOutput.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "inventory_items",
    count: () => prisma.inventoryItem.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.inventoryItem.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "stock_movements",
    count: () => prisma.stockMovement.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.stockMovement.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "operating_theaters",
    count: () => prisma.operatingTheater.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.operatingTheater.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "anesthesia_records",
    count: () => prisma.anesthesiaRecord.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.anesthesiaRecord.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "post_op_observations",
    count: () => prisma.postOpObservation.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.postOpObservation.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "suppliers",
    count: () => prisma.supplier.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.supplier.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "purchase_orders",
    count: () => prisma.purchaseOrder.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.purchaseOrder.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "expenses",
    count: () => prisma.expense.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.expense.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "blood_donors",
    count: () => prisma.bloodDonor.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.bloodDonor.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "blood_donations",
    count: () => prisma.bloodDonation.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.bloodDonation.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "blood_screenings",
    count: () => prisma.bloodScreening.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.bloodScreening.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "blood_temperature_logs",
    count: () =>
      prisma.bloodTemperatureLog.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.bloodTemperatureLog.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "blood_cross_matches",
    count: () => prisma.bloodCrossMatch.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.bloodCrossMatch.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "blood_units",
    count: () => prisma.bloodUnit.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.bloodUnit.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "blood_requests",
    count: () => prisma.bloodRequest.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.bloodRequest.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "ambulances",
    count: () => prisma.ambulance.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.ambulance.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "ambulance_fuel_logs",
    count: () => prisma.ambulanceFuelLog.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.ambulanceFuelLog.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "ambulance_trips",
    count: () => prisma.ambulanceTrip.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.ambulanceTrip.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "assets",
    count: () => prisma.asset.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.asset.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "asset_transfers",
    count: () => prisma.assetTransfer.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.assetTransfer.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "asset_assignments",
    count: () => prisma.assetAssignment.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.assetAssignment.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "asset_maintenance",
    count: () => prisma.assetMaintenance.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.assetMaintenance.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "ultrasound_records",
    count: () => prisma.ultrasoundRecord.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.ultrasoundRecord.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "visitors",
    count: () => prisma.visitor.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.visitor.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "credit_notes",
    count: () => prisma.creditNote.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.creditNote.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "advance_payments",
    count: () => prisma.advancePayment.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.advancePayment.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "supplier_payments",
    count: () => prisma.supplierPayment.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.supplierPayment.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "supplier_catalog_items",
    count: () =>
      prisma.supplierCatalogItem.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.supplierCatalogItem.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "grns",
    count: () => prisma.grn.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.grn.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "visitor_blacklist",
    count: () => prisma.visitorBlacklist.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.visitorBlacklist.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "expense_budgets",
    count: () => prisma.expenseBudget.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.expenseBudget.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "leave_balances",
    count: () => prisma.leaveBalance.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.leaveBalance.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "notification_templates",
    count: () =>
      prisma.notificationTemplate.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.notificationTemplate.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "notification_schedules",
    count: () =>
      prisma.notificationSchedule.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.notificationSchedule.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "notification_broadcasts",
    count: () =>
      prisma.notificationBroadcast.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.notificationBroadcast.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "advance_directives",
    count: () => prisma.advanceDirective.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.advanceDirective.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "patient_belongings",
    count: () => prisma.patientBelongings.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.patientBelongings.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "discount_approvals",
    count: () => prisma.discountApproval.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.discountApproval.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "pharmacy_returns",
    count: () => prisma.pharmacyReturn.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.pharmacyReturn.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "stock_transfers",
    count: () => prisma.stockTransfer.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.stockTransfer.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "controlled_substance_register",
    count: () =>
      prisma.controlledSubstanceEntry.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.controlledSubstanceEntry.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "lab_qc_entries",
    count: () => prisma.labQCEntry.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.labQCEntry.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "shared_links",
    count: () => prisma.sharedLink.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.sharedLink.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "partographs",
    count: () => prisma.partograph.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.partograph.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "postnatal_visits",
    count: () => prisma.postnatalVisit.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.postnatalVisit.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "milestone_records",
    count: () => prisma.milestoneRecord.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.milestoneRecord.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "feeding_logs",
    count: () => prisma.feedingLog.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.feedingLog.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "donor_deferrals",
    count: () => prisma.donorDeferral.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.donorDeferral.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "component_separations",
    count: () =>
      prisma.componentSeparation.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.componentSeparation.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "adherence_dose_logs",
    count: () => prisma.adherenceDoseLog.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.adherenceDoseLog.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "abha_links",
    count: () => prisma.abhaLink.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.abhaLink.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "care_contexts",
    count: () => prisma.careContext.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.careContext.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "insurance_claims_v2",
    count: () => prisma.insuranceClaim2.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.insuranceClaim2.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
];

const DEFAULT_TENANT_SUBDOMAIN = "default";
const DEFAULT_TENANT_NAME = "DEFAULT";

async function ensureDefaultTenant(): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.tenant.findUnique({
    where: { subdomain: DEFAULT_TENANT_SUBDOMAIN },
    select: { id: true },
  });
  if (existing) {
    return { id: existing.id, created: false };
  }

  if (MODE === "DRY_RUN") {
    // Synthesise a placeholder id so the rest of the script can continue
    // printing accurate per-table counts. No writes happen.
    return { id: "<dry-run-would-create>", created: true };
  }

  const created = await prisma.tenant.create({
    data: {
      name: DEFAULT_TENANT_NAME,
      subdomain: DEFAULT_TENANT_SUBDOMAIN,
      plan: "BASIC",
      active: true,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function main() {
  const startedAt = new Date();
  console.error(
    `[backfill] mode=${MODE} startedAt=${startedAt.toISOString()}`,
  );

  const tenant = await ensureDefaultTenant();
  console.error(
    `[backfill] default tenant id=${tenant.id} created=${tenant.created}`,
  );

  const perTable: Array<{
    table: string;
    nullBefore: number;
    updated: number;
  }> = [];

  for (const t of TABLES) {
    const nullBefore = await t.count();
    let updated = 0;

    if (MODE === "APPLY" && nullBefore > 0) {
      const result = await t.updateNullToDefault(tenant.id);
      updated = result.count;
    }

    console.error(
      `[backfill:${MODE}] ${t.label}: ${nullBefore} NULL rows, ${
        MODE === "APPLY" ? `${updated} updated` : "would update"
      }`,
    );

    perTable.push({ table: t.label, nullBefore, updated });
  }

  const totalNull = perTable.reduce((a, b) => a + b.nullBefore, 0);
  const totalUpdated = perTable.reduce((a, b) => a + b.updated, 0);

  const finishedAt = new Date();
  const summary = {
    mode: MODE,
    defaultTenantId: tenant.id,
    defaultTenantCreated: tenant.created,
    totalNullRows: totalNull,
    totalUpdated,
    perTable,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };

  console.error(
    `[backfill] done mode=${MODE} totalNull=${totalNull} totalUpdated=${totalUpdated}`,
  );
  console.log(JSON.stringify(summary));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill] FATAL:", err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
