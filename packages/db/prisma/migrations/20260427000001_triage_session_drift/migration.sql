-- Migration: AITriageSession schema drift catch-up (2026-04-27)
-- Three columns existed in schema.prisma since the agent-console + booking
-- work in late April but were never captured in a migration. Prod DB
-- failed Prisma upserts with P2022 because of the drift. Additive only;
-- all three columns are nullable.
--
-- Drift discovered while running scripts/sanitize-and-reseed.ts.

ALTER TABLE "ai_triage_sessions"
  ADD COLUMN IF NOT EXISTS "bookingFor"         TEXT,
  ADD COLUMN IF NOT EXISTS "dependentPatientId" TEXT,
  ADD COLUMN IF NOT EXISTS "handoffChatRoomId"  TEXT;
