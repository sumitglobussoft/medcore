-- ================================================================
-- 20260424000002_admission_dama_and_tenant_extension
--
-- Two small additive schema changes:
--
-- 1. Add `DISCHARGED_AGAINST_MEDICAL_ADVICE` to the
--    `AdmissionStatus` enum so the dedup-admissions script
--    (scripts/dedup-active-admissions.ts) and future DAMA UI
--    flow can set the canonical status instead of falling
--    back to `DISCHARGED` + a notes marker.
--
-- 2. Step 4 of the multi-tenant rollout. Adds a NULLABLE
--    `tenantId` column + index + FK (ON DELETE SET NULL) to
--    58 additional patient / clinical / staff / commercial
--    tables that earlier batches (20260423000004_tenant_foundation
--    and 20260423000005_tenant_scope_extended) missed:
--
--      * Scheduling (2)         — doctor_schedules,
--                                 schedule_overrides.
--      * Clinical subtables (9) — prescription_templates,
--                                 insurance_claims, ipd_intake_output,
--                                 anesthesia_records,
--                                 post_op_observations,
--                                 ultrasound_records, partographs,
--                                 postnatal_visits, milestone_records.
--      * Pharmacy / lab (8)     — inventory_items, stock_movements,
--                                 pharmacy_returns, stock_transfers,
--                                 controlled_substance_register,
--                                 lab_qc_entries, discount_approvals,
--                                 shared_links.
--      * Surgery / OT (1)       — operating_theaters.
--      * Supply chain (6)       — suppliers, purchase_orders,
--                                 expenses, supplier_payments,
--                                 supplier_catalog_items, grns.
--      * Blood bank (9)         — blood_donors, blood_donations,
--                                 blood_screenings, blood_temperature_logs,
--                                 blood_cross_matches, blood_units,
--                                 blood_requests, donor_deferrals,
--                                 component_separations.
--      * Fleet (3)              — ambulances, ambulance_fuel_logs,
--                                 ambulance_trips.
--      * Assets (4)             — assets, asset_transfers,
--                                 asset_assignments, asset_maintenance.
--      * Visitor (2)            — visitors, visitor_blacklist.
--      * Finance (2)            — credit_notes, advance_payments.
--      * HR / ops (4)           — expense_budgets, leave_balances,
--                                 notification_templates,
--                                 notification_schedules,
--                                 notification_broadcasts.
--      * Clinical PHI (4)       — advance_directives, patient_belongings,
--                                 feeding_logs, adherence_dose_logs.
--      * ABDM / insurance (3)   — abha_links, care_contexts,
--                                 insurance_claims_v2.
--
-- This migration is ADDITIVE ONLY — no existing column is
-- dropped or re-typed, no existing row is rewritten. Backfill
-- happens via `scripts/backfill-default-tenant.ts` (extended
-- in the same PR to cover these 58 tables). A later migration
-- will flip each column to NOT NULL once the backfill has
-- run in all environments.
--
-- Deleting a tenant does NOT cascade to operational data.
-- Rows survive with `tenantId = NULL` so a recovery / merge
-- workflow can re-assign them.
-- ================================================================

-- ─── AdmissionStatus: add DISCHARGED_AGAINST_MEDICAL_ADVICE ─

ALTER TYPE "AdmissionStatus" ADD VALUE 'DISCHARGED_AGAINST_MEDICAL_ADVICE';

-- ─── doctor_schedules ──────────────────────────────────────

ALTER TABLE "doctor_schedules" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "doctor_schedules_tenantId_idx" ON "doctor_schedules"("tenantId");
ALTER TABLE "doctor_schedules"
    ADD CONSTRAINT "doctor_schedules_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── schedule_overrides ────────────────────────────────────

ALTER TABLE "schedule_overrides" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "schedule_overrides_tenantId_idx" ON "schedule_overrides"("tenantId");
ALTER TABLE "schedule_overrides"
    ADD CONSTRAINT "schedule_overrides_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── prescription_templates ────────────────────────────────

ALTER TABLE "prescription_templates" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "prescription_templates_tenantId_idx" ON "prescription_templates"("tenantId");
ALTER TABLE "prescription_templates"
    ADD CONSTRAINT "prescription_templates_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── insurance_claims ──────────────────────────────────────

ALTER TABLE "insurance_claims" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "insurance_claims_tenantId_idx" ON "insurance_claims"("tenantId");
ALTER TABLE "insurance_claims"
    ADD CONSTRAINT "insurance_claims_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── ipd_intake_output ─────────────────────────────────────

ALTER TABLE "ipd_intake_output" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "ipd_intake_output_tenantId_idx" ON "ipd_intake_output"("tenantId");
ALTER TABLE "ipd_intake_output"
    ADD CONSTRAINT "ipd_intake_output_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── inventory_items ───────────────────────────────────────

ALTER TABLE "inventory_items" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "inventory_items_tenantId_idx" ON "inventory_items"("tenantId");
ALTER TABLE "inventory_items"
    ADD CONSTRAINT "inventory_items_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── stock_movements ───────────────────────────────────────

ALTER TABLE "stock_movements" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "stock_movements_tenantId_idx" ON "stock_movements"("tenantId");
ALTER TABLE "stock_movements"
    ADD CONSTRAINT "stock_movements_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── operating_theaters ────────────────────────────────────

ALTER TABLE "operating_theaters" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "operating_theaters_tenantId_idx" ON "operating_theaters"("tenantId");
ALTER TABLE "operating_theaters"
    ADD CONSTRAINT "operating_theaters_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── anesthesia_records ────────────────────────────────────

ALTER TABLE "anesthesia_records" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "anesthesia_records_tenantId_idx" ON "anesthesia_records"("tenantId");
ALTER TABLE "anesthesia_records"
    ADD CONSTRAINT "anesthesia_records_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── post_op_observations ──────────────────────────────────

ALTER TABLE "post_op_observations" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "post_op_observations_tenantId_idx" ON "post_op_observations"("tenantId");
ALTER TABLE "post_op_observations"
    ADD CONSTRAINT "post_op_observations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── suppliers ─────────────────────────────────────────────

ALTER TABLE "suppliers" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "suppliers_tenantId_idx" ON "suppliers"("tenantId");
ALTER TABLE "suppliers"
    ADD CONSTRAINT "suppliers_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── purchase_orders ───────────────────────────────────────

ALTER TABLE "purchase_orders" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "purchase_orders_tenantId_idx" ON "purchase_orders"("tenantId");
ALTER TABLE "purchase_orders"
    ADD CONSTRAINT "purchase_orders_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── expenses ──────────────────────────────────────────────

ALTER TABLE "expenses" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "expenses_tenantId_idx" ON "expenses"("tenantId");
ALTER TABLE "expenses"
    ADD CONSTRAINT "expenses_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── blood_donors ──────────────────────────────────────────

ALTER TABLE "blood_donors" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "blood_donors_tenantId_idx" ON "blood_donors"("tenantId");
ALTER TABLE "blood_donors"
    ADD CONSTRAINT "blood_donors_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── blood_donations ───────────────────────────────────────

ALTER TABLE "blood_donations" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "blood_donations_tenantId_idx" ON "blood_donations"("tenantId");
ALTER TABLE "blood_donations"
    ADD CONSTRAINT "blood_donations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── blood_screenings ──────────────────────────────────────

ALTER TABLE "blood_screenings" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "blood_screenings_tenantId_idx" ON "blood_screenings"("tenantId");
ALTER TABLE "blood_screenings"
    ADD CONSTRAINT "blood_screenings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── blood_temperature_logs ────────────────────────────────

ALTER TABLE "blood_temperature_logs" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "blood_temperature_logs_tenantId_idx" ON "blood_temperature_logs"("tenantId");
ALTER TABLE "blood_temperature_logs"
    ADD CONSTRAINT "blood_temperature_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── blood_cross_matches ───────────────────────────────────

ALTER TABLE "blood_cross_matches" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "blood_cross_matches_tenantId_idx" ON "blood_cross_matches"("tenantId");
ALTER TABLE "blood_cross_matches"
    ADD CONSTRAINT "blood_cross_matches_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── blood_units ───────────────────────────────────────────

ALTER TABLE "blood_units" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "blood_units_tenantId_idx" ON "blood_units"("tenantId");
ALTER TABLE "blood_units"
    ADD CONSTRAINT "blood_units_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── blood_requests ────────────────────────────────────────

ALTER TABLE "blood_requests" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "blood_requests_tenantId_idx" ON "blood_requests"("tenantId");
ALTER TABLE "blood_requests"
    ADD CONSTRAINT "blood_requests_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── ambulances ────────────────────────────────────────────

ALTER TABLE "ambulances" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "ambulances_tenantId_idx" ON "ambulances"("tenantId");
ALTER TABLE "ambulances"
    ADD CONSTRAINT "ambulances_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── ambulance_fuel_logs ───────────────────────────────────

ALTER TABLE "ambulance_fuel_logs" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "ambulance_fuel_logs_tenantId_idx" ON "ambulance_fuel_logs"("tenantId");
ALTER TABLE "ambulance_fuel_logs"
    ADD CONSTRAINT "ambulance_fuel_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── ambulance_trips ───────────────────────────────────────

ALTER TABLE "ambulance_trips" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "ambulance_trips_tenantId_idx" ON "ambulance_trips"("tenantId");
ALTER TABLE "ambulance_trips"
    ADD CONSTRAINT "ambulance_trips_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── assets ────────────────────────────────────────────────

ALTER TABLE "assets" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "assets_tenantId_idx" ON "assets"("tenantId");
ALTER TABLE "assets"
    ADD CONSTRAINT "assets_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── asset_transfers ───────────────────────────────────────

ALTER TABLE "asset_transfers" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "asset_transfers_tenantId_idx" ON "asset_transfers"("tenantId");
ALTER TABLE "asset_transfers"
    ADD CONSTRAINT "asset_transfers_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── asset_assignments ─────────────────────────────────────

ALTER TABLE "asset_assignments" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "asset_assignments_tenantId_idx" ON "asset_assignments"("tenantId");
ALTER TABLE "asset_assignments"
    ADD CONSTRAINT "asset_assignments_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── asset_maintenance ─────────────────────────────────────

ALTER TABLE "asset_maintenance" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "asset_maintenance_tenantId_idx" ON "asset_maintenance"("tenantId");
ALTER TABLE "asset_maintenance"
    ADD CONSTRAINT "asset_maintenance_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── ultrasound_records ────────────────────────────────────

ALTER TABLE "ultrasound_records" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "ultrasound_records_tenantId_idx" ON "ultrasound_records"("tenantId");
ALTER TABLE "ultrasound_records"
    ADD CONSTRAINT "ultrasound_records_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── visitors ──────────────────────────────────────────────

ALTER TABLE "visitors" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "visitors_tenantId_idx" ON "visitors"("tenantId");
ALTER TABLE "visitors"
    ADD CONSTRAINT "visitors_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── credit_notes ──────────────────────────────────────────

ALTER TABLE "credit_notes" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "credit_notes_tenantId_idx" ON "credit_notes"("tenantId");
ALTER TABLE "credit_notes"
    ADD CONSTRAINT "credit_notes_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── advance_payments ──────────────────────────────────────

ALTER TABLE "advance_payments" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "advance_payments_tenantId_idx" ON "advance_payments"("tenantId");
ALTER TABLE "advance_payments"
    ADD CONSTRAINT "advance_payments_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── supplier_payments ─────────────────────────────────────

ALTER TABLE "supplier_payments" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "supplier_payments_tenantId_idx" ON "supplier_payments"("tenantId");
ALTER TABLE "supplier_payments"
    ADD CONSTRAINT "supplier_payments_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── supplier_catalog_items ────────────────────────────────

ALTER TABLE "supplier_catalog_items" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "supplier_catalog_items_tenantId_idx" ON "supplier_catalog_items"("tenantId");
ALTER TABLE "supplier_catalog_items"
    ADD CONSTRAINT "supplier_catalog_items_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── grns ──────────────────────────────────────────────────

ALTER TABLE "grns" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "grns_tenantId_idx" ON "grns"("tenantId");
ALTER TABLE "grns"
    ADD CONSTRAINT "grns_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── visitor_blacklist ─────────────────────────────────────

ALTER TABLE "visitor_blacklist" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "visitor_blacklist_tenantId_idx" ON "visitor_blacklist"("tenantId");
ALTER TABLE "visitor_blacklist"
    ADD CONSTRAINT "visitor_blacklist_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── expense_budgets ───────────────────────────────────────

ALTER TABLE "expense_budgets" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "expense_budgets_tenantId_idx" ON "expense_budgets"("tenantId");
ALTER TABLE "expense_budgets"
    ADD CONSTRAINT "expense_budgets_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── leave_balances ────────────────────────────────────────

ALTER TABLE "leave_balances" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "leave_balances_tenantId_idx" ON "leave_balances"("tenantId");
ALTER TABLE "leave_balances"
    ADD CONSTRAINT "leave_balances_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── notification_templates ────────────────────────────────

ALTER TABLE "notification_templates" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "notification_templates_tenantId_idx" ON "notification_templates"("tenantId");
ALTER TABLE "notification_templates"
    ADD CONSTRAINT "notification_templates_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── notification_schedules ────────────────────────────────

ALTER TABLE "notification_schedules" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "notification_schedules_tenantId_idx" ON "notification_schedules"("tenantId");
ALTER TABLE "notification_schedules"
    ADD CONSTRAINT "notification_schedules_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── notification_broadcasts ───────────────────────────────

ALTER TABLE "notification_broadcasts" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "notification_broadcasts_tenantId_idx" ON "notification_broadcasts"("tenantId");
ALTER TABLE "notification_broadcasts"
    ADD CONSTRAINT "notification_broadcasts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── advance_directives ────────────────────────────────────

ALTER TABLE "advance_directives" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "advance_directives_tenantId_idx" ON "advance_directives"("tenantId");
ALTER TABLE "advance_directives"
    ADD CONSTRAINT "advance_directives_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── patient_belongings ────────────────────────────────────

ALTER TABLE "patient_belongings" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "patient_belongings_tenantId_idx" ON "patient_belongings"("tenantId");
ALTER TABLE "patient_belongings"
    ADD CONSTRAINT "patient_belongings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── discount_approvals ────────────────────────────────────

ALTER TABLE "discount_approvals" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "discount_approvals_tenantId_idx" ON "discount_approvals"("tenantId");
ALTER TABLE "discount_approvals"
    ADD CONSTRAINT "discount_approvals_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── pharmacy_returns ──────────────────────────────────────

ALTER TABLE "pharmacy_returns" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "pharmacy_returns_tenantId_idx" ON "pharmacy_returns"("tenantId");
ALTER TABLE "pharmacy_returns"
    ADD CONSTRAINT "pharmacy_returns_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── stock_transfers ───────────────────────────────────────

ALTER TABLE "stock_transfers" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "stock_transfers_tenantId_idx" ON "stock_transfers"("tenantId");
ALTER TABLE "stock_transfers"
    ADD CONSTRAINT "stock_transfers_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── controlled_substance_register ─────────────────────────

ALTER TABLE "controlled_substance_register" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "controlled_substance_register_tenantId_idx" ON "controlled_substance_register"("tenantId");
ALTER TABLE "controlled_substance_register"
    ADD CONSTRAINT "controlled_substance_register_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── lab_qc_entries ────────────────────────────────────────

ALTER TABLE "lab_qc_entries" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "lab_qc_entries_tenantId_idx" ON "lab_qc_entries"("tenantId");
ALTER TABLE "lab_qc_entries"
    ADD CONSTRAINT "lab_qc_entries_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── shared_links ──────────────────────────────────────────

ALTER TABLE "shared_links" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "shared_links_tenantId_idx" ON "shared_links"("tenantId");
ALTER TABLE "shared_links"
    ADD CONSTRAINT "shared_links_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── partographs ───────────────────────────────────────────

ALTER TABLE "partographs" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "partographs_tenantId_idx" ON "partographs"("tenantId");
ALTER TABLE "partographs"
    ADD CONSTRAINT "partographs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── postnatal_visits ──────────────────────────────────────

ALTER TABLE "postnatal_visits" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "postnatal_visits_tenantId_idx" ON "postnatal_visits"("tenantId");
ALTER TABLE "postnatal_visits"
    ADD CONSTRAINT "postnatal_visits_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── milestone_records ─────────────────────────────────────

ALTER TABLE "milestone_records" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "milestone_records_tenantId_idx" ON "milestone_records"("tenantId");
ALTER TABLE "milestone_records"
    ADD CONSTRAINT "milestone_records_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── feeding_logs ──────────────────────────────────────────

ALTER TABLE "feeding_logs" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "feeding_logs_tenantId_idx" ON "feeding_logs"("tenantId");
ALTER TABLE "feeding_logs"
    ADD CONSTRAINT "feeding_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── donor_deferrals ───────────────────────────────────────

ALTER TABLE "donor_deferrals" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "donor_deferrals_tenantId_idx" ON "donor_deferrals"("tenantId");
ALTER TABLE "donor_deferrals"
    ADD CONSTRAINT "donor_deferrals_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── component_separations ─────────────────────────────────

ALTER TABLE "component_separations" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "component_separations_tenantId_idx" ON "component_separations"("tenantId");
ALTER TABLE "component_separations"
    ADD CONSTRAINT "component_separations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── adherence_dose_logs ───────────────────────────────────

ALTER TABLE "adherence_dose_logs" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "adherence_dose_logs_tenantId_idx" ON "adherence_dose_logs"("tenantId");
ALTER TABLE "adherence_dose_logs"
    ADD CONSTRAINT "adherence_dose_logs_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── abha_links ────────────────────────────────────────────

ALTER TABLE "abha_links" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "abha_links_tenantId_idx" ON "abha_links"("tenantId");
ALTER TABLE "abha_links"
    ADD CONSTRAINT "abha_links_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── care_contexts ─────────────────────────────────────────

ALTER TABLE "care_contexts" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "care_contexts_tenantId_idx" ON "care_contexts"("tenantId");
ALTER TABLE "care_contexts"
    ADD CONSTRAINT "care_contexts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── insurance_claims_v2 ───────────────────────────────────

ALTER TABLE "insurance_claims_v2" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "insurance_claims_v2_tenantId_idx" ON "insurance_claims_v2"("tenantId");
ALTER TABLE "insurance_claims_v2"
    ADD CONSTRAINT "insurance_claims_v2_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
