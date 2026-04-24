import fs from "fs";
import path from "path";
import zlib from "zlib";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { prisma } from "@medcore/db";

// ─── Audit-log retention + archival ─────────────────────────────────────────
//
// `AuditLog` is append-only and grows without bound. Production instances
// have seen 200k+ rows/week, so this module rotates anything older than
// `auditLogRetentionDays` (stored in `system_config`, default 365 days) to
// a gzipped NDJSON file in `backups/audit-archive-YYYYMMDD.jsonl.gz` and
// then deletes the archived rows in batches to keep the transaction short.
//
// Surface:
//   - runAuditLogArchival({ cutoff?, batchSize?, archiveDir?, dryRun? })
//   - Default archive dir: `<repoRoot>/backups`
//   - Default batch size:  500
//
// Callers: the scheduled task in `scheduled-tasks.ts` (daily 03:30 local)
// and `scripts/archive-audit-logs.ts` (manual / one-off operator use).

export const AUDIT_LOG_RETENTION_DAYS_KEY = "auditLogRetentionDays";
export const DEFAULT_AUDIT_LOG_RETENTION_DAYS = 365;
export const DEFAULT_ARCHIVE_BATCH_SIZE = 500;

export interface RunAuditLogArchivalOptions {
  /** Rows with `createdAt < cutoff` will be archived. If omitted, computed
   *  from the retention days stored in system_config. */
  cutoff?: Date;
  /** Max rows fetched + deleted per round-trip. Default 500. */
  batchSize?: number;
  /** Directory for the gzipped NDJSON file. Default `<cwd>/backups`. */
  archiveDir?: string;
  /** When true, count rows but DO NOT write the archive file or delete. */
  dryRun?: boolean;
}

export interface RunAuditLogArchivalResult {
  cutoff: string;
  archived: number;
  deleted: number;
  archivePath: string | null;
  batches: number;
  dryRun: boolean;
}

/**
 * Read the configured retention (in days) from `system_config`, falling
 * back to {@link DEFAULT_AUDIT_LOG_RETENTION_DAYS} when the row is missing
 * or not a positive integer.
 */
export async function getAuditLogRetentionDays(): Promise<number> {
  try {
    const row = await prisma.systemConfig.findUnique({
      where: { key: AUDIT_LOG_RETENTION_DAYS_KEY },
    });
    if (!row?.value) return DEFAULT_AUDIT_LOG_RETENTION_DAYS;
    const parsed = parseInt(row.value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_AUDIT_LOG_RETENTION_DAYS;
    }
    return parsed;
  } catch {
    return DEFAULT_AUDIT_LOG_RETENTION_DAYS;
  }
}

function formatArchiveStamp(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

/**
 * Archive all `AuditLog` rows older than `cutoff` to a gzipped NDJSON file
 * under `archiveDir`, then delete them in batches. Idempotent-ish: re-runs
 * simply find no more eligible rows.
 *
 * Cross-tenant on purpose — audit retention is an operator concern, so we
 * use the un-scoped `prisma` import (not `tenantScopedPrisma`).
 */
export async function runAuditLogArchival(
  opts: RunAuditLogArchivalOptions = {}
): Promise<RunAuditLogArchivalResult> {
  const dryRun = opts.dryRun === true;
  const batchSize = Math.max(
    1,
    opts.batchSize ?? DEFAULT_ARCHIVE_BATCH_SIZE
  );
  let cutoff = opts.cutoff;
  if (!cutoff) {
    const days = await getAuditLogRetentionDays();
    cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }
  const archiveDir =
    opts.archiveDir ?? path.join(process.cwd(), "backups");

  const total = await prisma.auditLog.count({
    where: { createdAt: { lt: cutoff } },
  });

  if (total === 0) {
    return {
      cutoff: cutoff.toISOString(),
      archived: 0,
      deleted: 0,
      archivePath: null,
      batches: 0,
      dryRun,
    };
  }

  const stamp = formatArchiveStamp(new Date());
  const archivePath = path.join(
    archiveDir,
    `audit-archive-${stamp}.jsonl.gz`
  );

  if (dryRun) {
    return {
      cutoff: cutoff.toISOString(),
      archived: total,
      deleted: 0,
      archivePath,
      batches: Math.ceil(total / batchSize),
      dryRun: true,
    };
  }

  if (!fs.existsSync(archiveDir)) {
    fs.mkdirSync(archiveDir, { recursive: true });
  }

  let archived = 0;
  let deleted = 0;
  let batches = 0;

  // Open a single gzip stream for the whole archive run so batches append
  // into one file (one line per row; NDJSON is easy to grep-restore).
  const gzip = zlib.createGzip();
  const out = fs.createWriteStream(archivePath, { flags: "w" });
  const writeDone = pipeline(gzip, out);

  try {
    while (true) {
      const rows = await prisma.auditLog.findMany({
        where: { createdAt: { lt: cutoff } },
        orderBy: { createdAt: "asc" },
        take: batchSize,
      });
      if (rows.length === 0) break;

      batches += 1;

      const ndjson = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";
      if (!gzip.write(ndjson)) {
        await new Promise<void>((resolve) => gzip.once("drain", resolve));
      }
      archived += rows.length;

      // Delete by id to avoid racing with rows inserted after `cutoff` was
      // computed — `deleteMany` with a `createdAt` predicate would drop any
      // fresh row that wandered into the window mid-archival.
      const ids = rows.map((r) => r.id);
      const res = await prisma.auditLog.deleteMany({
        where: { id: { in: ids } },
      });
      deleted += res.count;

      // Guard against runaway loops if something misbehaves upstream.
      if (rows.length < batchSize) break;
    }
  } finally {
    gzip.end();
    try {
      await writeDone;
    } catch (err) {
      // Even if the gzip pipeline errored we still want to surface the
      // count so the caller can decide. Re-throw after logging.
      console.error("[audit-archival] gzip pipeline failed", err);
      throw err;
    }
  }

  return {
    cutoff: cutoff.toISOString(),
    archived,
    deleted,
    archivePath,
    batches,
    dryRun: false,
  };
}

/**
 * Helper for the readable NDJSON stream when restoring — not used by the
 * scheduler but handy in ops scripts. Exported to keep the public surface
 * self-contained.
 */
export function readArchiveAsStream(filePath: string): Readable {
  return fs.createReadStream(filePath).pipe(zlib.createGunzip());
}
