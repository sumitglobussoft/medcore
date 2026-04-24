import { prisma } from "@medcore/db";
import { PROMPTS, type PromptKey } from "./prompts";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PromptVersion {
  id: string;
  key: string;
  version: number;
  content: string;
  createdBy: string;
  createdAt: Date;
  active: boolean;
  notes: string | null;
}

export interface ListResult {
  items: PromptVersion[];
  total: number;
  page: number;
  pageSize: number;
}

// ── In-memory cache ───────────────────────────────────────────────────────────
//
// LLM code paths ask for a prompt on every request — hitting Postgres each
// time would add ~5 ms and a DB round-trip to every triage/scribe call. A
// 60-second TTL is short enough that an admin's rollback propagates fleet-wide
// within a minute, but long enough to eliminate the hot-path cost.
//
// Keyed by prompt key (e.g. "TRIAGE_SYSTEM"). Values expire lazily: we check
// `fetchedAt` on read and refresh from the DB if stale.

interface CacheEntry {
  content: string;
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000;
const cache = new Map<string, CacheEntry>();

/**
 * Test/admin hook: drops the in-memory cache so a freshly-activated prompt is
 * picked up on the next read. Called automatically by the mutation helpers
 * below but also exposed so integration tests don't have to wait out the TTL.
 */
export function clearPromptCache(): void {
  cache.clear();
}

/**
 * Observability hook: returns the age in seconds of the OLDEST cache entry.
 * Returns 0 when the cache is empty. Consumed by the Prometheus gauge in
 * `services/metrics.ts` so ops can alarm if a cache entry has somehow outlived
 * the 60s TTL (would indicate clearPromptCache() isn't firing on mutation).
 */
export function getOldestPromptCacheAgeSeconds(): number {
  if (cache.size === 0) return 0;
  let oldest = Date.now();
  for (const entry of cache.values()) {
    if (entry.fetchedAt < oldest) oldest = entry.fetchedAt;
  }
  return Math.max(0, Math.floor((Date.now() - oldest) / 1000));
}

// ── Readers ───────────────────────────────────────────────────────────────────

/**
 * Returns the currently-active prompt content for `key`. Reads through the
 * 60-second cache; on cache miss queries `prompts` for the row flagged
 * `active = true`. If no DB row exists (fresh deploy with empty table) or
 * the DB call fails for any reason, falls back to the hardcoded `PROMPTS`
 * constant so the LLM call never crashes on prompt lookup.
 *
 * This fallback is load-bearing: GAP-P3 requires that registry failures
 * degrade gracefully rather than take the triage endpoint down.
 */
export async function getActivePrompt(key: string): Promise<string> {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.content;
  }

  try {
    const row = await prisma.prompt.findFirst({
      where: { key, active: true },
      select: { content: true },
    });
    if (row?.content) {
      cache.set(key, { content: row.content, fetchedAt: Date.now() });
      return row.content;
    }
    // No active row — fall through to static fallback. Do NOT cache the
    // fallback: as soon as an admin seeds a v1 we want to pick it up.
  } catch (err) {
    // DB unavailable / transient failure — log once and fall through. A
    // prompt-registry hiccup MUST NOT take down the LLM features.
    console.warn(
      `[prompt-registry] DB lookup failed for key="${key}", using static fallback:`,
      err instanceof Error ? err.message : err
    );
  }

  const fallback = PROMPTS[key as PromptKey];
  if (typeof fallback === "string") {
    return fallback;
  }
  // Unknown key and no static fallback — return empty string so the caller
  // sends a truly empty system prompt rather than crashing. Caller code (the
  // LLM wrappers in sarvam.ts) still produces a sensible response because the
  // user message carries the actual task.
  return "";
}

// ── Writers ───────────────────────────────────────────────────────────────────

/**
 * Create the next version row for `key`. Version numbers auto-increment per
 * key (max + 1), starting at 1. The new row is NOT active by default — an
 * admin must call `activatePromptVersion(id)` to roll it out.
 */
export async function createPromptVersion(
  key: string,
  content: string,
  createdBy: string,
  notes?: string
): Promise<PromptVersion> {
  if (!key || typeof key !== "string") {
    throw new Error("createPromptVersion: key is required");
  }
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("createPromptVersion: content must be a non-empty string");
  }

  // We use a transaction so two concurrent creates can't both pick the same
  // version number (UNIQUE(key, version) would reject the loser, but the
  // transaction + aggregate keeps behaviour deterministic).
  const created = await prisma.$transaction(async (tx) => {
    const latest = await tx.prompt.aggregate({
      where: { key },
      _max: { version: true },
    });
    const nextVersion = (latest._max.version ?? 0) + 1;
    return tx.prompt.create({
      data: {
        key,
        version: nextVersion,
        content,
        createdBy,
        notes: notes ?? null,
        active: false,
      },
    });
  });

  return created as PromptVersion;
}

/**
 * Flip `id` to active and deactivate whichever version was previously active
 * for the same key. Runs inside a transaction so there is never an instant
 * where zero (or two) versions are active for a key.
 */
export async function activatePromptVersion(id: string): Promise<PromptVersion> {
  const result = await prisma.$transaction(async (tx) => {
    const target = await tx.prompt.findUnique({ where: { id } });
    if (!target) {
      throw new Error(`Prompt version not found: ${id}`);
    }
    // Deactivate the current active version for this key (if any).
    await tx.prompt.updateMany({
      where: { key: target.key, active: true, NOT: { id: target.id } },
      data: { active: false },
    });
    // Activate this one.
    const updated = await tx.prompt.update({
      where: { id: target.id },
      data: { active: true },
    });
    return updated;
  });

  clearPromptCache();
  return result as PromptVersion;
}

/**
 * Roll a key back to the previous version (the one immediately before whichever
 * version is currently active). Used when an admin promotes a prompt that
 * turns out to degrade quality in prod. No-op with an error if there is no
 * prior version to roll back to.
 */
export async function rollbackPromptKey(key: string): Promise<PromptVersion> {
  const result = await prisma.$transaction(async (tx) => {
    const current = await tx.prompt.findFirst({
      where: { key, active: true },
      orderBy: { version: "desc" },
    });
    if (!current) {
      throw new Error(`No active version to roll back for key="${key}"`);
    }
    const prior = await tx.prompt.findFirst({
      where: { key, version: { lt: current.version } },
      orderBy: { version: "desc" },
    });
    if (!prior) {
      throw new Error(`No prior version exists for key="${key}" (current is v${current.version})`);
    }
    // Flip active flag atomically.
    await tx.prompt.update({
      where: { id: current.id },
      data: { active: false },
    });
    const activated = await tx.prompt.update({
      where: { id: prior.id },
      data: { active: true },
    });
    return activated;
  });

  clearPromptCache();
  return result as PromptVersion;
}

/**
 * Paginated list of versions for a key, newest first. Default page size 20.
 */
export async function listPromptVersions(
  key: string,
  opts: { page?: number; pageSize?: number } = {}
): Promise<ListResult> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

  const [items, total] = await Promise.all([
    prisma.prompt.findMany({
      where: { key },
      orderBy: { version: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.prompt.count({ where: { key } }),
  ]);

  return { items: items as PromptVersion[], total, page, pageSize };
}
