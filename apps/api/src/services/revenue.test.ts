// Unit tests for the canonical revenue / outstanding / refund helpers.
//
// Issues #139 / #159 / #165: dashboard, reports, billing module and analytics
// overview were each computing "revenue this month" with subtly different
// SQL filters, producing numbers that disagreed by tens of thousands of
// rupees. The helpers in services/revenue lock the definition. These tests
// guarantee that:
//
//   - revenue includes ONLY positive-amount payments
//   - refunds sum the absolute value of negative-amount payments
//   - net revenue is revenue − refunds
//   - outstanding clamps balance to ≥ 0 (no over-paid invoice subtracts
//     from the running total)
//   - the date helpers don't introduce timezone drift

import { describe, it, expect, vi } from "vitest";
import {
  getRevenue,
  getRefunds,
  getNetRevenue,
  getOutstanding,
  computeOutstandingFromRows,
  startOfMonth,
  startOfDay,
  endOfDay,
} from "./revenue";

function mkClient(payments: any[] = [], invoices: any[] = []) {
  return {
    payment: {
      findMany: vi.fn(async ({ where }: any) => {
        const out = payments.filter((p) => {
          if (where?.amount?.gt !== undefined && !(p.amount > where.amount.gt))
            return false;
          if (where?.amount?.lt !== undefined && !(p.amount < where.amount.lt))
            return false;
          if (where?.OR) {
            // simulate `OR: [{ amount < 0 }, { status === 'REFUNDED' }]`
            const match = (where.OR as any[]).some((cond) => {
              if (cond.amount?.lt !== undefined)
                return p.amount < cond.amount.lt;
              if (cond.status !== undefined) return p.status === cond.status;
              return false;
            });
            if (!match) return false;
          }
          if (where?.paidAt?.gte && new Date(p.paidAt) < where.paidAt.gte)
            return false;
          if (where?.paidAt?.lte && new Date(p.paidAt) > where.paidAt.lte)
            return false;
          return true;
        });
        return out;
      }),
    },
    invoice: {
      findMany: vi.fn(async ({ where }: any) => {
        return invoices.filter((inv) => {
          if (where?.paymentStatus?.in) {
            if (!where.paymentStatus.in.includes(inv.paymentStatus))
              return false;
          }
          if (where?.createdAt?.gte && new Date(inv.createdAt) < where.createdAt.gte)
            return false;
          if (where?.createdAt?.lte && new Date(inv.createdAt) > where.createdAt.lte)
            return false;
          return true;
        });
      }),
    },
  } as any;
}

describe("getRevenue", () => {
  it("returns 0 when there are no payments", async () => {
    const client = mkClient([]);
    const r = await getRevenue({}, client);
    expect(r.total).toBe(0);
    expect(r.count).toBe(0);
  });

  it("sums positive-amount payments only and ignores refunds", async () => {
    const client = mkClient([
      { amount: 1000, paidAt: "2026-04-10T00:00:00Z" },
      { amount: 500, paidAt: "2026-04-15T00:00:00Z" },
      { amount: -200, paidAt: "2026-04-20T00:00:00Z" }, // refund
      { amount: 0, paidAt: "2026-04-22T00:00:00Z" }, // zero
    ]);
    const r = await getRevenue({}, client);
    expect(r.total).toBe(1500);
    expect(r.count).toBe(2);
  });

  it("respects the from/to window", async () => {
    const client = mkClient([
      { amount: 100, paidAt: "2026-03-31T23:00:00Z" }, // before
      { amount: 200, paidAt: "2026-04-01T00:00:00Z" }, // in
      { amount: 300, paidAt: "2026-04-30T23:59:00Z" }, // in
      { amount: 400, paidAt: "2026-05-01T00:00:00Z" }, // after
    ]);
    const r = await getRevenue(
      {
        from: new Date("2026-04-01T00:00:00Z"),
        to: new Date("2026-04-30T23:59:59Z"),
      },
      client
    );
    expect(r.total).toBe(500);
    expect(r.count).toBe(2);
  });
});

describe("getRefunds", () => {
  it("sums |amount| of negative-amount payments", async () => {
    const client = mkClient([
      { amount: -200, paidAt: "2026-04-10T00:00:00Z" },
      { amount: -150, paidAt: "2026-04-12T00:00:00Z" },
      { amount: 1000, paidAt: "2026-04-15T00:00:00Z" }, // not a refund
    ]);
    const r = await getRefunds({}, client);
    expect(r.total).toBe(350);
    expect(r.count).toBe(2);
  });

  it("returns 0 when no refunds exist", async () => {
    const client = mkClient([{ amount: 999, paidAt: "2026-04-01T00:00:00Z" }]);
    const r = await getRefunds({}, client);
    expect(r.total).toBe(0);
    expect(r.count).toBe(0);
  });
});

describe("getNetRevenue", () => {
  it("equals revenue − refunds for the same window", async () => {
    const client = mkClient([
      { amount: 1000, paidAt: "2026-04-10T00:00:00Z" },
      { amount: -100, paidAt: "2026-04-15T00:00:00Z" },
    ]);
    const net = await getNetRevenue({}, client);
    expect(net).toBe(900);
  });
});

describe("getOutstanding / computeOutstandingFromRows", () => {
  it("clamps overpaid invoices to 0 (never subtracts from total)", () => {
    const rows = [
      { totalAmount: 1000, payments: [{ amount: 1200 }] }, // overpaid
      { totalAmount: 500, payments: [{ amount: 200 }] }, // 300 outstanding
      { totalAmount: 800, payments: [] }, // 800 outstanding
    ];
    expect(computeOutstandingFromRows(rows)).toBe(1100);
  });

  it("returns 0 when all invoices are fully paid", () => {
    expect(
      computeOutstandingFromRows([
        { totalAmount: 100, payments: [{ amount: 100 }] },
      ])
    ).toBe(0);
  });

  it("filters PENDING/PARTIAL invoices via the prisma client", async () => {
    const client = mkClient(
      [],
      [
        {
          paymentStatus: "PENDING",
          totalAmount: 500,
          payments: [{ amount: 100 }],
          createdAt: "2026-04-15T00:00:00Z",
        },
        {
          paymentStatus: "PAID",
          totalAmount: 1000,
          payments: [{ amount: 1000 }],
          createdAt: "2026-04-15T00:00:00Z",
        },
        {
          paymentStatus: "PARTIAL",
          totalAmount: 800,
          payments: [{ amount: 300 }],
          createdAt: "2026-04-15T00:00:00Z",
        },
      ]
    );
    const r = await getOutstanding({}, client);
    expect(r.count).toBe(2); // PENDING + PARTIAL only
    expect(r.total).toBe(400 + 500); // 500-100 + 800-300
  });
});

describe("date window helpers", () => {
  it("startOfMonth is midnight on the 1st of the same month", () => {
    const d = startOfMonth(new Date(2026, 3, 17, 14, 30));
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(1);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
  });

  it("startOfDay zeroes hours/minutes/seconds for the same day", () => {
    const d = startOfDay(new Date(2026, 3, 26, 14, 30, 45));
    expect(d.getDate()).toBe(26);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
  });

  it("endOfDay sets 23:59:59.999 for the same day", () => {
    const d = endOfDay(new Date(2026, 3, 26, 1, 0, 0));
    expect(d.getHours()).toBe(23);
    expect(d.getMinutes()).toBe(59);
    expect(d.getSeconds()).toBe(59);
    expect(d.getMilliseconds()).toBe(999);
  });
});
