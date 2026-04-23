-- ================================================================
-- 20260423000006_prompts
--
-- GAP-P3 — Prompt registry with versioning + rollback.
--
-- Introduces the `prompts` table so LLM system prompts live in the
-- database rather than in compiled code. The application layer keeps
-- a 60-second in-memory cache and falls back to the hardcoded PROMPTS
-- constants in apps/api/src/services/ai/prompts.ts when the table is
-- empty, so this migration is safe to ship ahead of any seeded data.
--
-- Indexes:
--   * PK on id (uuid).
--   * UNIQUE (key, version)          — one row per version of a key,
--                                     the natural history axis.
--   * INDEX (key)                    — fast "list all versions of X".
--   * UNIQUE (key) WHERE active      — partial index enforcing that
--                                     at most one version per key is
--                                     live at any time. Rollback /
--                                     activation must deactivate the
--                                     current active row in the same
--                                     transaction.
--
-- This migration is ADDITIVE ONLY — no existing table or column is
-- touched.
-- ================================================================

CREATE TABLE "prompts" (
    "id"        TEXT        NOT NULL,
    "key"       TEXT        NOT NULL,
    "version"   INTEGER     NOT NULL,
    "content"   TEXT        NOT NULL,
    "createdBy" TEXT        NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active"    BOOLEAN     NOT NULL DEFAULT false,
    "notes"     TEXT,

    CONSTRAINT "prompts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prompts_key_version_key" ON "prompts"("key", "version");
CREATE INDEX "prompts_key_idx" ON "prompts"("key");

-- Defense-in-depth: only one active version per key. Partial unique
-- index so an app-layer bug can't leave two rows flagged active.
CREATE UNIQUE INDEX "prompts_key_active_uniq"
    ON "prompts"("key")
    WHERE "active" = true;
