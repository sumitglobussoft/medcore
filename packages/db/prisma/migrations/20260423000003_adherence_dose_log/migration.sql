-- Migration: adherence_dose_log
-- Adds the `adherence_dose_logs` table that persists per-dose events for the
-- medication-adherence feature. The mobile app writes one row each time a
-- patient marks a reminder chip as taken (or skipped), and reads the last N
-- days to hydrate the UI on focus.
--
-- This migration is ADDITIVE ONLY — no existing columns/tables are dropped
-- or renamed. Safe to run against production data.

-- ─── CreateTable: adherence_dose_logs ───────────────────
CREATE TABLE "adherence_dose_logs" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "medicationName" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "takenAt" TIMESTAMP(3),
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "adherence_dose_logs_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ────────────────────────────────────────────
CREATE INDEX "adherence_dose_logs_scheduleId_idx" ON "adherence_dose_logs"("scheduleId");
CREATE INDEX "adherence_dose_logs_patientId_idx" ON "adherence_dose_logs"("patientId");
CREATE INDEX "adherence_dose_logs_patientId_scheduledAt_idx" ON "adherence_dose_logs"("patientId", "scheduledAt");

-- ─── Foreign Keys ───────────────────────────────────────
ALTER TABLE "adherence_dose_logs"
    ADD CONSTRAINT "adherence_dose_logs_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "adherence_schedules"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "adherence_dose_logs"
    ADD CONSTRAINT "adherence_dose_logs_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
