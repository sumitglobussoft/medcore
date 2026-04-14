"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { Plus, Hotel, TrendingUp } from "lucide-react";

interface Bed {
  id: string;
  bedNumber: string;
  status: "AVAILABLE" | "OCCUPIED" | "CLEANING" | "MAINTENANCE";
  wardId: string;
}

interface Ward {
  id: string;
  name: string;
  type: string;
  floor: string | number | null;
  description?: string | null;
  beds?: Bed[];
  totalBeds?: number;
  availableBeds?: number;
  occupiedBeds?: number;
  cleaningBeds?: number;
  maintenanceBeds?: number;
}

const STATUS_COLORS: Record<string, string> = {
  AVAILABLE: "bg-green-500 hover:bg-green-600",
  OCCUPIED: "bg-red-500 hover:bg-red-600",
  CLEANING: "bg-yellow-500 hover:bg-yellow-600",
  MAINTENANCE: "bg-gray-500 hover:bg-gray-600",
};

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: "Available",
  OCCUPIED: "Occupied",
  CLEANING: "Cleaning",
  MAINTENANCE: "Maintenance",
};

const WARD_TYPES = [
  "GENERAL",
  "PRIVATE",
  "SEMI_PRIVATE",
  "ICU",
  "NICU",
  "PICU",
  "MATERNITY",
  "EMERGENCY",
  "ISOLATION",
];

export default function WardsPage() {
  const { user } = useAuthStore();
  const [wards, setWards] = useState<Ward[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showWardModal, setShowWardModal] = useState(false);
  const [tab, setTab] = useState<"beds" | "forecast">("beds");
  const [showBedModal, setShowBedModal] = useState<string | null>(null);
  const [wardForm, setWardForm] = useState({
    name: "",
    type: "GENERAL",
    floor: "",
    description: "",
  });
  const [bedForm, setBedForm] = useState({ bedNumber: "" });

  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    loadWards();
  }, []);

  async function loadWards() {
    setLoading(true);
    try {
      const res = await api.get<{ data: Ward[] }>("/wards");
      setWards(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  function computeCounts(ward: Ward) {
    const beds = ward.beds || [];
    const total = ward.totalBeds ?? beds.length;
    const available =
      ward.availableBeds ?? beds.filter((b) => b.status === "AVAILABLE").length;
    const occupied =
      ward.occupiedBeds ?? beds.filter((b) => b.status === "OCCUPIED").length;
    const cleaning =
      ward.cleaningBeds ?? beds.filter((b) => b.status === "CLEANING").length;
    const maintenance =
      ward.maintenanceBeds ??
      beds.filter((b) => b.status === "MAINTENANCE").length;
    return { total, available, occupied, cleaning, maintenance };
  }

  const totals = wards.reduce(
    (acc, w) => {
      const c = computeCounts(w);
      return {
        total: acc.total + c.total,
        available: acc.available + c.available,
        occupied: acc.occupied + c.occupied,
      };
    },
    { total: 0, available: 0, occupied: 0 }
  );

  async function createWard(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/wards", {
        name: wardForm.name,
        type: wardForm.type,
        floor: wardForm.floor || undefined,
        description: wardForm.description || undefined,
      });
      setShowWardModal(false);
      setWardForm({ name: "", type: "GENERAL", floor: "", description: "" });
      loadWards();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create ward");
    }
  }

  async function addBed(e: React.FormEvent, wardId: string) {
    e.preventDefault();
    try {
      await api.post(`/wards/${wardId}/beds`, {
        bedNumber: bedForm.bedNumber,
      });
      setShowBedModal(null);
      setBedForm({ bedNumber: "" });
      loadWards();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add bed");
    }
  }

  async function updateBedStatus(bedId: string, status: string) {
    try {
      await api.patch(`/beds/${bedId}/status`, { status });
      loadWards();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update bed");
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Wards &amp; Beds</h1>
          <p className="text-sm text-gray-500">
            {totals.available} available · {totals.occupied} occupied ·{" "}
            {totals.total} total beds
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowWardModal(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            <Plus size={16} /> Add Ward
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-slate-200">
        <button
          onClick={() => setTab("beds")}
          className={`px-3 py-2 text-sm border-b-2 -mb-0.5 ${
            tab === "beds"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-slate-600"
          }`}
        >
          Beds
        </button>
        <button
          onClick={() => setTab("forecast")}
          className={`inline-flex items-center gap-1 px-3 py-2 text-sm border-b-2 -mb-0.5 ${
            tab === "forecast"
              ? "border-primary text-primary font-semibold"
              : "border-transparent text-slate-600"
          }`}
        >
          <TrendingUp size={14} /> Forecast
        </button>
      </div>

      {tab === "forecast" ? (
        <OccupancyForecast />
      ) : (
        <>
      {/* Summary cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Total Beds</p>
          <p className="mt-1 text-3xl font-bold">{totals.total}</p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Available</p>
          <p className="mt-1 text-3xl font-bold text-green-600">
            {totals.available}
          </p>
        </div>
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <p className="text-sm text-gray-500">Occupied</p>
          <p className="mt-1 text-3xl font-bold text-red-600">
            {totals.occupied}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
          Loading...
        </div>
      ) : wards.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
          No wards yet. {isAdmin && 'Click "Add Ward" to create one.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {wards.map((ward) => {
            const c = computeCounts(ward);
            const occupiedPct = c.total ? (c.occupied / c.total) * 100 : 0;
            const availablePct = c.total ? (c.available / c.total) * 100 : 0;
            const cleaningPct = c.total ? (c.cleaning / c.total) * 100 : 0;
            const isExpanded = expanded === ward.id;
            return (
              <div
                key={ward.id}
                className={`rounded-xl bg-white p-5 shadow-sm transition ${
                  isExpanded ? "md:col-span-2 lg:col-span-3" : ""
                }`}
              >
                <button
                  onClick={() => setExpanded(isExpanded ? null : ward.id)}
                  className="w-full text-left"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Hotel className="text-primary" size={20} />
                      <h3 className="font-semibold">{ward.name}</h3>
                    </div>
                    <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      {ward.type.replace(/_/g, " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500">
                    Floor {ward.floor ?? "—"}
                  </p>

                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span>
                      <span className="font-semibold">{c.total}</span> total
                    </span>
                    <span className="text-green-600">{c.available} avail</span>
                    <span className="text-red-600">{c.occupied} occ</span>
                    <span className="text-yellow-600">{c.cleaning} clean</span>
                  </div>

                  {/* Progress bar */}
                  <div className="mt-2 flex h-2 w-full overflow-hidden rounded bg-gray-200">
                    <div
                      className="bg-red-500"
                      style={{ width: `${occupiedPct}%` }}
                    />
                    <div
                      className="bg-yellow-500"
                      style={{ width: `${cleaningPct}%` }}
                    />
                    <div
                      className="bg-green-500"
                      style={{ width: `${availablePct}%` }}
                    />
                  </div>
                </button>

                {isExpanded && (
                  <div className="mt-4 border-t pt-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-semibold">Beds</h4>
                      {isAdmin && (
                        <button
                          onClick={() => setShowBedModal(ward.id)}
                          className="flex items-center gap-1 rounded bg-primary px-2 py-1 text-xs text-white hover:bg-primary-dark"
                        >
                          <Plus size={12} /> Add Bed
                        </button>
                      )}
                    </div>
                    {(ward.beds || []).length === 0 ? (
                      <p className="text-sm text-gray-500">No beds yet.</p>
                    ) : (
                      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
                        {ward.beds!.map((bed) => (
                          <BedCell
                            key={bed.id}
                            bed={bed}
                            onChange={updateBedStatus}
                          />
                        ))}
                      </div>
                    )}

                    {/* Add Bed inline form */}
                    {showBedModal === ward.id && (
                      <form
                        onSubmit={(e) => addBed(e, ward.id)}
                        className="mt-4 flex gap-2"
                      >
                        <input
                          required
                          placeholder="Bed Number"
                          value={bedForm.bedNumber}
                          onChange={(e) =>
                            setBedForm({ bedNumber: e.target.value })
                          }
                          className="flex-1 rounded-lg border px-3 py-2 text-sm"
                        />
                        <button
                          type="submit"
                          className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-white hover:bg-primary-dark"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowBedModal(null)}
                          className="rounded-lg border px-3 py-2 text-sm"
                        >
                          Cancel
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
        </>
      )}

      {/* Add Ward Modal */}
      {showWardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <form
            onSubmit={createWard}
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 className="mb-4 text-lg font-semibold">Add New Ward</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <input
                  required
                  value={wardForm.name}
                  onChange={(e) =>
                    setWardForm({ ...wardForm, name: e.target.value })
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Type</label>
                <select
                  value={wardForm.type}
                  onChange={(e) =>
                    setWardForm({ ...wardForm, type: e.target.value })
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                >
                  {WARD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Floor</label>
                <input
                  value={wardForm.floor}
                  onChange={(e) =>
                    setWardForm({ ...wardForm, floor: e.target.value })
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Description
                </label>
                <textarea
                  value={wardForm.description}
                  onChange={(e) =>
                    setWardForm({ ...wardForm, description: e.target.value })
                  }
                  rows={3}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowWardModal(false)}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
              >
                Create Ward
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

interface ForecastDay {
  date: string;
  predictedOccupancy: number;
  totalBeds: number;
  occupancyPercent: number;
  incomingAdmissions: number;
  expectedDischarges: number;
}

function OccupancyForecast() {
  const [data, setData] = useState<ForecastDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ data: ForecastDay[] }>(
          "/admissions/forecast?days=7"
        );
        setData(res.data || []);
      } catch {
        setData([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading)
    return <div className="p-8 text-center text-slate-500">Loading forecast...</div>;
  if (data.length === 0)
    return (
      <div className="p-8 text-center text-slate-500 border border-dashed rounded-lg">
        No forecast data.
      </div>
    );

  const maxOcc = Math.max(100, ...data.map((d) => d.occupancyPercent));

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Next 7 Days Predicted Occupancy</h3>
          <span className="text-xs text-slate-500">
            based on expected LOS, scheduled surgeries, and planned admissions
          </span>
        </div>
        {/* SVG line chart */}
        <svg viewBox="0 0 700 200" className="w-full h-48">
          <polyline
            fill="none"
            stroke="#3b82f6"
            strokeWidth="2"
            points={data
              .map((d, i) => {
                const x = (i / Math.max(1, data.length - 1)) * 680 + 10;
                const y = 180 - (d.occupancyPercent / maxOcc) * 160;
                return `${x},${y}`;
              })
              .join(" ")}
          />
          {data.map((d, i) => {
            const x = (i / Math.max(1, data.length - 1)) * 680 + 10;
            const y = 180 - (d.occupancyPercent / maxOcc) * 160;
            return (
              <g key={d.date}>
                <circle cx={x} cy={y} r="3" fill="#3b82f6" />
                <text x={x} y={195} fontSize="9" textAnchor="middle" fill="#64748b">
                  {d.date.slice(5)}
                </text>
                <text x={x} y={y - 6} fontSize="9" textAnchor="middle" fill="#1e293b">
                  {d.occupancyPercent}%
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="bg-white border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600 uppercase">
            <tr>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-right">Predicted</th>
              <th className="px-3 py-2 text-right">Total Beds</th>
              <th className="px-3 py-2 text-right">Incoming</th>
              <th className="px-3 py-2 text-right">Discharges</th>
              <th className="px-3 py-2 text-right">% Occ</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.date} className="border-t border-slate-100">
                <td className="px-3 py-2">{d.date}</td>
                <td className="px-3 py-2 text-right font-semibold">
                  {d.predictedOccupancy}
                </td>
                <td className="px-3 py-2 text-right">{d.totalBeds}</td>
                <td className="px-3 py-2 text-right text-green-700">
                  {d.incomingAdmissions}
                </td>
                <td className="px-3 py-2 text-right text-amber-700">
                  {d.expectedDischarges}
                </td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={`px-2 py-0.5 rounded text-xs ${
                      d.occupancyPercent >= 90
                        ? "bg-red-100 text-red-700"
                        : d.occupancyPercent >= 75
                          ? "bg-amber-100 text-amber-700"
                          : "bg-green-100 text-green-700"
                    }`}
                  >
                    {d.occupancyPercent}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BedCell({
  bed,
  onChange,
}: {
  bed: Bed;
  onChange: (id: string, status: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex h-16 w-full flex-col items-center justify-center rounded-lg text-white ${STATUS_COLORS[bed.status]}`}
        title={STATUS_LABELS[bed.status]}
      >
        <span className="text-xs font-semibold">{bed.bedNumber}</span>
        <span className="text-[10px]">{STATUS_LABELS[bed.status]}</span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border bg-white shadow-lg">
          {Object.keys(STATUS_COLORS).map((s) => (
            <button
              key={s}
              onClick={() => {
                onChange(bed.id, s);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
