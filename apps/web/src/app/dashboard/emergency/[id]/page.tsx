"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import {
  ArrowLeft,
  Clock,
  Activity,
  UserCheck,
  FileText,
  CheckCircle2,
} from "lucide-react";

const TRIAGE_COLORS: Record<string, string> = {
  RESUSCITATION: "bg-red-900 text-white",
  EMERGENT: "bg-red-500 text-white",
  URGENT: "bg-orange-500 text-white",
  LESS_URGENT: "bg-yellow-500 text-black",
  NON_URGENT: "bg-green-500 text-white",
};

interface PatientLite {
  id: string;
  mrNumber?: string;
  user: { name: string; phone?: string; email?: string };
}
interface DoctorLite {
  id: string;
  specialization?: string;
  user: { name: string };
}

interface EmergencyCase {
  id: string;
  caseNumber: string;
  patientId?: string | null;
  unknownName?: string | null;
  unknownAge?: number | null;
  unknownGender?: string | null;
  arrivedAt: string;
  arrivalMode?: string | null;
  triageLevel?: string | null;
  triagedAt?: string | null;
  triagedBy?: string | null;
  chiefComplaint: string;
  mewsScore?: number | null;
  vitalsBP?: string | null;
  vitalsPulse?: number | null;
  vitalsResp?: number | null;
  vitalsSpO2?: number | null;
  vitalsTemp?: number | null;
  glasgowComa?: number | null;
  attendingDoctorId?: string | null;
  seenAt?: string | null;
  status: string;
  disposition?: string | null;
  outcomeNotes?: string | null;
  closedAt?: string | null;
  patient?: PatientLite | null;
  attendingDoctor?: DoctorLite | null;
}

function fmt(d: string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleString();
}

function elapsedMin(from: string, to?: string | null): number {
  const end = to ? new Date(to).getTime() : Date.now();
  return Math.max(0, Math.floor((end - new Date(from).getTime()) / 60000));
}

export default function EmergencyCaseDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const id = params.id as string;
  const [ecase, setCase] = useState<EmergencyCase | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ data: EmergencyCase }>(
        `/emergency/cases/${id}`
      );
      setCase(res.data);
    } catch {
      setCase(null);
    }
    setLoading(false);
  }

  async function quickAction(action: "cancel") {
    // placeholder for extra actions
    if (action === "cancel") router.push("/dashboard/emergency");
  }

  if (loading) {
    return <div className="p-8 text-gray-500">Loading...</div>;
  }
  if (!ecase) {
    return (
      <div className="p-8 text-gray-500">
        Case not found.{" "}
        <Link href="/dashboard/emergency" className="text-primary hover:underline">
          Back
        </Link>
      </div>
    );
  }

  const displayName =
    ecase.patient?.user.name || ecase.unknownName || "Unknown";
  const triageLevel = ecase.triageLevel || "";

  const timelineEvents = [
    {
      label: "Arrived",
      time: ecase.arrivedAt,
      icon: Clock,
      done: true,
    },
    {
      label: "Triaged",
      time: ecase.triagedAt,
      icon: Activity,
      done: !!ecase.triagedAt,
    },
    {
      label: "Doctor Assigned",
      time: ecase.seenAt,
      icon: UserCheck,
      done: !!ecase.attendingDoctorId,
      extra: ecase.attendingDoctor?.user.name,
    },
    {
      label: "Closed",
      time: ecase.closedAt,
      icon: CheckCircle2,
      done: !!ecase.closedAt,
      extra: ecase.status,
    },
  ];

  const canClose = user?.role === "ADMIN" || user?.role === "DOCTOR";

  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <Link
          href="/dashboard/emergency"
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft size={16} /> Back to ER Board
        </Link>
        <span className="text-xs font-semibold text-gray-400">
          {ecase.caseNumber}
        </span>
      </div>

      <div className="mb-6 rounded-2xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{displayName}</h1>
            {ecase.patient ? (
              <p className="text-sm text-gray-500">
                MR: {ecase.patient.mrNumber || "—"} ·{" "}
                {ecase.patient.user.phone || "—"}
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                {ecase.unknownAge ? `${ecase.unknownAge}y ` : ""}
                {ecase.unknownGender || ""}
                {ecase.arrivalMode ? ` · ${ecase.arrivalMode}` : ""}
              </p>
            )}
            <p className="mt-1 text-sm text-gray-500">
              Arrived {fmt(ecase.arrivedAt)} · {elapsedMin(ecase.arrivedAt, ecase.closedAt)}m
              total
            </p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {triageLevel && (
              <span
                className={`rounded-full px-3 py-1 text-xs font-semibold ${TRIAGE_COLORS[triageLevel]}`}
              >
                {triageLevel.replace("_", " ")}
              </span>
            )}
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
              {ecase.status.replace(/_/g, " ")}
            </span>
          </div>
        </div>

        <div className="mt-5 rounded-lg bg-gray-50 p-4">
          <p className="text-xs font-medium text-gray-500">Chief Complaint</p>
          <p className="mt-1 text-sm text-gray-800">{ecase.chiefComplaint}</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Timeline */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Clock size={18} /> Timeline
          </h2>
          <ol className="space-y-4">
            {timelineEvents.map((e, i) => {
              const Icon = e.icon;
              return (
                <li key={i} className="flex gap-3">
                  <div
                    className={`mt-0.5 flex h-8 w-8 items-center justify-center rounded-full ${
                      e.done ? "bg-primary text-white" : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    <Icon size={14} />
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{e.label}</p>
                    <p className="text-xs text-gray-500">
                      {e.time ? fmt(e.time) : "Pending"}
                      {e.extra ? ` · ${e.extra}` : ""}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Vitals */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Activity size={18} /> Vitals & Scores
          </h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Blood Pressure</p>
              <p className="font-semibold">{ecase.vitalsBP || "—"}</p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Pulse</p>
              <p className="font-semibold">
                {ecase.vitalsPulse ?? "—"}
                {ecase.vitalsPulse != null && " bpm"}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Respiration</p>
              <p className="font-semibold">
                {ecase.vitalsResp ?? "—"}
                {ecase.vitalsResp != null && " /min"}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">SpO2</p>
              <p className="font-semibold">
                {ecase.vitalsSpO2 ?? "—"}
                {ecase.vitalsSpO2 != null && "%"}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">Temperature</p>
              <p className="font-semibold">
                {ecase.vitalsTemp ?? "—"}
                {ecase.vitalsTemp != null && " °C"}
              </p>
            </div>
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">GCS</p>
              <p className="font-semibold">{ecase.glasgowComa ?? "—"}</p>
            </div>
            <div className="col-span-2 rounded-lg bg-gray-50 p-3">
              <p className="text-xs text-gray-500">MEWS Score</p>
              <p className="font-semibold">{ecase.mewsScore ?? "—"}</p>
            </div>
          </div>
        </div>

        {/* Attending Doctor */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <UserCheck size={18} /> Attending Doctor
          </h2>
          {ecase.attendingDoctor ? (
            <div>
              <p className="text-lg font-semibold">
                Dr. {ecase.attendingDoctor.user.name}
              </p>
              <p className="text-sm text-gray-500">
                {ecase.attendingDoctor.specialization}
              </p>
              {ecase.seenAt && (
                <p className="mt-2 text-xs text-gray-500">
                  Seen at {fmt(ecase.seenAt)}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">No doctor assigned yet.</p>
          )}
        </div>

        {/* Outcome */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <FileText size={18} /> Outcome
          </h2>
          {ecase.closedAt ? (
            <div className="space-y-2 text-sm">
              <p>
                <span className="text-gray-500">Status:</span>{" "}
                <strong>{ecase.status.replace(/_/g, " ")}</strong>
              </p>
              {ecase.disposition && (
                <p>
                  <span className="text-gray-500">Disposition:</span>{" "}
                  {ecase.disposition}
                </p>
              )}
              {ecase.outcomeNotes && (
                <p className="mt-2 rounded-lg bg-gray-50 p-3">
                  {ecase.outcomeNotes}
                </p>
              )}
              <p className="mt-2 text-xs text-gray-500">
                Closed at {fmt(ecase.closedAt)}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              Case is still active. Use the main board to close the case.
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="mt-6 flex gap-2">
        <Link
          href="/dashboard/emergency"
          className="rounded-lg border px-4 py-2 text-sm"
        >
          Back to Board
        </Link>
        {canClose && !ecase.closedAt && (
          <Link
            href="/dashboard/emergency"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            Manage Case
          </Link>
        )}
      </div>
    </div>
  );
}
