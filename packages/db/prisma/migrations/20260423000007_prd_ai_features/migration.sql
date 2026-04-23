-- ================================================================
-- 20260423000007_prd_ai_features
--
-- Hand-crafted migration for the 12 new PRD-AI models + 8 new enums
-- that were merged into `packages/db/prisma/schema.prisma` from the
-- proposal files (patient-tools, ops-forecast, ops-quality, ai-claims).
-- These models were committed to the schema without an accompanying
-- migration, so `prisma migrate deploy` against prod would otherwise
-- skip them entirely.
--
-- Tables introduced (all tenant-scoped):
--   * bill_explanations          — patient-facing bill narrative
--   * previsit_checklists        — pre-appointment AI checklist
--   * symptom_diary_entries      — daily symptom log + AI analysis
--   * chronic_care_plans         — long-term care tracks
--   * chronic_care_checkins      — periodic check-ins per plan
--   * chronic_care_alerts        — threshold-breach alerts per plan
--   * staff_roster_proposals     — AI-proposed staff rosters
--   * fraud_alerts               — billing / prescribing anomalies
--   * doc_qa_reports             — consultation quality scores
--   * feedback_sentiment         — per-feedback NLP classification
--   * nps_daily_rollup           — daily aggregated NPS/themes
--   * claim_denial_history       — denial-pattern memory for AI
--
-- Also extends the existing `NotificationType` enum with four new
-- values for the patient-tools event hooks.
--
-- This migration is ADDITIVE ONLY — no DROP / no RENAME / no column
-- re-type on any existing table. Enum ADD VALUE is the only
-- mutation of pre-existing schema objects, and Postgres treats that
-- as a safe, non-locking operation (v12+).
--
-- tenantId pattern matches `20260423000005_tenant_scope_extended`:
-- every new table carries a nullable `tenantId` TEXT column with its
-- own index and `ON DELETE SET NULL ON UPDATE CASCADE` FK into
-- `tenants(id)`. Deleting a tenant leaves AI artefacts recoverable.
-- ================================================================

-- ════════════════════════════════════════════════════════════════
-- 1. NEW ENUMS
-- ════════════════════════════════════════════════════════════════

-- ─── CreateEnum: BillExplanationStatus ───────────────────────────
CREATE TYPE "BillExplanationStatus" AS ENUM ('DRAFT', 'APPROVED', 'SENT');

-- ─── CreateEnum: ChronicConditionCode ────────────────────────────
-- (named `...Code` to avoid colliding with the existing
-- `ChronicCondition` free-text MODEL in the schema)
CREATE TYPE "ChronicConditionCode" AS ENUM ('DIABETES', 'HYPERTENSION', 'ASTHMA', 'TB', 'OTHER');

-- ─── CreateEnum: ChronicCareAlertSeverity ────────────────────────
CREATE TYPE "ChronicCareAlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- ─── CreateEnum: RosterProposalStatus ────────────────────────────
CREATE TYPE "RosterProposalStatus" AS ENUM ('PROPOSED', 'APPLIED', 'REJECTED');

-- ─── CreateEnum: FraudAlertType ──────────────────────────────────
CREATE TYPE "FraudAlertType" AS ENUM (
    'DUPLICATE_CHARGE',
    'PRESCRIPTION_OUTLIER',
    'HIGH_FREQUENCY_PATIENT',
    'LARGE_REFUND',
    'LARGE_DISCOUNT',
    'GENERIC_TO_BRAND_UPSELL',
    'OTHER'
);

-- ─── CreateEnum: FraudAlertSeverity ──────────────────────────────
CREATE TYPE "FraudAlertSeverity" AS ENUM ('INFO', 'SUSPICIOUS', 'HIGH_RISK');

-- ─── CreateEnum: FraudAlertStatus ────────────────────────────────
CREATE TYPE "FraudAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'DISMISSED', 'ESCALATED');

-- ─── CreateEnum: SentimentBucket ─────────────────────────────────
-- (lower-case members — matches the schema's `positive|neutral|negative`)
CREATE TYPE "SentimentBucket" AS ENUM ('positive', 'neutral', 'negative');

-- ════════════════════════════════════════════════════════════════
-- 2. EXTEND EXISTING ENUM: NotificationType
-- ════════════════════════════════════════════════════════════════
-- Four new values for patient-tools event hooks. Postgres 12+ treats
-- `ALTER TYPE ... ADD VALUE` as non-transactional, non-locking.
-- These values are purely additive — existing rows are untouched.

ALTER TYPE "NotificationType" ADD VALUE 'BILL_EXPLANATION_READY';
ALTER TYPE "NotificationType" ADD VALUE 'PREVISIT_CHECKLIST_READY';
ALTER TYPE "NotificationType" ADD VALUE 'CHRONIC_CARE_CHECKIN';
ALTER TYPE "NotificationType" ADD VALUE 'CHRONIC_CARE_ALERT';

-- ════════════════════════════════════════════════════════════════
-- 3. PATIENT-FACING AI TOOLS
-- ════════════════════════════════════════════════════════════════

-- ─── CreateTable: bill_explanations ──────────────────────────────
CREATE TABLE "bill_explanations" (
    "id"           TEXT                    NOT NULL,
    "invoiceId"    TEXT                    NOT NULL,
    "patientId"    TEXT                    NOT NULL,
    "language"     TEXT                    NOT NULL DEFAULT 'en',
    "content"      TEXT                    NOT NULL,
    "status"       "BillExplanationStatus" NOT NULL DEFAULT 'DRAFT',
    "flaggedItems" JSONB                   NOT NULL DEFAULT '[]',
    "approvedBy"   TEXT,
    "approvedAt"   TIMESTAMP(3),
    "sentAt"       TIMESTAMP(3),
    "createdAt"    TIMESTAMP(3)            NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3)            NOT NULL,
    "tenantId"     TEXT,

    CONSTRAINT "bill_explanations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bill_explanations_invoiceId_key" ON "bill_explanations"("invoiceId");
CREATE INDEX "bill_explanations_patientId_idx" ON "bill_explanations"("patientId");
CREATE INDEX "bill_explanations_status_idx" ON "bill_explanations"("status");
CREATE INDEX "bill_explanations_tenantId_idx" ON "bill_explanations"("tenantId");

-- ─── CreateTable: previsit_checklists ────────────────────────────
CREATE TABLE "previsit_checklists" (
    "id"            TEXT         NOT NULL,
    "appointmentId" TEXT         NOT NULL,
    "patientId"     TEXT         NOT NULL,
    "items"         JSONB        NOT NULL DEFAULT '[]',
    "generatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    "tenantId"      TEXT,

    CONSTRAINT "previsit_checklists_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "previsit_checklists_appointmentId_key" ON "previsit_checklists"("appointmentId");
CREATE INDEX "previsit_checklists_patientId_idx" ON "previsit_checklists"("patientId");
CREATE INDEX "previsit_checklists_tenantId_idx" ON "previsit_checklists"("tenantId");

-- ─── CreateTable: symptom_diary_entries ──────────────────────────
CREATE TABLE "symptom_diary_entries" (
    "id"             TEXT         NOT NULL,
    "patientId"      TEXT         NOT NULL,
    "symptomDate"    DATE         NOT NULL,
    "entries"        JSONB        NOT NULL DEFAULT '[]',
    "lastAnalysis"   JSONB,
    "lastAnalysisAt" TIMESTAMP(3),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL,
    "tenantId"       TEXT,

    CONSTRAINT "symptom_diary_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "symptom_diary_entries_patientId_symptomDate_key"
    ON "symptom_diary_entries"("patientId", "symptomDate");
CREATE INDEX "symptom_diary_entries_patientId_symptomDate_idx"
    ON "symptom_diary_entries"("patientId", "symptomDate");
CREATE INDEX "symptom_diary_entries_tenantId_idx" ON "symptom_diary_entries"("tenantId");

-- ─── CreateTable: chronic_care_plans ─────────────────────────────
CREATE TABLE "chronic_care_plans" (
    "id"                   TEXT                   NOT NULL,
    "patientId"            TEXT                   NOT NULL,
    "condition"            "ChronicConditionCode" NOT NULL,
    "checkInFrequencyDays" INTEGER                NOT NULL DEFAULT 7,
    "thresholds"           JSONB                  NOT NULL DEFAULT '{}',
    "active"               BOOLEAN                NOT NULL DEFAULT true,
    "createdBy"            TEXT                   NOT NULL,
    "createdAt"            TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"            TIMESTAMP(3)           NOT NULL,
    "tenantId"             TEXT,

    CONSTRAINT "chronic_care_plans_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chronic_care_plans_patientId_active_idx" ON "chronic_care_plans"("patientId", "active");
CREATE INDEX "chronic_care_plans_tenantId_idx" ON "chronic_care_plans"("tenantId");

-- ─── CreateTable: chronic_care_checkins ──────────────────────────
CREATE TABLE "chronic_care_checkins" (
    "id"                 TEXT         NOT NULL,
    "planId"             TEXT         NOT NULL,
    "patientId"          TEXT         NOT NULL,
    "loggedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responses"          JSONB        NOT NULL DEFAULT '{}',
    "thresholdsBreached" JSONB,
    "tenantId"           TEXT,

    CONSTRAINT "chronic_care_checkins_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chronic_care_checkins_planId_loggedAt_idx" ON "chronic_care_checkins"("planId", "loggedAt");
CREATE INDEX "chronic_care_checkins_patientId_loggedAt_idx" ON "chronic_care_checkins"("patientId", "loggedAt");
CREATE INDEX "chronic_care_checkins_tenantId_idx" ON "chronic_care_checkins"("tenantId");

-- ─── CreateTable: chronic_care_alerts ────────────────────────────
CREATE TABLE "chronic_care_alerts" (
    "id"             TEXT                       NOT NULL,
    "planId"         TEXT                       NOT NULL,
    "patientId"      TEXT                       NOT NULL,
    "severity"       "ChronicCareAlertSeverity" NOT NULL DEFAULT 'MEDIUM',
    "reason"         TEXT                       NOT NULL,
    "createdAt"      TIMESTAMP(3)               NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "tenantId"       TEXT,

    CONSTRAINT "chronic_care_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "chronic_care_alerts_planId_createdAt_idx" ON "chronic_care_alerts"("planId", "createdAt");
CREATE INDEX "chronic_care_alerts_patientId_acknowledgedAt_idx"
    ON "chronic_care_alerts"("patientId", "acknowledgedAt");
CREATE INDEX "chronic_care_alerts_tenantId_idx" ON "chronic_care_alerts"("tenantId");

-- ════════════════════════════════════════════════════════════════
-- 4. STAFF ROSTER PROPOSALS
-- ════════════════════════════════════════════════════════════════

-- ─── CreateTable: staff_roster_proposals ─────────────────────────
CREATE TABLE "staff_roster_proposals" (
    "id"         TEXT                   NOT NULL,
    "status"     "RosterProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "startDate"  DATE                   NOT NULL,
    "days"       INTEGER                NOT NULL,
    "department" TEXT                   NOT NULL,
    "proposal"   JSONB                  NOT NULL,
    "warnings"   JSONB                  NOT NULL,
    "createdBy"  TEXT                   NOT NULL,
    "createdAt"  TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt"  TIMESTAMP(3),
    "appliedBy"  TEXT,
    "tenantId"   TEXT,

    CONSTRAINT "staff_roster_proposals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_roster_proposals_status_idx" ON "staff_roster_proposals"("status");
CREATE INDEX "staff_roster_proposals_createdAt_idx" ON "staff_roster_proposals"("createdAt");
CREATE INDEX "staff_roster_proposals_department_startDate_idx"
    ON "staff_roster_proposals"("department", "startDate");
CREATE INDEX "staff_roster_proposals_tenantId_idx" ON "staff_roster_proposals"("tenantId");

-- ════════════════════════════════════════════════════════════════
-- 5. OPS QUALITY
-- ════════════════════════════════════════════════════════════════

-- ─── CreateTable: fraud_alerts ───────────────────────────────────
CREATE TABLE "fraud_alerts" (
    "id"             TEXT                 NOT NULL,
    "type"           "FraudAlertType"     NOT NULL,
    "severity"       "FraudAlertSeverity" NOT NULL DEFAULT 'SUSPICIOUS',
    "status"         "FraudAlertStatus"   NOT NULL DEFAULT 'OPEN',
    "entityType"     TEXT                 NOT NULL,
    "entityId"       TEXT                 NOT NULL,
    "description"    TEXT                 NOT NULL,
    "evidence"       JSONB                NOT NULL,
    "detectedAt"     TIMESTAMP(3)         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "tenantId"       TEXT,

    CONSTRAINT "fraud_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "fraud_alerts_status_severity_idx" ON "fraud_alerts"("status", "severity");
CREATE INDEX "fraud_alerts_type_idx" ON "fraud_alerts"("type");
CREATE INDEX "fraud_alerts_entityType_entityId_idx" ON "fraud_alerts"("entityType", "entityId");
CREATE INDEX "fraud_alerts_detectedAt_idx" ON "fraud_alerts"("detectedAt");
CREATE INDEX "fraud_alerts_tenantId_idx" ON "fraud_alerts"("tenantId");

-- ─── CreateTable: doc_qa_reports ─────────────────────────────────
-- PK is `consultationId` (1:1 with consultations). `auditedBy` is a
-- plain TEXT column with default 'SYSTEM'; no FK to users — the
-- schema does not declare one (it's written as a free-text marker so
-- automated audits can tag themselves without an auth identity).
CREATE TABLE "doc_qa_reports" (
    "consultationId"    TEXT         NOT NULL,
    "score"             INTEGER      NOT NULL,
    "issues"            JSONB        NOT NULL,
    "recommendations"   JSONB        NOT NULL,
    "auditedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "auditedBy"         TEXT         NOT NULL DEFAULT 'SYSTEM',
    "completenessScore" INTEGER,
    "icdAccuracyScore"  INTEGER,
    "medicationScore"   INTEGER,
    "clarityScore"      INTEGER,
    "tenantId"          TEXT,

    CONSTRAINT "doc_qa_reports_pkey" PRIMARY KEY ("consultationId")
);

CREATE INDEX "doc_qa_reports_auditedAt_idx" ON "doc_qa_reports"("auditedAt");
CREATE INDEX "doc_qa_reports_score_idx" ON "doc_qa_reports"("score");
CREATE INDEX "doc_qa_reports_tenantId_idx" ON "doc_qa_reports"("tenantId");

-- ─── CreateTable: feedback_sentiment ─────────────────────────────
-- PK is `feedbackId` (1:1 with patient_feedback).
CREATE TABLE "feedback_sentiment" (
    "feedbackId"      TEXT              NOT NULL,
    "sentiment"       "SentimentBucket" NOT NULL,
    "emotions"        JSONB             NOT NULL,
    "themes"          JSONB             NOT NULL,
    "actionableItems" JSONB             NOT NULL,
    "analyzedAt"      TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId"        TEXT,

    CONSTRAINT "feedback_sentiment_pkey" PRIMARY KEY ("feedbackId")
);

CREATE INDEX "feedback_sentiment_sentiment_idx" ON "feedback_sentiment"("sentiment");
CREATE INDEX "feedback_sentiment_analyzedAt_idx" ON "feedback_sentiment"("analyzedAt");
CREATE INDEX "feedback_sentiment_tenantId_idx" ON "feedback_sentiment"("tenantId");

-- ─── CreateTable: nps_daily_rollup ───────────────────────────────
-- PK is `date` (DATE column used as natural key — one row per day).
-- No foreign keys other than tenantId; rollups are pure aggregates.
CREATE TABLE "nps_daily_rollup" (
    "date"               DATE         NOT NULL,
    "windowDays"         INTEGER      NOT NULL DEFAULT 30,
    "positiveThemes"     JSONB        NOT NULL,
    "negativeThemes"     JSONB        NOT NULL,
    "actionableInsights" JSONB        NOT NULL,
    "totalFeedback"      INTEGER      NOT NULL,
    "generatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId"           TEXT,

    CONSTRAINT "nps_daily_rollup_pkey" PRIMARY KEY ("date")
);

CREATE INDEX "nps_daily_rollup_tenantId_idx" ON "nps_daily_rollup"("tenantId");

-- ════════════════════════════════════════════════════════════════
-- 6. AI CLAIMS
-- ════════════════════════════════════════════════════════════════

-- ─── CreateTable: claim_denial_history ───────────────────────────
-- NOTE: the schema models this as a denial-pattern MEMORY table keyed
-- by (tpaProvider, icd10Code, procedureCode) rather than a per-claim
-- row. It intentionally carries NO foreign key to `insurance_claims_v2`
-- — the table is an aggregated pattern learner, not a claim log.
CREATE TABLE "claim_denial_history" (
    "id"            TEXT          NOT NULL,
    "tpaProvider"   "TpaProvider" NOT NULL,
    "icd10Code"     TEXT,
    "procedureCode" TEXT,
    "denialReason"  TEXT          NOT NULL,
    "denialCount"   INTEGER       NOT NULL DEFAULT 1,
    "firstSeenAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tenantId"      TEXT,

    CONSTRAINT "claim_denial_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "claim_denial_history_tpaProvider_icd10Code_idx"
    ON "claim_denial_history"("tpaProvider", "icd10Code");
CREATE INDEX "claim_denial_history_tenantId_idx" ON "claim_denial_history"("tenantId");

-- ════════════════════════════════════════════════════════════════
-- 7. FOREIGN KEYS
-- ════════════════════════════════════════════════════════════════
--
-- Action policy follows Prisma's default mapping:
--   * Required relation, no explicit onDelete  → ON DELETE RESTRICT
--   * Optional relation, no explicit onDelete  → ON DELETE SET NULL
--   * Prisma `onDelete: Cascade`               → ON DELETE CASCADE
--   * Prisma `onDelete: SetNull`               → ON DELETE SET NULL
-- `ON UPDATE CASCADE` on every FK matches the repo-wide convention.
--
-- Every new model carries `tenantId → tenants(id) ON DELETE SET NULL`
-- (matches `20260423000005_tenant_scope_extended`).

-- ─── bill_explanations ───────────────────────────────────────────
ALTER TABLE "bill_explanations"
    ADD CONSTRAINT "bill_explanations_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bill_explanations"
    ADD CONSTRAINT "bill_explanations_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "bill_explanations"
    ADD CONSTRAINT "bill_explanations_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── previsit_checklists ─────────────────────────────────────────
ALTER TABLE "previsit_checklists"
    ADD CONSTRAINT "previsit_checklists_appointmentId_fkey"
    FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "previsit_checklists"
    ADD CONSTRAINT "previsit_checklists_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "previsit_checklists"
    ADD CONSTRAINT "previsit_checklists_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── symptom_diary_entries ───────────────────────────────────────
ALTER TABLE "symptom_diary_entries"
    ADD CONSTRAINT "symptom_diary_entries_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "symptom_diary_entries"
    ADD CONSTRAINT "symptom_diary_entries_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── chronic_care_plans ──────────────────────────────────────────
ALTER TABLE "chronic_care_plans"
    ADD CONSTRAINT "chronic_care_plans_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chronic_care_plans"
    ADD CONSTRAINT "chronic_care_plans_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- NOTE: `createdBy` has no explicit relation on `User` → default
-- Prisma action. Treated as RESTRICT here — deleting the author of a
-- chronic plan should fail loudly rather than silently nulling the
-- audit trail on a clinical artefact.
ALTER TABLE "chronic_care_plans"
    ADD CONSTRAINT "chronic_care_plans_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── chronic_care_checkins ───────────────────────────────────────
ALTER TABLE "chronic_care_checkins"
    ADD CONSTRAINT "chronic_care_checkins_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "chronic_care_plans"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chronic_care_checkins"
    ADD CONSTRAINT "chronic_care_checkins_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chronic_care_checkins"
    ADD CONSTRAINT "chronic_care_checkins_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── chronic_care_alerts ─────────────────────────────────────────
ALTER TABLE "chronic_care_alerts"
    ADD CONSTRAINT "chronic_care_alerts_planId_fkey"
    FOREIGN KEY ("planId") REFERENCES "chronic_care_plans"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chronic_care_alerts"
    ADD CONSTRAINT "chronic_care_alerts_patientId_fkey"
    FOREIGN KEY ("patientId") REFERENCES "patients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chronic_care_alerts"
    ADD CONSTRAINT "chronic_care_alerts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── staff_roster_proposals ──────────────────────────────────────
-- Required creator: RESTRICT (Prisma default).
ALTER TABLE "staff_roster_proposals"
    ADD CONSTRAINT "staff_roster_proposals_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Optional applier: SET NULL (Prisma default for nullable).
ALTER TABLE "staff_roster_proposals"
    ADD CONSTRAINT "staff_roster_proposals_appliedBy_fkey"
    FOREIGN KEY ("appliedBy") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "staff_roster_proposals"
    ADD CONSTRAINT "staff_roster_proposals_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── fraud_alerts ────────────────────────────────────────────────
-- Only tenantId. `acknowledgedBy` is a free TEXT pointer — schema
-- does not declare a User relation for it, so no FK is emitted.
ALTER TABLE "fraud_alerts"
    ADD CONSTRAINT "fraud_alerts_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── doc_qa_reports ──────────────────────────────────────────────
ALTER TABLE "doc_qa_reports"
    ADD CONSTRAINT "doc_qa_reports_consultationId_fkey"
    FOREIGN KEY ("consultationId") REFERENCES "consultations"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "doc_qa_reports"
    ADD CONSTRAINT "doc_qa_reports_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── feedback_sentiment ──────────────────────────────────────────
ALTER TABLE "feedback_sentiment"
    ADD CONSTRAINT "feedback_sentiment_feedbackId_fkey"
    FOREIGN KEY ("feedbackId") REFERENCES "patient_feedback"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "feedback_sentiment"
    ADD CONSTRAINT "feedback_sentiment_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── nps_daily_rollup ────────────────────────────────────────────
ALTER TABLE "nps_daily_rollup"
    ADD CONSTRAINT "nps_daily_rollup_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── claim_denial_history ────────────────────────────────────────
ALTER TABLE "claim_denial_history"
    ADD CONSTRAINT "claim_denial_history_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
