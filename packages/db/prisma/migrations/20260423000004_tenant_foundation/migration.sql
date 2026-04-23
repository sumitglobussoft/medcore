-- ================================================================
-- 20260423000004_tenant_foundation
--
-- Step 1 of the multi-tenant rollout (see
-- `apps/api/src/services/.prisma-models-tenant.md`):
--
--   * Introduce the `tenants` table and `TenantPlan` enum.
--   * Add a NULLABLE `tenantId` column + index + FK (ON DELETE SET
--     NULL) to the 20 top-level tenant-scoped tables.
--
-- This migration is ADDITIVE ONLY. No existing columns are dropped
-- or re-typed, no existing row is rewritten. A follow-up migration
-- will backfill `tenantId` from `scripts/backfill-default-tenant.ts`
-- and a later one will flip the column to NOT NULL.
--
-- Deleting a tenant does NOT cascade to operational data (patients,
-- appointments, invoices, …). Those rows survive with `tenantId =
-- NULL` so a recovery / merge workflow can re-assign them.
-- ================================================================

-- ─── Enum + table ────────────────────────────────────────────────

CREATE TYPE "TenantPlan" AS ENUM ('BASIC', 'PRO', 'ENTERPRISE');

CREATE TABLE "tenants" (
    "id"        TEXT NOT NULL,
    "name"      TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "plan"      "TenantPlan" NOT NULL DEFAULT 'BASIC',
    "active"    BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_subdomain_key" ON "tenants"("subdomain");

-- ─── users ───────────────────────────────────────────────────────

ALTER TABLE "users" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");
ALTER TABLE "users"
    ADD CONSTRAINT "users_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── doctors ─────────────────────────────────────────────────────

ALTER TABLE "doctors" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "doctors_tenantId_idx" ON "doctors"("tenantId");
ALTER TABLE "doctors"
    ADD CONSTRAINT "doctors_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── patients ────────────────────────────────────────────────────

ALTER TABLE "patients" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "patients_tenantId_idx" ON "patients"("tenantId");
ALTER TABLE "patients"
    ADD CONSTRAINT "patients_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── appointments ────────────────────────────────────────────────

ALTER TABLE "appointments" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "appointments_tenantId_idx" ON "appointments"("tenantId");
ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── consultations ───────────────────────────────────────────────

ALTER TABLE "consultations" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "consultations_tenantId_idx" ON "consultations"("tenantId");
ALTER TABLE "consultations"
    ADD CONSTRAINT "consultations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── prescriptions ───────────────────────────────────────────────

ALTER TABLE "prescriptions" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "prescriptions_tenantId_idx" ON "prescriptions"("tenantId");
ALTER TABLE "prescriptions"
    ADD CONSTRAINT "prescriptions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── invoices ────────────────────────────────────────────────────

ALTER TABLE "invoices" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "invoices_tenantId_idx" ON "invoices"("tenantId");
ALTER TABLE "invoices"
    ADD CONSTRAINT "invoices_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── payments ────────────────────────────────────────────────────

ALTER TABLE "payments" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "payments_tenantId_idx" ON "payments"("tenantId");
ALTER TABLE "payments"
    ADD CONSTRAINT "payments_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── lab_orders ──────────────────────────────────────────────────

ALTER TABLE "lab_orders" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "lab_orders_tenantId_idx" ON "lab_orders"("tenantId");
ALTER TABLE "lab_orders"
    ADD CONSTRAINT "lab_orders_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── lab_results ─────────────────────────────────────────────────

ALTER TABLE "lab_results" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "lab_results_tenantId_idx" ON "lab_results"("tenantId");
ALTER TABLE "lab_results"
    ADD CONSTRAINT "lab_results_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── admissions ──────────────────────────────────────────────────

ALTER TABLE "admissions" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "admissions_tenantId_idx" ON "admissions"("tenantId");
ALTER TABLE "admissions"
    ADD CONSTRAINT "admissions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── medication_orders ───────────────────────────────────────────

ALTER TABLE "medication_orders" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "medication_orders_tenantId_idx" ON "medication_orders"("tenantId");
ALTER TABLE "medication_orders"
    ADD CONSTRAINT "medication_orders_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── nurse_rounds ────────────────────────────────────────────────

ALTER TABLE "nurse_rounds" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "nurse_rounds_tenantId_idx" ON "nurse_rounds"("tenantId");
ALTER TABLE "nurse_rounds"
    ADD CONSTRAINT "nurse_rounds_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── referrals ───────────────────────────────────────────────────

ALTER TABLE "referrals" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "referrals_tenantId_idx" ON "referrals"("tenantId");
ALTER TABLE "referrals"
    ADD CONSTRAINT "referrals_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── surgeries ───────────────────────────────────────────────────

ALTER TABLE "surgeries" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "surgeries_tenantId_idx" ON "surgeries"("tenantId");
ALTER TABLE "surgeries"
    ADD CONSTRAINT "surgeries_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── staff_shifts ────────────────────────────────────────────────

ALTER TABLE "staff_shifts" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "staff_shifts_tenantId_idx" ON "staff_shifts"("tenantId");
ALTER TABLE "staff_shifts"
    ADD CONSTRAINT "staff_shifts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── leave_requests ──────────────────────────────────────────────

ALTER TABLE "leave_requests" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "leave_requests_tenantId_idx" ON "leave_requests"("tenantId");
ALTER TABLE "leave_requests"
    ADD CONSTRAINT "leave_requests_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── telemedicine_sessions ───────────────────────────────────────

ALTER TABLE "telemedicine_sessions" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "telemedicine_sessions_tenantId_idx" ON "telemedicine_sessions"("tenantId");
ALTER TABLE "telemedicine_sessions"
    ADD CONSTRAINT "telemedicine_sessions_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── emergency_cases ─────────────────────────────────────────────

ALTER TABLE "emergency_cases" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "emergency_cases_tenantId_idx" ON "emergency_cases"("tenantId");
ALTER TABLE "emergency_cases"
    ADD CONSTRAINT "emergency_cases_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── notifications ───────────────────────────────────────────────

ALTER TABLE "notifications" ADD COLUMN "tenantId" TEXT;
CREATE INDEX "notifications_tenantId_idx" ON "notifications"("tenantId");
ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
