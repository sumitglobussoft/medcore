/**
 * Canonical revenue / outstanding / refund definitions.
 *
 * Born from issues #139, #159, #165 — the dashboard, reports, billing module
 * and analytics overview each had their own SQL-with-slightly-different-
 * filters for what counts as "revenue this month". One filtered on
 * `payment.paidAt`, another on `invoice.createdAt`, a third on
 * `invoice.status === "PAID"`. The numbers diverged by tens of thousands of
 * rupees on real data.
 *
 * The single source of truth lives here. Every revenue / outstanding /
 * refund KPI in the codebase MUST go through one of these helpers so all
 * widgets agree.
 *
 * Definitions:
 *
 *   revenue   = sum(payments.amount) for amount > 0 AND paidAt ∈ [from,to]
 *               (positive payments only — refunds are subtracted via the
 *               separate `refunds` helper).
 *
 *   refunds   = sum(|payments.amount|) for amount < 0 AND paidAt ∈ [from,to].
 *               (Refunds in this codebase are negative-amount Payment rows
 *               with a transactionId prefixed "REFUND:" or status REFUNDED.)
 *
 *   outstanding = sum(invoice.totalAmount - sum(invoice.payments.amount))
 *                 over invoices where paymentStatus ∈ {PENDING, PARTIAL}.
 *                 Balance is clamped to ≥ 0 to handle over-paid edge cases.
 *
 * All helpers accept an injectable PrismaClient so tests can pass a fake.
 */
import type { PrismaClient } from "@medcore/db";
import { prisma as defaultPrisma } from "@medcore/db";

export interface RevenueWindow {
  from?: Date | null;
  to?: Date | null;
}

export interface RevenueResult {
  total: number;
  count: number;
}

type PrismaLike = Pick<PrismaClient, "payment" | "invoice">;

function buildPaidAtFilter(window: RevenueWindow): Record<string, unknown> | undefined {
  const { from, to } = window;
  if (!from && !to) return undefined;
  const f: Record<string, unknown> = {};
  if (from) f.gte = from;
  if (to) f.lte = to;
  return f;
}

/**
 * Total positive-payment revenue in a window. Excludes refunds (negative-
 * amount rows). Returns `{ total, count }` so the caller can render
 * "Rs. 12,345.00 (43 transactions)" without a second query.
 */
export async function getRevenue(
  window: RevenueWindow,
  client: PrismaLike = defaultPrisma as unknown as PrismaLike
): Promise<RevenueResult> {
  const where: Record<string, unknown> = { amount: { gt: 0 } };
  const paidAt = buildPaidAtFilter(window);
  if (paidAt) where.paidAt = paidAt;

  const rows = await (client as any).payment.findMany({
    where,
    select: { amount: true },
  });
  const total = rows.reduce((s: number, r: { amount: number }) => s + r.amount, 0);
  return { total, count: rows.length };
}

/**
 * Total refunded amount in a window. Refunds are stored as negative-amount
 * payment rows (or `status === "REFUNDED"`). We sum the absolute value so
 * UIs can render a positive "refunds this month" figure.
 */
export async function getRefunds(
  window: RevenueWindow,
  client: PrismaLike = defaultPrisma as unknown as PrismaLike
): Promise<RevenueResult> {
  const paidAt = buildPaidAtFilter(window);
  const where: Record<string, unknown> = {
    OR: [{ amount: { lt: 0 } }, { status: "REFUNDED" }],
  };
  if (paidAt) where.paidAt = paidAt;

  const rows = await (client as any).payment.findMany({
    where,
    select: { amount: true },
  });
  const total = rows.reduce(
    (s: number, r: { amount: number }) => s + Math.abs(r.amount),
    0
  );
  return { total, count: rows.length };
}

/**
 * Net revenue = revenue − refunds for the same window. Convenience wrapper
 * for KPI tiles that want a single number.
 */
export async function getNetRevenue(
  window: RevenueWindow,
  client: PrismaLike = defaultPrisma as unknown as PrismaLike
): Promise<number> {
  const [rev, ref] = await Promise.all([
    getRevenue(window, client),
    getRefunds(window, client),
  ]);
  return rev.total - ref.total;
}

/**
 * Total outstanding across all invoices currently in PENDING or PARTIAL
 * payment state. The balance is `totalAmount - sum(payments.amount)` clamped
 * at 0. Optional `from`/`to` window filters by invoice.createdAt — pass empty
 * for the all-time figure.
 */
export async function getOutstanding(
  window: RevenueWindow = {},
  client: PrismaLike = defaultPrisma as unknown as PrismaLike
): Promise<RevenueResult> {
  const where: Record<string, unknown> = {
    paymentStatus: { in: ["PENDING", "PARTIAL"] },
  };
  const { from, to } = window;
  if (from || to) {
    const cAt: Record<string, unknown> = {};
    if (from) cAt.gte = from;
    if (to) cAt.lte = to;
    where.createdAt = cAt;
  }

  const invoices = await (client as any).invoice.findMany({
    where,
    select: { totalAmount: true, payments: { select: { amount: true } } },
  });
  let total = 0;
  for (const inv of invoices as Array<{
    totalAmount: number;
    payments: Array<{ amount: number }>;
  }>) {
    const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
    total += Math.max(0, inv.totalAmount - paid);
  }
  return { total, count: invoices.length };
}

/**
 * Pure-function variant for unit tests: compute outstanding from already-
 * loaded rows. Mirrors the prod definition — `Math.max(0, totalAmount - paid)`.
 */
export function computeOutstandingFromRows(
  rows: Array<{ totalAmount: number; payments: Array<{ amount: number }> }>
): number {
  let total = 0;
  for (const inv of rows) {
    const paid = inv.payments.reduce((s, p) => s + p.amount, 0);
    total += Math.max(0, inv.totalAmount - paid);
  }
  return total;
}

/**
 * Helpers for "this month" / "today" windows so callers don't reinvent the
 * boundaries (and run into off-by-a-day timezone bugs).
 */
export function startOfMonth(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
}

export function startOfDay(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

export function endOfDay(d: Date = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
