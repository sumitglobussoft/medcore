-- Migration: partial unique index on active admissions + per-line GST snapshot
-- Additive-only. Safe to apply via `prisma migrate deploy`.
--
-- Prerequisite for the admissions index: duplicate ACTIVE admissions must be
-- collapsed first. `scripts/dedup-active-admissions.ts --apply` was run in
-- prod on 2026-04-24 (duplicatesRemaining=0 verified in the summary JSON).
-- Running this migration against a DB that still has duplicates would fail
-- with a unique-violation.

-- ---------------------------------------------------------------------------
-- 1. Partial unique index on admissions(patientId) WHERE status = 'ADMITTED'
--    (Prisma schema can't express partial unique indexes natively, so this is
--    hand-written SQL. The constraint is enforced by Postgres directly.)
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS "one_active_admission_per_patient"
  ON "admissions" ("patientId")
  WHERE "status" = 'ADMITTED';

-- ---------------------------------------------------------------------------
-- 2. Per-line GST snapshot on InvoiceItem (issue #43 follow-up)
--    Historical invoices retain the tax presented to the patient even if
--    rates change. Computed + persisted on line-item create going forward.
-- ---------------------------------------------------------------------------

ALTER TABLE "invoice_items"
  ADD COLUMN IF NOT EXISTS "cgst"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "sgst"    DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "hsnSac"  TEXT;
