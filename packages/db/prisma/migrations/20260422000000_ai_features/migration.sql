-- CreateEnum
CREATE TYPE "AITriageStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED', 'EMERGENCY_DETECTED');

-- CreateEnum
CREATE TYPE "AIScribeStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CONSENT_WITHDRAWN');

-- CreateTable
CREATE TABLE "ai_triage_sessions" (
    "id" TEXT NOT NULL,
    "patientId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "inputMode" TEXT NOT NULL DEFAULT 'text',
    "status" "AITriageStatus" NOT NULL DEFAULT 'ACTIVE',
    "chiefComplaint" TEXT,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "symptoms" JSONB,
    "redFlagDetected" BOOLEAN NOT NULL DEFAULT false,
    "redFlagReason" TEXT,
    "confidence" DOUBLE PRECISION,
    "suggestedSpecialties" JSONB,
    "preVisitSummary" JSONB,
    "appointmentId" TEXT,
    "modelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_triage_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_scribe_sessions" (
    "id" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "consentObtained" BOOLEAN NOT NULL DEFAULT false,
    "consentAt" TIMESTAMP(3),
    "status" "AIScribeStatus" NOT NULL DEFAULT 'ACTIVE',
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "soapDraft" JSONB,
    "soapFinal" JSONB,
    "icd10Codes" JSONB,
    "rxDraft" JSONB,
    "doctorEdits" JSONB NOT NULL DEFAULT '[]',
    "signedOffAt" TIMESTAMP(3),
    "signedOffBy" TEXT,
    "audioRetainUntil" TIMESTAMP(3),
    "modelVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_scribe_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_triage_sessions_appointmentId_key" ON "ai_triage_sessions"("appointmentId");

-- CreateIndex
CREATE INDEX "ai_triage_sessions_patientId_idx" ON "ai_triage_sessions"("patientId");

-- CreateIndex
CREATE INDEX "ai_triage_sessions_status_idx" ON "ai_triage_sessions"("status");

-- CreateIndex
CREATE INDEX "ai_triage_sessions_createdAt_idx" ON "ai_triage_sessions"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_scribe_sessions_appointmentId_key" ON "ai_scribe_sessions"("appointmentId");

-- CreateIndex
CREATE INDEX "ai_scribe_sessions_doctorId_idx" ON "ai_scribe_sessions"("doctorId");

-- CreateIndex
CREATE INDEX "ai_scribe_sessions_status_idx" ON "ai_scribe_sessions"("status");

-- CreateIndex
CREATE INDEX "ai_scribe_sessions_createdAt_idx" ON "ai_scribe_sessions"("createdAt");

-- AddForeignKey
ALTER TABLE "ai_triage_sessions" ADD CONSTRAINT "ai_triage_sessions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_triage_sessions" ADD CONSTRAINT "ai_triage_sessions_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_scribe_sessions" ADD CONSTRAINT "ai_scribe_sessions_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_scribe_sessions" ADD CONSTRAINT "ai_scribe_sessions_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_scribe_sessions" ADD CONSTRAINT "ai_scribe_sessions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
