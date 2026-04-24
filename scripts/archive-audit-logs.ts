#!/usr/bin/env tsx
/**
 * archive-audit-logs
 * ─────────────────────────────────────────────────────────────────────────────
 * Manual / one-off driver for the audit-log retention archival. Wraps
 * `apps/api/src/services/audit-archival.ts#runAuditLogArchival` so an operator
 * can do targeted clean-ups (e.g. "archive everything before 2025-06-01")
 * without waiting for the daily scheduler at 03:30 local.
 *
 * Cross-tenant on purpose — uses the raw `prisma` client (NOT
 * `tenantScopedPrisma`). Operator intent is "sweep all tenants".
 *
 * Defaults to dry-run. --apply is required to write the archive file and
 * delete rows.
 *
 * Usage
 * ─────
 *   # dry-run (DEFAULT — safe, zero writes):
 *   npx tsx scripts/archive-audit-logs.ts
 *
 *   # apply (archive + delete using configured retention days):
 *   npx tsx scripts/archive-audit-logs.ts --apply
 *
 *   # custom cutoff (archive everything before 2025-06-01):
 *   npx tsx scripts/archive-audit-logs.ts --before 2025-06-01 --apply
 *
 *   # custom batch size:
 *   npx tsx scripts/archive-audit-logs.ts --apply --batch 1000
 */

import { config as loadEnv } from "dotenv";
import path from "path";
import {
  runAuditLogArchival,
  getAuditLogRetentionDays,
} from "../apps/api/src/services/audit-archival";

// Pick up DATABASE_URL from the API package's .env just like every other script.
loadEnv({ path: path.resolve(__dirname, "..", "apps", "api", ".env") });

interface CliFlags {
  apply: boolean;
  before: Date | null;
  batch: number;
  archiveDir: string;
}

function parseArgs(argv: string[]): CliFlags {
  const flags: CliFlags = {
    apply: false,
    before: null,
    batch: 500,
    archiveDir: path.resolve(__dirname, "..", "backups"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--apply") {
      flags.apply = true;
    } else if (a === "--dry-run") {
      flags.apply = false;
    } else if (a === "--before") {
      const v = argv[i + 1];
      i += 1;
      if (!v) throw new Error("--before requires a YYYY-MM-DD value");
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) {
        throw new Error(`--before: could not parse "${v}" as a date`);
      }
      flags.before = d;
    } else if (a === "--batch") {
      const v = argv[i + 1];
      i += 1;
      if (!v) throw new Error("--batch requires a number");
      flags.batch = parseInt(v, 10);
      if (!Number.isFinite(flags.batch) || flags.batch <= 0) {
        throw new Error("--batch must be a positive integer");
      }
    } else if (a === "--archive-dir") {
      const v = argv[i + 1];
      i += 1;
      if (!v) throw new Error("--archive-dir requires a path");
      flags.archiveDir = path.resolve(v);
    } else if (a === "--help" || a === "-h") {
      printUsageAndExit(0);
    } else if (a) {
      console.error(`Unknown flag: ${a}`);
      printUsageAndExit(2);
    }
  }
  return flags;
}

function printUsageAndExit(code: number): never {
  console.log(
    [
      "Usage: npx tsx scripts/archive-audit-logs.ts [--apply] [--before YYYY-MM-DD] [--batch N] [--archive-dir PATH]",
      "",
      "  --apply           Actually write the archive and delete rows (default: dry-run).",
      "  --before DATE     Override cutoff. Rows with createdAt < DATE are archived.",
      "                    Without this flag, the configured retention days are used",
      "                    (system_config.auditLogRetentionDays, default 365).",
      "  --batch N         Batch size per round-trip. Default 500.",
      "  --archive-dir P   Where to drop the .jsonl.gz file. Default: <repo>/backups.",
      "",
    ].join("\n")
  );
  process.exit(code);
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));

  const days = await getAuditLogRetentionDays();
  const effectiveCutoff =
    flags.before ??
    new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  console.error(
    JSON.stringify({
      mode: flags.apply ? "APPLY" : "DRY_RUN",
      retentionDays: days,
      cutoff: effectiveCutoff.toISOString(),
      batchSize: flags.batch,
      archiveDir: flags.archiveDir,
    })
  );

  const result = await runAuditLogArchival({
    cutoff: effectiveCutoff,
    batchSize: flags.batch,
    archiveDir: flags.archiveDir,
    dryRun: !flags.apply,
  });

  // Structured summary to stdout so CI can capture it.
  console.log(JSON.stringify(result, null, 2));

  if (!flags.apply && result.archived > 0) {
    console.error(
      `\nDRY RUN: ${result.archived} row(s) would be archived across ${result.batches} batch(es). Re-run with --apply to commit.`
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[archive-audit-logs] FAILED:", err);
    process.exit(1);
  });
