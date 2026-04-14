"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { ArrowLeft, Plus, Baby } from "lucide-react";

interface GrowthRecord {
  id: string;
  measurementDate: string;
  ageMonths: number;
  weightKg?: number | null;
  heightCm?: number | null;
  headCircumference?: number | null;
  bmi?: number | null;
  weightPercentile?: number | null;
  heightPercentile?: number | null;
  milestoneNotes?: string | null;
  developmentalNotes?: string | null;
}

interface Patient {
  id: string;
  mrNumber: string;
  dateOfBirth?: string | null;
  age?: number | null;
  gender: string;
  user: { name: string; phone?: string };
}

const MILESTONE_MARKERS: Array<{ ageMonths: number; label: string }> = [
  { ageMonths: 2, label: "Smile" },
  { ageMonths: 4, label: "Head Control" },
  { ageMonths: 6, label: "Sit" },
  { ageMonths: 9, label: "Crawl" },
  { ageMonths: 12, label: "Walk" },
  { ageMonths: 18, label: "First Words" },
  { ageMonths: 24, label: "Sentences" },
];

export default function PediatricDetailPage() {
  const params = useParams();
  const patientId = params.patientId as string;
  const { user } = useAuthStore();

  const [patient, setPatient] = useState<Patient | null>(null);
  const [records, setRecords] = useState<GrowthRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    ageMonths: "",
    weightKg: "",
    heightCm: "",
    headCircumference: "",
    milestoneNotes: "",
    developmentalNotes: "",
    measurementDate: new Date().toISOString().slice(0, 10),
  });

  const canEdit =
    user?.role === "DOCTOR" || user?.role === "ADMIN" || user?.role === "NURSE";

  useEffect(() => {
    load();
  }, [patientId]);

  async function load() {
    setLoading(true);
    try {
      const [patRes, growthRes] = await Promise.all([
        api.get<{ data: Patient }>(`/patients/${patientId}`),
        api.get<{ data: GrowthRecord[] }>(`/growth/patient/${patientId}`),
      ]);
      setPatient(patRes.data);
      setRecords(growthRes.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  // Compute default age months from DOB
  const defaultAgeMonths = useMemo(() => {
    if (!patient?.dateOfBirth) return "";
    const diff = Date.now() - new Date(patient.dateOfBirth).getTime();
    return String(Math.floor(diff / (30.44 * 24 * 60 * 60 * 1000)));
  }, [patient]);

  useEffect(() => {
    if (defaultAgeMonths && !form.ageMonths) {
      setForm((f) => ({ ...f, ageMonths: defaultAgeMonths }));
    }
  }, [defaultAgeMonths]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/growth", {
        patientId,
        measurementDate: form.measurementDate,
        ageMonths: parseInt(form.ageMonths),
        weightKg: form.weightKg ? parseFloat(form.weightKg) : undefined,
        heightCm: form.heightCm ? parseFloat(form.heightCm) : undefined,
        headCircumference: form.headCircumference
          ? parseFloat(form.headCircumference)
          : undefined,
        milestoneNotes: form.milestoneNotes || undefined,
        developmentalNotes: form.developmentalNotes || undefined,
      });
      setShowForm(false);
      setForm({
        ageMonths: defaultAgeMonths,
        weightKg: "",
        heightCm: "",
        headCircumference: "",
        milestoneNotes: "",
        developmentalNotes: "",
        measurementDate: new Date().toISOString().slice(0, 10),
      });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add measurement");
    }
  }

  // Build chart SVG data
  const chartW = 700;
  const chartH = 260;
  const padL = 40;
  const padR = 20;
  const padT = 20;
  const padB = 30;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  function buildChart(
    data: Array<{ ageMonths: number; value: number | null | undefined }>,
    color: string,
    yMax: number,
    yLabel: string
  ) {
    const maxAge = Math.max(
      24,
      ...records.map((r) => r.ageMonths),
      ...MILESTONE_MARKERS.map((m) => m.ageMonths)
    );
    const scaleX = (age: number) => padL + (age / maxAge) * innerW;
    const scaleY = (v: number) => padT + innerH - (v / yMax) * innerH;

    const points = data
      .filter((d) => d.value != null)
      .sort((a, b) => a.ageMonths - b.ageMonths);

    const path = points
      .map(
        (p, i) => `${i === 0 ? "M" : "L"} ${scaleX(p.ageMonths)} ${scaleY(p.value!)}`
      )
      .join(" ");

    return (
      <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full">
        {/* Y grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((r) => {
          const y = padT + innerH * (1 - r);
          return (
            <g key={r}>
              <line
                x1={padL}
                x2={chartW - padR}
                y1={y}
                y2={y}
                stroke="#eee"
                strokeWidth={1}
              />
              <text x={5} y={y + 4} fontSize={10} fill="#999">
                {Math.round(yMax * r)}
              </text>
            </g>
          );
        })}
        {/* X axis labels */}
        {[0, 6, 12, 18, 24, 36, 48, 60].filter((m) => m <= maxAge).map((m) => (
          <g key={m}>
            <line
              x1={scaleX(m)}
              x2={scaleX(m)}
              y1={padT}
              y2={padT + innerH}
              stroke="#f3f4f6"
              strokeWidth={1}
            />
            <text x={scaleX(m) - 8} y={chartH - 10} fontSize={10} fill="#999">
              {m}m
            </text>
          </g>
        ))}
        {/* Milestone markers */}
        {MILESTONE_MARKERS.filter((m) => m.ageMonths <= maxAge).map((m) => (
          <g key={m.label}>
            <line
              x1={scaleX(m.ageMonths)}
              x2={scaleX(m.ageMonths)}
              y1={padT}
              y2={padT + innerH}
              stroke="#fbbf24"
              strokeDasharray="3 3"
              strokeWidth={1}
            />
            <text
              x={scaleX(m.ageMonths) + 2}
              y={padT + 10}
              fontSize={9}
              fill="#b45309"
            >
              {m.label}
            </text>
          </g>
        ))}
        {/* Line + points */}
        {path && <path d={path} fill="none" stroke={color} strokeWidth={2} />}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={scaleX(p.ageMonths)}
            cy={scaleY(p.value!)}
            r={4}
            fill={color}
          />
        ))}
        {/* Axis label */}
        <text x={padL} y={padT - 5} fontSize={11} fill="#374151" fontWeight={600}>
          {yLabel}
        </text>
      </svg>
    );
  }

  if (loading || !patient) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

  const weightData = records.map((r) => ({
    ageMonths: r.ageMonths,
    value: r.weightKg,
  }));
  const heightData = records.map((r) => ({
    ageMonths: r.ageMonths,
    value: r.heightCm,
  }));
  const hcData = records.map((r) => ({
    ageMonths: r.ageMonths,
    value: r.headCircumference,
  }));

  const maxWeight = Math.max(20, ...records.map((r) => r.weightKg || 0)) * 1.1;
  const maxHeight = Math.max(120, ...records.map((r) => r.heightCm || 0)) * 1.1;
  const maxHC =
    Math.max(55, ...records.map((r) => r.headCircumference || 0)) * 1.1;

  return (
    <div>
      <Link
        href="/dashboard/pediatric"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-primary"
      >
        <ArrowLeft size={14} /> Back to Pediatric
      </Link>

      {/* Patient Info */}
      <div className="mb-6 rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">{patient.user.name}</h1>
            <p className="text-sm text-gray-500">
              MR: {patient.mrNumber} · {patient.gender}
              {patient.dateOfBirth &&
                ` · DOB ${new Date(patient.dateOfBirth).toLocaleDateString()}`}
            </p>
            {defaultAgeMonths && (
              <p className="mt-1 text-sm">
                <strong>Current Age:</strong> {defaultAgeMonths} months
              </p>
            )}
          </div>
          {canEdit && (
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark"
            >
              <Plus size={14} /> Add Measurement
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={submit}
          className="mb-6 rounded-xl bg-white p-5 shadow-sm"
        >
          <h3 className="mb-3 font-semibold">Record Growth Measurement</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Date</label>
              <input
                type="date"
                value={form.measurementDate}
                onChange={(e) =>
                  setForm({ ...form, measurementDate: e.target.value })
                }
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Age (months)
              </label>
              <input
                type="number"
                required
                min={0}
                value={form.ageMonths}
                onChange={(e) => setForm({ ...form, ageMonths: e.target.value })}
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Weight (kg)</label>
              <input
                type="number"
                step="0.01"
                value={form.weightKg}
                onChange={(e) => setForm({ ...form, weightKg: e.target.value })}
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Height (cm)</label>
              <input
                type="number"
                step="0.1"
                value={form.heightCm}
                onChange={(e) => setForm({ ...form, heightCm: e.target.value })}
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">
                Head Circ. (cm)
              </label>
              <input
                type="number"
                step="0.1"
                value={form.headCircumference}
                onChange={(e) =>
                  setForm({ ...form, headCircumference: e.target.value })
                }
                className="w-full rounded border px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium">
              Milestone Notes
            </label>
            <input
              value={form.milestoneNotes}
              onChange={(e) =>
                setForm({ ...form, milestoneNotes: e.target.value })
              }
              placeholder="e.g. Started walking, saying 3 words"
              className="w-full rounded border px-2 py-1.5 text-sm"
            />
          </div>
          <div className="mt-3">
            <label className="mb-1 block text-xs font-medium">
              Developmental Notes
            </label>
            <textarea
              rows={2}
              value={form.developmentalNotes}
              onChange={(e) =>
                setForm({ ...form, developmentalNotes: e.target.value })
              }
              className="w-full rounded border px-2 py-1.5 text-sm"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded border px-3 py-1.5 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark"
            >
              Save Measurement
            </button>
          </div>
        </form>
      )}

      {/* Charts */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Weight vs Age</h3>
          {buildChart(weightData, "#3b82f6", maxWeight, "Weight (kg)")}
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Height vs Age</h3>
          {buildChart(heightData, "#10b981", maxHeight, "Height (cm)")}
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold">Head Circumference</h3>
          {buildChart(hcData, "#f59e0b", maxHC, "HC (cm)")}
        </div>
      </div>

      {/* Records Table */}
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <h3 className="mb-4 flex items-center gap-2 font-semibold">
          <Baby size={16} /> Growth Records
        </h3>
        {records.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-500">
            No measurements recorded yet.
          </p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Age (mo)</th>
                <th className="px-3 py-2">Weight</th>
                <th className="px-3 py-2">Wt %ile</th>
                <th className="px-3 py-2">Height</th>
                <th className="px-3 py-2">Ht %ile</th>
                <th className="px-3 py-2">HC</th>
                <th className="px-3 py-2">BMI</th>
                <th className="px-3 py-2">Milestones</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className="border-b text-sm last:border-0">
                  <td className="px-3 py-2">
                    {new Date(r.measurementDate).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">{r.ageMonths}</td>
                  <td className="px-3 py-2">{r.weightKg ? `${r.weightKg} kg` : "—"}</td>
                  <td className="px-3 py-2">
                    {r.weightPercentile != null ? `P${r.weightPercentile}` : "—"}
                  </td>
                  <td className="px-3 py-2">{r.heightCm ? `${r.heightCm} cm` : "—"}</td>
                  <td className="px-3 py-2">
                    {r.heightPercentile != null ? `P${r.heightPercentile}` : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.headCircumference ? `${r.headCircumference} cm` : "—"}
                  </td>
                  <td className="px-3 py-2">{r.bmi ?? "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.milestoneNotes || "—"}
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
