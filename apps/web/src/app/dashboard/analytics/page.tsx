"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import {
  Users,
  Calendar,
  DollarSign,
  BedDouble,
  AlertTriangle,
  Stethoscope,
  Activity,
  Pill,
  TrendingUp,
  TrendingDown,
} from "lucide-react";

// ─── Types ─────────────────────────────────────────

interface OverviewData {
  totalPatients: number;
  newPatientsInPeriod: number;
  totalAppointments: number;
  appointmentsByStatus: Record<string, number>;
  totalRevenue: number;
  revenueByMode: Record<string, number>;
  pendingBills: number;
  currentlyAdmitted: number;
  avgConsultationTime: number;
}

interface ApptPoint {
  date: string;
  count: number;
  scheduled: number;
  walkin: number;
}

interface RevenuePoint {
  date: string;
  total: number;
  cash: number;
  card: number;
  upi: number;
  online: number;
  insurance: number;
}

interface DoctorStat {
  doctorId: string;
  doctorName: string;
  appointmentCount: number;
  completedCount: number;
  avgDurationMin: number;
  revenue: number;
  patientCount: number;
}

interface DiagnosisItem {
  diagnosis: string;
  count: number;
}

interface Demographics {
  byGender: Record<string, number>;
  byAgeGroup: Record<string, number>;
}

interface Occupancy {
  totalBeds: number;
  occupied: number;
  available: number;
  byWard: Array<{ wardName: string; total: number; occupied: number }>;
}

interface LowStockData {
  count: number;
  items: Array<{
    id: string;
    medicineName: string;
    quantity: number;
    reorderLevel: number;
    batchNumber: string;
  }>;
}

interface DispensedItem {
  medicineName: string;
  dispensed: number;
}

// ─── Formatters ────────────────────────────────────

function formatCurrency(n: number): string {
  return `Rs. ${n.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatShortDate(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

// ─── Chart Components ──────────────────────────────

interface LineChartProps {
  data: Array<Record<string, number | string>>;
  xKey: string;
  yKeys: Array<{ key: string; label: string; color: string }>;
  height?: number;
}

function LineChart({ data, xKey, yKeys, height = 220 }: LineChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center text-sm text-gray-400" style={{ height }}>
        No data for this period
      </div>
    );
  }

  const width = 800;
  const padL = 50;
  const padR = 20;
  const padT = 20;
  const padB = 40;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const maxY = Math.max(
    1,
    ...data.flatMap((d) => yKeys.map((k) => Number(d[k.key] || 0)))
  );
  const step = data.length > 1 ? innerW / (data.length - 1) : innerW;

  const yTicks = 4;
  const tickVals = Array.from({ length: yTicks + 1 }, (_, i) => (maxY * i) / yTicks);

  // Reduce x-axis labels to around 8 max
  const xLabelStride = Math.max(1, Math.ceil(data.length / 8));

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ maxHeight: height + 20 }}>
      {/* gridlines */}
      {tickVals.map((tv, i) => {
        const y = padT + innerH - (tv / maxY) * innerH;
        return (
          <g key={i}>
            <line
              x1={padL}
              x2={padL + innerW}
              y1={y}
              y2={y}
              stroke="#e5e7eb"
              strokeDasharray="3,3"
            />
            <text x={padL - 8} y={y + 4} textAnchor="end" fontSize="10" fill="#6b7280">
              {Math.round(tv).toLocaleString()}
            </text>
          </g>
        );
      })}

      {/* x axis */}
      <line
        x1={padL}
        x2={padL + innerW}
        y1={padT + innerH}
        y2={padT + innerH}
        stroke="#9ca3af"
      />

      {/* x labels */}
      {data.map((d, i) => {
        if (i % xLabelStride !== 0 && i !== data.length - 1) return null;
        const x = padL + i * step;
        return (
          <text
            key={i}
            x={x}
            y={padT + innerH + 18}
            textAnchor="middle"
            fontSize="10"
            fill="#6b7280"
          >
            {formatShortDate(String(d[xKey]))}
          </text>
        );
      })}

      {/* Lines */}
      {yKeys.map((yk) => {
        const points = data
          .map((d, i) => {
            const x = padL + i * step;
            const y = padT + innerH - (Number(d[yk.key] || 0) / maxY) * innerH;
            return `${x},${y}`;
          })
          .join(" ");
        return (
          <g key={yk.key}>
            <polyline
              fill="none"
              stroke={yk.color}
              strokeWidth="2"
              points={points}
            />
            {data.map((d, i) => {
              const x = padL + i * step;
              const y = padT + innerH - (Number(d[yk.key] || 0) / maxY) * innerH;
              return (
                <circle key={i} cx={x} cy={y} r="3" fill={yk.color}>
                  <title>{`${formatShortDate(String(d[xKey]))}: ${yk.label} = ${d[yk.key]}`}</title>
                </circle>
              );
            })}
          </g>
        );
      })}

      {/* Legend */}
      <g>
        {yKeys.map((yk, i) => (
          <g key={yk.key} transform={`translate(${padL + i * 110}, ${padT - 5})`}>
            <rect width="10" height="10" fill={yk.color} />
            <text x="14" y="9" fontSize="11" fill="#374151">
              {yk.label}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

interface BarCategory {
  key: string;
  label: string;
  color: string;
}

interface BarChartProps {
  categories: BarCategory[];
  values: Record<string, number>;
  formatValue?: (n: number) => string;
}

function BarChart({ categories, values, formatValue }: BarChartProps) {
  const max = Math.max(1, ...categories.map((c) => values[c.key] || 0));
  const fmt = formatValue || ((n: number) => String(n));
  return (
    <div className="space-y-3">
      {categories.map((c) => {
        const v = values[c.key] || 0;
        const pct = (v / max) * 100;
        return (
          <div key={c.key}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">{c.label}</span>
              <span className="text-gray-600">{fmt(v)}</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: c.color }}
                title={`${c.label}: ${fmt(v)}`}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  segments: DonutSegment[];
  centerText?: string;
  size?: number;
}

function DonutChart({ segments, centerText, size = 180 }: DonutChartProps) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const radius = size / 2 - 10;
  const strokeW = 28;
  const circumference = 2 * Math.PI * radius;

  if (total === 0) {
    return (
      <div className="flex flex-col items-center">
        <div
          className="flex items-center justify-center rounded-full text-sm text-gray-400"
          style={{ width: size, height: size, border: "28px solid #f3f4f6" }}
        >
          No data
        </div>
      </div>
    );
  }

  let accOffset = 0;

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
          <circle
            r={radius}
            fill="none"
            stroke="#f3f4f6"
            strokeWidth={strokeW}
          />
          {segments.map((seg, i) => {
            const fraction = seg.value / total;
            const dash = fraction * circumference;
            const gap = circumference - dash;
            const circ = (
              <circle
                key={i}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeW}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-accOffset}
              >
                <title>{`${seg.label}: ${seg.value} (${((fraction * 100) | 0)}%)`}</title>
              </circle>
            );
            accOffset += dash;
            return circ;
          })}
        </g>
        {centerText && (
          <text
            x={size / 2}
            y={size / 2 + 5}
            textAnchor="middle"
            fontSize="14"
            fontWeight="600"
            fill="#111827"
          >
            {centerText}
          </text>
        )}
      </svg>
      <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-gray-700">
              {seg.label} ({seg.value})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Section card wrapper ──────────────────────────

function Card({
  title,
  children,
  icon: Icon,
  className,
}: {
  title?: string;
  children: React.ReactNode;
  icon?: React.ElementType;
  className?: string;
}) {
  return (
    <div className={`rounded-xl bg-white p-6 shadow-sm ${className || ""}`}>
      {title && (
        <div className="mb-4 flex items-center gap-2">
          {Icon && <Icon size={18} className="text-gray-500" />}
          <h2 className="font-semibold text-gray-800">{title}</h2>
        </div>
      )}
      {children}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────

const MODE_COLORS: Record<string, string> = {
  CASH: "#059669",
  CARD: "#2563eb",
  UPI: "#7c3aed",
  ONLINE: "#f59e0b",
  INSURANCE: "#dc2626",
};

const GENDER_COLORS: Record<string, string> = {
  MALE: "#2563eb",
  FEMALE: "#ec4899",
  OTHER: "#6b7280",
};

const AGE_COLORS: Record<string, string> = {
  "0-18": "#60a5fa",
  "19-35": "#059669",
  "36-55": "#f59e0b",
  "56+": "#dc2626",
};

function occupancyColor(pct: number): string {
  if (pct < 60) return "#059669";
  if (pct < 85) return "#f59e0b";
  return "#dc2626";
}

function defaultFrom() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().split("T")[0];
}

function today() {
  return new Date().toISOString().split("T")[0];
}

export default function AnalyticsPage() {
  const { user } = useAuthStore();
  const router = useRouter();

  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(today());
  const [pendingFrom, setPendingFrom] = useState(from);
  const [pendingTo, setPendingTo] = useState(to);

  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [prevOverview, setPrevOverview] = useState<OverviewData | null>(null);
  const [appointments, setAppointments] = useState<ApptPoint[]>([]);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [doctors, setDoctors] = useState<DoctorStat[]>([]);
  const [diagnoses, setDiagnoses] = useState<DiagnosisItem[]>([]);
  const [demographics, setDemographics] = useState<Demographics | null>(null);
  const [occupancy, setOccupancy] = useState<Occupancy | null>(null);
  const [lowStock, setLowStock] = useState<LowStockData | null>(null);
  const [dispensed, setDispensed] = useState<DispensedItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<keyof DoctorStat>("appointmentCount");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  useEffect(() => {
    if (user && user.role !== "ADMIN" && user.role !== "RECEPTION") {
      router.push("/dashboard");
    }
  }, [user, router]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const qs = `from=${from}&to=${to}`;

    // Previous period for delta
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const spanMs = toDate.getTime() - fromDate.getTime();
    const prevFrom = new Date(fromDate.getTime() - spanMs - 86400000);
    const prevTo = new Date(fromDate.getTime() - 86400000);
    const prevQs = `from=${prevFrom.toISOString().split("T")[0]}&to=${prevTo
      .toISOString()
      .split("T")[0]}`;

    try {
      const [
        ovRes,
        prevOvRes,
        apptRes,
        revRes,
        docRes,
        diagRes,
        demoRes,
        occRes,
        lowRes,
        dispRes,
      ] = await Promise.all([
        api.get<{ data: OverviewData }>(`/analytics/overview?${qs}`).catch(() => null),
        api.get<{ data: OverviewData }>(`/analytics/overview?${prevQs}`).catch(() => null),
        api.get<{ data: ApptPoint[] }>(`/analytics/appointments?${qs}&groupBy=day`).catch(() => null),
        api.get<{ data: RevenuePoint[] }>(`/analytics/revenue?${qs}&groupBy=day`).catch(() => null),
        api.get<{ data: DoctorStat[] }>(`/analytics/doctors?${qs}`).catch(() => null),
        api.get<{ data: DiagnosisItem[] }>(`/analytics/top-diagnoses?${qs}&limit=10`).catch(() => null),
        api.get<{ data: Demographics }>(`/analytics/patient-demographics`).catch(() => null),
        api.get<{ data: Occupancy }>(`/analytics/ipd/occupancy`).catch(() => null),
        api.get<{ data: LowStockData }>(`/analytics/pharmacy/low-stock`).catch(() => null),
        api.get<{ data: DispensedItem[] }>(`/analytics/pharmacy/top-dispensed?limit=10`).catch(() => null),
      ]);

      setOverview(ovRes?.data || null);
      setPrevOverview(prevOvRes?.data || null);
      setAppointments(apptRes?.data || []);
      setRevenue(revRes?.data || []);
      setDoctors(docRes?.data || []);
      setDiagnoses(diagRes?.data || []);
      setDemographics(demoRes?.data || null);
      setOccupancy(occRes?.data || null);
      setLowStock(lowRes?.data || null);
      setDispensed(dispRes?.data || []);
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const sortedDoctors = useMemo(() => {
    const rows = [...doctors];
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return rows;
  }, [doctors, sortKey, sortDir]);

  function toggleSort(key: keyof DoctorStat) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  if (user && user.role !== "ADMIN" && user.role !== "RECEPTION") return null;

  const patientsDelta =
    overview && prevOverview
      ? overview.newPatientsInPeriod - prevOverview.newPatientsInPeriod
      : 0;
  const apptDelta =
    overview && prevOverview
      ? overview.totalAppointments - prevOverview.totalAppointments
      : 0;
  const revenueDelta =
    overview && prevOverview
      ? overview.totalRevenue - prevOverview.totalRevenue
      : 0;

  return (
    <div>
      {/* Header + filter bar */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Analytics Dashboard</h1>
          <p className="text-sm text-gray-500">
            Insights and trends across hospital operations
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs text-gray-500">From</label>
            <input
              type="date"
              value={pendingFrom}
              onChange={(e) => setPendingFrom(e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs text-gray-500">To</label>
            <input
              type="date"
              value={pendingTo}
              onChange={(e) => setPendingTo(e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={() => {
              setFrom(pendingFrom);
              setTo(pendingTo);
            }}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            Apply
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Total Patients"
          value={overview?.totalPatients ?? 0}
          sub={`+${overview?.newPatientsInPeriod ?? 0} new`}
          delta={patientsDelta}
          icon={Users}
          bg="bg-blue-100"
          color="text-blue-600"
          loading={loading}
        />
        <KpiCard
          label="Appointments"
          value={overview?.totalAppointments ?? 0}
          sub={`${overview?.appointmentsByStatus?.COMPLETED ?? 0} completed`}
          delta={apptDelta}
          icon={Calendar}
          bg="bg-purple-100"
          color="text-purple-600"
          loading={loading}
        />
        <KpiCard
          label="Revenue"
          value={formatCurrency(overview?.totalRevenue ?? 0)}
          sub={`${overview?.pendingBills ?? 0} pending bills`}
          delta={revenueDelta}
          deltaIsMoney
          icon={DollarSign}
          bg="bg-green-100"
          color="text-green-600"
          loading={loading}
        />
        <KpiCard
          label="Currently Admitted"
          value={overview?.currentlyAdmitted ?? 0}
          sub={`Avg consult ${overview?.avgConsultationTime ?? 0} min`}
          icon={BedDouble}
          bg="bg-amber-100"
          color="text-amber-600"
          loading={loading}
        />
      </div>

      {/* Appointment Trends + Revenue over time */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Appointment Trends" icon={Calendar}>
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
          ) : (
            <LineChart
              data={appointments as unknown as Array<Record<string, number | string>>}
              xKey="date"
              yKeys={[
                { key: "scheduled", label: "Scheduled", color: "#2563eb" },
                { key: "walkin", label: "Walk-in", color: "#f59e0b" },
              ]}
            />
          )}
        </Card>

        <Card title="Revenue Over Time" icon={TrendingUp}>
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
          ) : (
            <LineChart
              data={revenue as unknown as Array<Record<string, number | string>>}
              xKey="date"
              yKeys={[{ key: "total", label: "Daily Revenue", color: "#059669" }]}
            />
          )}
        </Card>
      </div>

      {/* Revenue breakdown + Demographics */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Revenue Breakdown by Mode" icon={DollarSign}>
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
          ) : overview ? (
            <>
              <p className="mb-4 text-2xl font-bold text-gray-800">
                {formatCurrency(overview.totalRevenue)}
              </p>
              <BarChart
                categories={[
                  { key: "CASH", label: "Cash", color: MODE_COLORS.CASH },
                  { key: "CARD", label: "Card", color: MODE_COLORS.CARD },
                  { key: "UPI", label: "UPI", color: MODE_COLORS.UPI },
                  { key: "ONLINE", label: "Online", color: MODE_COLORS.ONLINE },
                  {
                    key: "INSURANCE",
                    label: "Insurance",
                    color: MODE_COLORS.INSURANCE,
                  },
                ]}
                values={overview.revenueByMode}
                formatValue={formatCurrency}
              />
            </>
          ) : (
            <p className="text-sm text-gray-400">No data for this period</p>
          )}
        </Card>

        <Card title="Patient Demographics" icon={Users}>
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
          ) : demographics ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="mb-2 text-center text-xs font-medium text-gray-500">
                  By Gender
                </p>
                <DonutChart
                  segments={Object.entries(demographics.byGender).map(([k, v]) => ({
                    label: k,
                    value: v,
                    color: GENDER_COLORS[k] || "#6b7280",
                  }))}
                  centerText={String(
                    Object.values(demographics.byGender).reduce((a, b) => a + b, 0)
                  )}
                />
              </div>
              <div>
                <p className="mb-2 text-center text-xs font-medium text-gray-500">
                  By Age Group
                </p>
                <DonutChart
                  segments={Object.entries(demographics.byAgeGroup).map(([k, v]) => ({
                    label: k,
                    value: v,
                    color: AGE_COLORS[k] || "#6b7280",
                  }))}
                  centerText={String(
                    Object.values(demographics.byAgeGroup).reduce((a, b) => a + b, 0)
                  )}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">No data</p>
          )}
        </Card>
      </div>

      {/* Doctor performance */}
      <div className="mb-6">
        <Card title="Doctor Performance" icon={Stethoscope}>
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
          ) : doctors.length === 0 ? (
            <p className="text-sm text-gray-400">No data for this period</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-gray-500">
                    <SortableTh
                      label="Doctor"
                      active={sortKey === "doctorName"}
                      dir={sortDir}
                      onClick={() => toggleSort("doctorName")}
                    />
                    <SortableTh
                      label="Appointments"
                      active={sortKey === "appointmentCount"}
                      dir={sortDir}
                      onClick={() => toggleSort("appointmentCount")}
                    />
                    <SortableTh
                      label="Completed %"
                      active={sortKey === "completedCount"}
                      dir={sortDir}
                      onClick={() => toggleSort("completedCount")}
                    />
                    <SortableTh
                      label="Avg Time"
                      active={sortKey === "avgDurationMin"}
                      dir={sortDir}
                      onClick={() => toggleSort("avgDurationMin")}
                    />
                    <SortableTh
                      label="Patients"
                      active={sortKey === "patientCount"}
                      dir={sortDir}
                      onClick={() => toggleSort("patientCount")}
                    />
                    <SortableTh
                      label="Revenue"
                      active={sortKey === "revenue"}
                      dir={sortDir}
                      onClick={() => toggleSort("revenue")}
                    />
                  </tr>
                </thead>
                <tbody>
                  {sortedDoctors.map((d) => {
                    const pct =
                      d.appointmentCount > 0
                        ? Math.round((d.completedCount / d.appointmentCount) * 100)
                        : 0;
                    return (
                      <tr key={d.doctorId} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium text-gray-800">
                          {d.doctorName}
                        </td>
                        <td className="px-3 py-2">{d.appointmentCount}</td>
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <span className="w-10 text-gray-600">{pct}%</span>
                            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-100">
                              <span
                                className="block h-full rounded-full bg-green-500"
                                style={{ width: `${pct}%` }}
                              />
                            </span>
                          </span>
                        </td>
                        <td className="px-3 py-2">{d.avgDurationMin} min</td>
                        <td className="px-3 py-2">{d.patientCount}</td>
                        <td className="px-3 py-2 font-medium text-gray-800">
                          {formatCurrency(d.revenue)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Top diagnoses + IPD occupancy */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Top Diagnoses" icon={Activity}>
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
          ) : diagnoses.length === 0 ? (
            <p className="text-sm text-gray-400">No data for this period</p>
          ) : (
            <div className="space-y-2">
              {diagnoses.map((d) => {
                const max = diagnoses[0]?.count || 1;
                const pct = (d.count / max) * 100;
                return (
                  <div key={d.diagnosis}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="truncate pr-2 font-medium text-gray-700">
                        {d.diagnosis}
                      </span>
                      <span className="text-gray-500">{d.count}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card title="IPD Occupancy" icon={BedDouble}>
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
          ) : !occupancy || occupancy.totalBeds === 0 ? (
            <p className="text-sm text-gray-400">No wards configured</p>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Total: </span>
                  <span className="font-semibold">{occupancy.totalBeds}</span>
                </div>
                <div>
                  <span className="text-gray-500">Occupied: </span>
                  <span className="font-semibold text-amber-600">
                    {occupancy.occupied}
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Available: </span>
                  <span className="font-semibold text-green-600">
                    {occupancy.available}
                  </span>
                </div>
              </div>
              <div className="space-y-3">
                {occupancy.byWard.map((w) => {
                  const pct = w.total > 0 ? (w.occupied / w.total) * 100 : 0;
                  return (
                    <div key={w.wardName}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="font-medium text-gray-700">
                          {w.wardName}
                        </span>
                        <span className="text-gray-500">
                          {w.occupied}/{w.total} ({Math.round(pct)}%)
                        </span>
                      </div>
                      <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${pct}%`,
                            backgroundColor: occupancyColor(pct),
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Card>
      </div>

      {/* Pharmacy insights */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1" title="Low Stock Alert" icon={AlertTriangle}>
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
          ) : lowStock ? (
            <div>
              <div
                className={`mb-3 rounded-lg p-4 ${
                  lowStock.count > 0
                    ? "bg-red-50 text-red-700"
                    : "bg-green-50 text-green-700"
                }`}
              >
                <p className="text-xs uppercase tracking-wide">Items below reorder level</p>
                <p className="text-3xl font-bold">{lowStock.count}</p>
              </div>
              {lowStock.items.length > 0 && (
                <ul className="space-y-1 text-xs">
                  {lowStock.items.slice(0, 6).map((it) => (
                    <li
                      key={it.id}
                      className="flex items-center justify-between rounded bg-gray-50 px-2 py-1.5"
                    >
                      <span className="truncate pr-2 font-medium text-gray-700">
                        {it.medicineName}
                      </span>
                      <span className="text-red-600">
                        {it.quantity} / {it.reorderLevel}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-400">No data</p>
          )}
        </Card>

        <Card className="lg:col-span-2" title="Top Dispensed Medicines" icon={Pill}>
          {loading ? (
            <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
          ) : dispensed.length === 0 ? (
            <p className="text-sm text-gray-400">No dispensing data</p>
          ) : (
            <div className="space-y-2">
              {dispensed.map((d) => {
                const max = dispensed[0]?.dispensed || 1;
                const pct = (d.dispensed / max) * 100;
                return (
                  <div key={d.medicineName}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="truncate pr-2 font-medium text-gray-700">
                        {d.medicineName}
                      </span>
                      <span className="text-gray-500">{d.dispensed} units</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                      <div
                        className="h-full rounded-full bg-secondary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  delta,
  deltaIsMoney,
  icon: Icon,
  bg,
  color,
  loading,
}: {
  label: string;
  value: number | string;
  sub?: string;
  delta?: number;
  deltaIsMoney?: boolean;
  icon: React.ElementType;
  bg: string;
  color: string;
  loading?: boolean;
}) {
  const showDelta = delta !== undefined && delta !== 0;
  const positive = (delta || 0) >= 0;
  return (
    <div className="rounded-xl bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${bg}`}>
          <Icon size={20} className={color} />
        </div>
        {showDelta && (
          <span
            className={`flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-medium ${
              positive ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
            }`}
          >
            {positive ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
            {deltaIsMoney
              ? formatCurrency(Math.abs(delta!))
              : Math.abs(delta!).toLocaleString()}
          </span>
        )}
      </div>
      <p className="mt-3 text-sm text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900">
        {loading ? "..." : value}
      </p>
      {sub && <p className="mt-1 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

function SortableTh({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th
      className="cursor-pointer select-none px-3 py-2 text-xs font-medium uppercase tracking-wide hover:text-gray-700"
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <span className="text-[10px]">{dir === "asc" ? "▲" : "▼"}</span>}
      </span>
    </th>
  );
}
