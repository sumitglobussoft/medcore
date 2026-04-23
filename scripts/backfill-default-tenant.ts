#!/usr/bin/env tsx
/**
 * backfill-default-tenant
 * ─────────────────────────────────────────────────────────────────────────────
 * Step 2 of the multi-tenant rollout.
 *
 * After migration `20260423000004_tenant_foundation` has shipped, every
 * tenant-scoped table now has a NULLABLE `tenantId TEXT` column populated
 * with NULL for every pre-existing row. This script:
 *
 *   1. Upserts a single `DEFAULT` tenant (subdomain `default`).
 *   2. Walks the 20 tenant-scoped tables and sets `tenantId = <DEFAULT.id>`
 *      on every row where `tenantId IS NULL`.
 *   3. Reports per-table counts so the operator can spot-check that every
 *      expected row got labelled.
 *
 * A follow-up migration will then flip `tenantId` to `NOT NULL`.
 *
 * Design notes
 * ─────────────
 * • Dry-run by default. Pass `--apply` to write.
 * • `updateMany({ where: { tenantId: null } })` — idempotent. Re-runs simply
 *   find zero rows to update.
 * • Uses the raw `prisma` client (no tenant scoping) on purpose — backfill
 *   must be cross-tenant.
 * • stderr carries progress logging; stdout carries a single JSON summary.
 *
 * Usage
 * ─────
 *   # dry-run (DEFAULT):
 *   npx tsx scripts/backfill-default-tenant.ts
 *
 *   # apply:
 *   npx tsx scripts/backfill-default-tenant.ts --apply
 */

import { config as loadEnv } from "dotenv";
import path from "path";
import { prisma } from "@medcore/db";

loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), "apps/api/.env") });

if (!process.env.DATABASE_URL) {
  console.error(
    "[backfill] FATAL: DATABASE_URL is not set. Aborting before any DB work.",
  );
  process.exit(2);
}

// ── CLI parsing ─────────────────────────────────────────────────────────────

interface CliArgs {
  apply: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let apply = false;
  for (const arg of argv) {
    if (arg === "--apply") apply = true;
    else if (arg === "--dry-run") apply = false;
    else if (arg === "--help" || arg === "-h") {
      console.error(
        "Usage: tsx scripts/backfill-default-tenant.ts [--apply]",
      );
      process.exit(0);
    }
  }
  return { apply };
}

const args = parseArgs(process.argv.slice(2));
const MODE: "DRY_RUN" | "APPLY" = args.apply ? "APPLY" : "DRY_RUN";

// ── Tenant-scoped table driver ──────────────────────────────────────────────

/**
 * Each entry binds a human-readable label to the matching Prisma model
 * delegate. We call `count` and `updateMany` through the delegate so that
 * the TypeScript compiler keeps us honest about typos — no raw SQL.
 */
const TABLES: Array<{
  label: string;
  count: () => Promise<number>;
  updateNullToDefault: (defaultId: string) => Promise<{ count: number }>;
}> = [
  {
    label: "users",
    count: () => prisma.user.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.user.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "doctors",
    count: () => prisma.doctor.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.doctor.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "patients",
    count: () => prisma.patient.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.patient.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "appointments",
    count: () => prisma.appointment.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.appointment.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "consultations",
    count: () => prisma.consultation.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.consultation.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "prescriptions",
    count: () => prisma.prescription.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.prescription.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "invoices",
    count: () => prisma.invoice.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.invoice.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "payments",
    count: () => prisma.payment.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.payment.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "lab_orders",
    count: () => prisma.labOrder.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.labOrder.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "lab_results",
    count: () => prisma.labResult.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.labResult.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "admissions",
    count: () => prisma.admission.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.admission.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "medication_orders",
    count: () => prisma.medicationOrder.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.medicationOrder.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "nurse_rounds",
    count: () => prisma.nurseRound.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.nurseRound.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "referrals",
    count: () => prisma.referral.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.referral.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "surgeries",
    count: () => prisma.surgery.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.surgery.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "staff_shifts",
    count: () => prisma.staffShift.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.staffShift.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "leave_requests",
    count: () => prisma.leaveRequest.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.leaveRequest.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "telemedicine_sessions",
    count: () => prisma.telemedicineSession.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.telemedicineSession.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "emergency_cases",
    count: () => prisma.emergencyCase.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.emergencyCase.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
  {
    label: "notifications",
    count: () => prisma.notification.count({ where: { tenantId: null } }),
    updateNullToDefault: (id) =>
      prisma.notification.updateMany({
        where: { tenantId: null },
        data: { tenantId: id },
      }),
  },
];

const DEFAULT_TENANT_SUBDOMAIN = "default";
const DEFAULT_TENANT_NAME = "DEFAULT";

async function ensureDefaultTenant(): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.tenant.findUnique({
    where: { subdomain: DEFAULT_TENANT_SUBDOMAIN },
    select: { id: true },
  });
  if (existing) {
    return { id: existing.id, created: false };
  }

  if (MODE === "DRY_RUN") {
    // Synthesise a placeholder id so the rest of the script can continue
    // printing accurate per-table counts. No writes happen.
    return { id: "<dry-run-would-create>", created: true };
  }

  const created = await prisma.tenant.create({
    data: {
      name: DEFAULT_TENANT_NAME,
      subdomain: DEFAULT_TENANT_SUBDOMAIN,
      plan: "BASIC",
      active: true,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

async function main() {
  const startedAt = new Date();
  console.error(
    `[backfill] mode=${MODE} startedAt=${startedAt.toISOString()}`,
  );

  const tenant = await ensureDefaultTenant();
  console.error(
    `[backfill] default tenant id=${tenant.id} created=${tenant.created}`,
  );

  const perTable: Array<{
    table: string;
    nullBefore: number;
    updated: number;
  }> = [];

  for (const t of TABLES) {
    const nullBefore = await t.count();
    let updated = 0;

    if (MODE === "APPLY" && nullBefore > 0) {
      const result = await t.updateNullToDefault(tenant.id);
      updated = result.count;
    }

    console.error(
      `[backfill:${MODE}] ${t.label}: ${nullBefore} NULL rows, ${
        MODE === "APPLY" ? `${updated} updated` : "would update"
      }`,
    );

    perTable.push({ table: t.label, nullBefore, updated });
  }

  const totalNull = perTable.reduce((a, b) => a + b.nullBefore, 0);
  const totalUpdated = perTable.reduce((a, b) => a + b.updated, 0);

  const finishedAt = new Date();
  const summary = {
    mode: MODE,
    defaultTenantId: tenant.id,
    defaultTenantCreated: tenant.created,
    totalNullRows: totalNull,
    totalUpdated,
    perTable,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };

  console.error(
    `[backfill] done mode=${MODE} totalNull=${totalNull} totalUpdated=${totalUpdated}`,
  );
  console.log(JSON.stringify(summary));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill] FATAL:", err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
