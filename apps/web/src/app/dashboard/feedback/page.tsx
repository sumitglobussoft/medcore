"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Feedback {
  id: string;
  category: string;
  rating: number;
  nps: number | null;
  comment: string | null;
  submittedAt: string;
  patient?: { user: { name: string; phone: string } };
}

interface Summary {
  totalCount: number;
  overallAvg: number;
  avgRatingByCategory: Record<string, number>;
  npsScore: number;
  npsSampleSize: number;
  promoters: number;
  detractors: number;
  passives: number;
  trend: Array<{ month: string; avgRating: number; count: number }>;
}

const CATEGORIES = [
  "DOCTOR",
  "NURSE",
  "RECEPTION",
  "CLEANLINESS",
  "FOOD",
  "WAITING_TIME",
  "BILLING",
  "OVERALL",
];

function StarDisplay({ rating }: { rating: number }) {
  return (
    <span className="text-yellow-500">
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n}>{n <= rating ? "\u2605" : "\u2606"}</span>
      ))}
    </span>
  );
}

export default function FeedbackPage() {
  const [feedbacks, setFeedbacks] = useState<Feedback[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [category, setCategory] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, from, to]);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (category) qs.set("category", category);
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      qs.set("limit", "50");

      const [listRes, sumRes] = await Promise.all([
        api.get<{ data: Feedback[] }>(`/feedback?${qs.toString()}`),
        api.get<{ data: Summary }>(
          `/feedback/summary?${from ? `from=${from}` : ""}${to ? `&to=${to}` : ""}`
        ),
      ]);
      setFeedbacks(listRes.data);
      setSummary(sumRes.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  const nps = summary?.npsScore ?? 0;
  const npsColor =
    nps > 50
      ? "bg-green-100 text-green-700"
      : nps >= 0
        ? "bg-yellow-100 text-yellow-700"
        : "bg-red-100 text-red-700";

  const thisMonthCount =
    summary?.trend?.[summary.trend.length - 1]?.count ?? 0;

  const maxCatAvg = Math.max(
    5,
    ...Object.values(summary?.avgRatingByCategory || {})
  );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold">Patient Feedback</h1>

      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className={`rounded-xl p-5 shadow-sm ${npsColor}`}>
          <p className="text-xs font-medium opacity-80">NPS Score</p>
          <p className="mt-1 text-3xl font-bold">{nps}</p>
          <p className="mt-1 text-xs opacity-70">
            {summary?.promoters || 0} promoters,{" "}
            {summary?.detractors || 0} detractors ({summary?.npsSampleSize || 0}{" "}
            responses)
          </p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-gray-500">Overall Avg Rating</p>
          <p className="mt-1 text-3xl font-bold text-gray-800">
            {summary?.overallAvg.toFixed(2) ?? "0.00"}
          </p>
          <div className="mt-1 text-sm">
            <StarDisplay rating={Math.round(summary?.overallAvg ?? 0)} />
          </div>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-xs font-medium text-gray-500">
            Feedback Count (This Month)
          </p>
          <p className="mt-1 text-3xl font-bold text-gray-800">
            {thisMonthCount}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Total in range: {summary?.totalCount ?? 0}
          </p>
        </div>
      </div>

      {/* Category bar chart */}
      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">Average Rating by Category</h2>
        <div className="space-y-3">
          {CATEGORIES.map((c) => {
            const v = summary?.avgRatingByCategory[c] ?? 0;
            const pct = (v / 5) * 100;
            return (
              <div key={c} className="flex items-center gap-3">
                <div className="w-32 text-sm text-gray-600">
                  {c.replace(/_/g, " ")}
                </div>
                <div className="relative h-6 flex-1 rounded bg-gray-100">
                  <div
                    className="h-full rounded bg-primary"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="w-12 text-sm font-semibold text-gray-700">
                  {v.toFixed(2)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            Category
          </label>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          >
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            From
          </label>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-gray-600">
            To
          </label>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="rounded-lg border px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : feedbacks.length === 0 ? (
          <div className="p-8 text-center text-gray-500">No feedback yet</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-gray-500">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Rating</th>
                <th className="px-4 py-3">NPS</th>
                <th className="px-4 py-3">Comment</th>
              </tr>
            </thead>
            <tbody>
              {feedbacks.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {new Date(f.submittedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {f.patient?.user.name || "-"}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {f.category.replace(/_/g, " ")}
                  </td>
                  <td className="px-4 py-3">
                    <StarDisplay rating={f.rating} />
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {f.nps !== null ? f.nps : "-"}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {f.comment
                      ? f.comment.length > 60
                        ? f.comment.slice(0, 60) + "..."
                        : f.comment
                      : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
