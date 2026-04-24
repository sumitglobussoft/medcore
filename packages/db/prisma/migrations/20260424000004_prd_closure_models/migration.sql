-- Migration: PRD Closure Models (2026-04-24)
-- Additive-only. Adds 4 tables + 2 enums + extends PatientFeedback and
-- AIScribeSession with AI-KPI plumbing. Back-compat: every new column is
-- nullable / defaulted, every FK is SetNull or Cascade as appropriate.
--
-- Closes:
--   PRD §3.5.4 / §3.7.1   snomed_concepts
--   PRD §3.9              front_desk_calls, patient_feedback.appointmentId
--   PRD §4.9              ai_scribe_sessions.doctorNps, medication_incidents
--   PRD §7 / DPDP         patient_data_exports

-- ── 1. Enums ─────────────────────────────────────────────────────────────
CREATE TYPE "PatientDataExportStatus" AS ENUM (
  'QUEUED', 'PROCESSING', 'READY', 'FAILED'
);

CREATE TYPE "PatientDataExportFormat" AS ENUM (
  'JSON', 'FHIR', 'PDF'
);

-- ── 2. patient_data_exports ──────────────────────────────────────────────
CREATE TABLE "patient_data_exports" (
  "id"           TEXT NOT NULL,
  "patientId"    TEXT NOT NULL,
  "format"       "PatientDataExportFormat" NOT NULL,
  "status"       "PatientDataExportStatus" NOT NULL DEFAULT 'QUEUED',
  "filePath"     TEXT,
  "fileSize"     INTEGER,
  "errorMessage" TEXT,
  "requestedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt"    TIMESTAMP(3),
  "readyAt"      TIMESTAMP(3),
  "downloadedAt" TIMESTAMP(3),
  "tenantId"     TEXT,
  CONSTRAINT "patient_data_exports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "patient_data_exports_patientId_requestedAt_idx"
  ON "patient_data_exports"("patientId", "requestedAt");
CREATE INDEX "patient_data_exports_status_idx" ON "patient_data_exports"("status");
CREATE INDEX "patient_data_exports_tenantId_idx" ON "patient_data_exports"("tenantId");

ALTER TABLE "patient_data_exports"
  ADD CONSTRAINT "patient_data_exports_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "patient_data_exports"
  ADD CONSTRAINT "patient_data_exports_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. snomed_concepts ───────────────────────────────────────────────────
CREATE TABLE "snomed_concepts" (
  "id"            TEXT NOT NULL,
  "term"          TEXT NOT NULL,
  "synonyms"      JSONB NOT NULL,
  "specialtyTags" JSONB NOT NULL,
  "redFlagTerms"  JSONB NOT NULL,
  "category"      TEXT NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "snomed_concepts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "snomed_concepts_category_idx" ON "snomed_concepts"("category");
CREATE INDEX "snomed_concepts_term_idx" ON "snomed_concepts"("term");

-- ── 4. front_desk_calls ──────────────────────────────────────────────────
CREATE TABLE "front_desk_calls" (
  "id"          TEXT NOT NULL,
  "calledAt"    TIMESTAMP(3) NOT NULL,
  "durationSec" INTEGER NOT NULL,
  "fromPhone"   TEXT NOT NULL,
  "toPhone"     TEXT,
  "category"    TEXT,
  "disposition" TEXT,
  "providerId"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "tenantId"    TEXT,
  CONSTRAINT "front_desk_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "front_desk_calls_tenantId_idx" ON "front_desk_calls"("tenantId");
CREATE INDEX "front_desk_calls_calledAt_idx" ON "front_desk_calls"("calledAt");
CREATE INDEX "front_desk_calls_category_idx" ON "front_desk_calls"("category");

ALTER TABLE "front_desk_calls"
  ADD CONSTRAINT "front_desk_calls_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 5. medication_incidents ──────────────────────────────────────────────
CREATE TABLE "medication_incidents" (
  "id"               TEXT NOT NULL,
  "patientId"        TEXT NOT NULL,
  "prescriptionId"   TEXT,
  "reportedByUserId" TEXT NOT NULL,
  "reportedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "severity"         TEXT NOT NULL,
  "scribeSessionId"  TEXT,
  "narrative"        TEXT NOT NULL,
  "resolvedAt"       TIMESTAMP(3),
  "tenantId"         TEXT,
  CONSTRAINT "medication_incidents_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "medication_incidents_tenantId_idx" ON "medication_incidents"("tenantId");
CREATE INDEX "medication_incidents_reportedAt_idx" ON "medication_incidents"("reportedAt");
CREATE INDEX "medication_incidents_scribeSessionId_idx" ON "medication_incidents"("scribeSessionId");
CREATE INDEX "medication_incidents_patientId_idx" ON "medication_incidents"("patientId");

ALTER TABLE "medication_incidents"
  ADD CONSTRAINT "medication_incidents_patientId_fkey"
  FOREIGN KEY ("patientId") REFERENCES "patients"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "medication_incidents"
  ADD CONSTRAINT "medication_incidents_prescriptionId_fkey"
  FOREIGN KEY ("prescriptionId") REFERENCES "prescriptions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "medication_incidents"
  ADD CONSTRAINT "medication_incidents_reportedByUserId_fkey"
  FOREIGN KEY ("reportedByUserId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "medication_incidents"
  ADD CONSTRAINT "medication_incidents_scribeSessionId_fkey"
  FOREIGN KEY ("scribeSessionId") REFERENCES "ai_scribe_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "medication_incidents"
  ADD CONSTRAINT "medication_incidents_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 6. patient_feedback: add appointmentId + index + FK ──────────────────
ALTER TABLE "patient_feedback"
  ADD COLUMN "appointmentId" TEXT;

CREATE INDEX "patient_feedback_appointmentId_idx"
  ON "patient_feedback"("appointmentId");

ALTER TABLE "patient_feedback"
  ADD CONSTRAINT "patient_feedback_appointmentId_fkey"
  FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 7. ai_scribe_sessions: add doctor-NPS fields ─────────────────────────
ALTER TABLE "ai_scribe_sessions"
  ADD COLUMN "doctorNps"           INTEGER,
  ADD COLUMN "doctorRatedAt"       TIMESTAMP(3),
  ADD COLUMN "doctorRatingComment" TEXT;
