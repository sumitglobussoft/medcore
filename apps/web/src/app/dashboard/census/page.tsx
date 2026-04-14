"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Calendar, TrendingUp, BedDouble, Activity } from "lucide-react";

interface CensusDay {
  date: string;
  totalBeds: number;
  admittedAtStartOfDay: number;
  newAdmissions: number;
  discharges: number;
  deaths: number;
  admittedAtEndOfDay: number;
  occupancyPercent: number;
}

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function CensusPage() {
  const [mode, setMode] = useState<"day" | "week" | "month">("week");
  const [singleDate, setSingleDate] = useState(toIso(new Date()));
  const [data, setData] = useState<CensusDay[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (mode === "day") {
          const res = await api.get<{ data: CensusDay }>(
            `/admissions/census/daily?date=${singleDate}`
          );
          setData(res.data ? [res.data] : []);
        } else {
          const days = mode === "week" ? 7 : 30;
          const to = new Date();
          const from = new Date();
          from.setDate(from.getDate() - (days - 1));
          const res = await api.get<{ data: CensusDay[] }>(
            `/admissions/census/range?from=${toIso(from)}&to=${toIso(to)}`
          );
          setData(res.data || []);
        }
      } catch {
        setData([]);
      } finally {
        setLoading(false);
      }
    })();
  }, [mode, singleDate]);

  const totals = data.reduce(
    (acc, r) => {
      acc.newAdmissions += r.newAdmissions;
      acc.discharges += r.discharges;
      acc.deaths += r.deaths;
      return acc;
    },
    { newAdmissions: 0, discharges: 0, deaths: 0 }
  );

  const avgOccupancy =
    data.length > 0
      ? Math.round(data.reduce((s, r) => s + r.occupancyPercent, 0) / data.length)
      : 0;

  const maxOccupancy = Math.max(100, ...data.map((r) => r.occupancyPercent));

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Census Report</h1>
          <p className="text-sm text-slate-600">Daily inpatient occupancy & movement</p>
        </div>
        <div className="flex gap-2">
          {(["day", "week", "month"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 text-sm rounded border ${
                mode === m
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white border-slate-200 text-slate-700 hover:border-blue-400"
              }`}
            >
              {m === "day" ? "Daily" : m === "week" ? "Weekly" : "Monthly"}
            </button>
          ))}
        </div>
      </div>

      {mode === "day" && (
        <div className="mb-4 flex items-center gap-2">
          <Calendar className="h-4 w-4 text-slate-500" />
          <input
            type="date"
            value={singleDate}
            onChange={(e) => setSingleDate(e.target.value)}
            className="border border-slate-200 rounded px-2 py-1 text-sm"
          />
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="p-4 bg-white border border-slate-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <TrendingUp className="h-4 w-4" /> New Admissions
          </div>
          <div className="text-2xl font-bold mt-1">{totals.newAdmissions}</div>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <BedDouble className="h-4 w-4" /> Discharges
          </div>
          <div className="text-2xl font-bold mt-1">{totals.discharges}</div>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Activity className="h-4 w-4" /> Deaths
          </div>
          <div className="text-2xl font-bold mt-1">{totals.deaths}</div>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-lg">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            Avg. Occupancy
          </div>
          <div className="text-2xl font-bold mt-1">{avgOccupancy}%</div>
        </div>
      </div>

      {/* Simple bar chart */}
      {data.length > 1 && (
        <div className="mb-6 p-4 bg-white border border-slate-200 rounded-lg">
          <div className="text-sm font-semibold mb-3">Occupancy Trend</div>
          <div className="flex items-end gap-1 h-40">
            {data.map((r) => (
              <div key={r.date} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-blue-500 rounded-t"
                  style={{ height: `${(r.occupancyPercent / maxOccupancy) * 100}%` }}
                  title={`${r.date}: ${r.occupancyPercent}%`}
                />
                <div className="text-[10px] text-slate-500 rotate-45 origin-left mt-1 w-8">
                  {r.date.slice(5)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-500">Loading...</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
              <tr>
                <th className="px-3 py-2 text-left">Date</th>
                <th className="px-3 py-2 text-right">Start</th>
                <th className="px-3 py-2 text-right">New</th>
                <th className="px-3 py-2 text-right">Discharge</th>
                <th className="px-3 py-2 text-right">Deaths</th>
                <th className="px-3 py-2 text-right">End</th>
                <th className="px-3 py-2 text-right">Beds</th>
                <th className="px-3 py-2 text-right">% Occ</th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.date} className="border-t border-slate-100">
                  <td className="px-3 py-2">{r.date}</td>
                  <td className="px-3 py-2 text-right">{r.admittedAtStartOfDay}</td>
                  <td className="px-3 py-2 text-right text-green-700">{r.newAdmissions}</td>
                  <td className="px-3 py-2 text-right text-amber-700">{r.discharges}</td>
                  <td className="px-3 py-2 text-right text-red-700">{r.deaths}</td>
                  <td className="px-3 py-2 text-right font-semibold">{r.admittedAtEndOfDay}</td>
                  <td className="px-3 py-2 text-right">{r.totalBeds}</td>
                  <td className="px-3 py-2 text-right">
                    <span
                      className={`px-2 py-0.5 rounded text-xs ${
                        r.occupancyPercent >= 90
                          ? "bg-red-100 text-red-700"
                          : r.occupancyPercent >= 75
                            ? "bg-amber-100 text-amber-700"
                            : "bg-green-100 text-green-700"
                      }`}
                    >
                      {r.occupancyPercent}%
                    </span>
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
