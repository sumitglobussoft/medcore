"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { CreditCard, X } from "lucide-react";

type Tab = "ACTIVE" | "OVERDUE" | "COMPLETED" | "ALL";

interface InstallmentRec {
  id: string;
  dueDate: string;
  amount: number;
  status: string;
  paidAt?: string | null;
}

interface PlanRow {
  id: string;
  planNumber: string;
  totalAmount: number;
  downPayment: number;
  installments: number;
  installmentAmount: number;
  frequency: string;
  startDate: string;
  status: string;
  paidCount?: number;
  nextDue?: string | null;
  invoice: { id: string; invoiceNumber: string; totalAmount: number };
  patient: {
    id: string;
    mrNumber: string;
    user: { name: string; phone: string };
  };
  installmentRecords: InstallmentRec[];
}

interface OverdueRow {
  id: string;
  dueDate: string;
  amount: number;
  status: string;
  plan: {
    id: string;
    planNumber: string;
    patient: {
      mrNumber: string;
      user: { name: string; phone: string };
    };
    invoice: { id: string; invoiceNumber: string };
  };
}

function fmtMoney(n: number) {
  return `Rs. ${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PaymentPlansPage() {
  const [tab, setTab] = useState<Tab>("ACTIVE");
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [overdue, setOverdue] = useState<OverdueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === "OVERDUE") {
        const res = await api.get<{ data: OverdueRow[] }>(
          "/payment-plans/overdue"
        );
        setOverdue(res.data);
      } else {
        const params = new URLSearchParams();
        if (tab !== "ALL") params.set("status", tab);
        const res = await api.get<{ data: PlanRow[] }>(
          `/payment-plans?${params.toString()}`
        );
        setPlans(res.data);
      }
    } catch {
      // empty
    }
    setLoading(false);
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition ${
      tab === t
        ? "bg-primary text-white"
        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
    }`;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CreditCard className="text-primary" /> Payment Plans
          </h1>
          <p className="text-sm text-gray-500">
            Installment / EMI plans for outstanding invoices
          </p>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <button onClick={() => setTab("ACTIVE")} className={tabClass("ACTIVE")}>
          Active
        </button>
        <button onClick={() => setTab("OVERDUE")} className={tabClass("OVERDUE")}>
          Overdue
        </button>
        <button
          onClick={() => setTab("COMPLETED")}
          className={tabClass("COMPLETED")}
        >
          Completed
        </button>
        <button onClick={() => setTab("ALL")} className={tabClass("ALL")}>
          All
        </button>
      </div>

      <div className="rounded-xl bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : tab === "OVERDUE" ? (
          overdue.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              No overdue installments.
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b text-left text-sm text-gray-500">
                  <th className="px-4 py-3">Plan #</th>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {overdue.map((r) => (
                  <tr
                    key={r.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-gray-50"
                    onClick={() => setDetailId(r.plan.id)}
                  >
                    <td className="px-4 py-3 font-mono text-sm">
                      {r.plan.planNumber}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{r.plan.patient.user.name}</p>
                      <p className="text-xs text-gray-500">
                        {r.plan.patient.user.phone}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {r.plan.invoice.invoiceNumber}
                    </td>
                    <td className="px-4 py-3 text-sm text-red-600">
                      {new Date(r.dueDate).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm font-semibold">
                      {fmtMoney(r.amount)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                        OVERDUE
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        ) : plans.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No plans in this category.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-gray-500">
                <th className="px-4 py-3">Plan #</th>
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">Invoice</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3">Next Due</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => {
                const paid = p.paidCount ?? 0;
                const pct = p.installments
                  ? (paid / p.installments) * 100
                  : 0;
                return (
                  <tr
                    key={p.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-gray-50"
                    onClick={() => setDetailId(p.id)}
                  >
                    <td className="px-4 py-3 font-mono text-sm">
                      {p.planNumber}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium">{p.patient.user.name}</p>
                      <p className="text-xs text-gray-500">
                        {p.patient.mrNumber}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <Link
                        href={`/dashboard/billing/${p.invoice.id}`}
                        className="text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.invoice.invoiceNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {fmtMoney(p.totalAmount)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 rounded-full bg-gray-200">
                          <div
                            className="h-2 rounded-full bg-green-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500">
                          {paid}/{p.installments}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {p.nextDue
                        ? new Date(p.nextDue).toLocaleDateString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          p.status === "ACTIVE"
                            ? "bg-blue-100 text-blue-700"
                            : p.status === "COMPLETED"
                              ? "bg-green-100 text-green-700"
                              : p.status === "DEFAULTED"
                                ? "bg-red-100 text-red-700"
                                : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {detailId && (
        <PlanDetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onRefresh={load}
        />
      )}
    </div>
  );
}

function PlanDetailModal({
  id,
  onClose,
  onRefresh,
}: {
  id: string;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [plan, setPlan] = useState<PlanRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);
  const [mode, setMode] = useState("CASH");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ data: PlanRow }>(`/payment-plans/${id}`);
      setPlan(res.data);
    } catch {
      // ignore
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function payInstallment(instId: string, amt: number) {
    setPaying(instId);
    try {
      await api.patch(`/payment-plans/${id}/pay-installment`, {
        installmentId: instId,
        amount: amt,
        mode,
      });
      await load();
      onRefresh();
    } catch (err) {
      toast.error((err as Error).message);
    }
    setPaying(null);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h2 className="text-lg font-bold">
            Payment Plan {plan?.planNumber ?? ""}
          </h2>
          <button
            onClick={onClose}
            className="rounded-full p-1 hover:bg-gray-100"
          >
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : !plan ? (
          <div className="p-8 text-center text-gray-500">Not found.</div>
        ) : (
          <div className="space-y-4 p-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500">Patient</p>
                <p className="font-medium">{plan.patient.user.name}</p>
                <p className="text-xs text-gray-500">{plan.patient.mrNumber}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Invoice</p>
                <Link
                  href={`/dashboard/billing/${plan.invoice.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {plan.invoice.invoiceNumber}
                </Link>
                <p className="text-xs text-gray-500">
                  Total: {fmtMoney(plan.invoice.totalAmount)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Installments</p>
                <p className="font-medium">
                  {plan.installments} × {fmtMoney(plan.installmentAmount)} (
                  {plan.frequency})
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500">Down Payment</p>
                <p className="font-medium">{fmtMoney(plan.downPayment)}</p>
              </div>
            </div>

            <div className="mt-2 flex items-center gap-2 text-sm">
              <label>Pay mode:</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value)}
                className="rounded border px-2 py-1 text-sm"
              >
                {["CASH", "CARD", "UPI", "ONLINE", "INSURANCE"].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="overflow-hidden rounded-lg border">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr className="text-left text-sm text-gray-500">
                    <th className="px-3 py-2">#</th>
                    <th className="px-3 py-2">Due Date</th>
                    <th className="px-3 py-2">Amount</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {plan.installmentRecords
                    .slice()
                    .sort(
                      (a, b) =>
                        new Date(a.dueDate).getTime() -
                        new Date(b.dueDate).getTime()
                    )
                    .map((r, i) => (
                      <tr key={r.id} className="border-t">
                        <td className="px-3 py-2 text-sm">{i + 1}</td>
                        <td className="px-3 py-2 text-sm">
                          {new Date(r.dueDate).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-2 text-sm">
                          {fmtMoney(r.amount)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              r.status === "PAID"
                                ? "bg-green-100 text-green-700"
                                : r.status === "OVERDUE"
                                  ? "bg-red-100 text-red-700"
                                  : r.status === "WAIVED"
                                    ? "bg-gray-100 text-gray-600"
                                    : "bg-yellow-100 text-yellow-700"
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          {r.status === "PENDING" ||
                          r.status === "OVERDUE" ? (
                            <button
                              disabled={paying === r.id}
                              onClick={() => payInstallment(r.id, r.amount)}
                              className="rounded bg-green-500 px-3 py-1 text-xs font-medium text-white hover:bg-green-600 disabled:opacity-50"
                            >
                              {paying === r.id ? "..." : "Pay"}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
