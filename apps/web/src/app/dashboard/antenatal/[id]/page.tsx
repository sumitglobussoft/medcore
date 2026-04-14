"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import {
  ArrowLeft,
  Plus,
  AlertTriangle,
  Baby,
  Calendar,
  Activity,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

interface AncVisit {
  id: string;
  type: string;
  visitDate: string;
  weeksOfGestation?: number | null;
  weight?: number | null;
  bloodPressure?: string | null;
  fundalHeight?: string | null;
  fetalHeartRate?: number | null;
  presentation?: string | null;
  hemoglobin?: number | null;
  urineProtein?: string | null;
  urineSugar?: string | null;
  notes?: string | null;
  prescribedMeds?: string | null;
  nextVisitDate?: string | null;
}

interface AncCase {
  id: string;
  caseNumber: string;
  lmpDate: string;
  eddDate: string;
  gravida: number;
  parity: number;
  bloodGroup?: string | null;
  isHighRisk: boolean;
  riskFactors?: string | null;
  deliveredAt?: string | null;
  deliveryType?: string | null;
  babyGender?: string | null;
  babyWeight?: number | null;
  outcomeNotes?: string | null;
  patient: {
    id: string;
    mrNumber?: string;
    user: { name: string; phone?: string; email?: string };
  };
  doctor: { id: string; user: { name: string } };
  visits: AncVisit[];
}

const VISIT_TYPES = [
  { value: "FIRST_VISIT", label: "First Visit" },
  { value: "ROUTINE", label: "Routine" },
  { value: "HIGH_RISK_FOLLOWUP", label: "High Risk Follow-up" },
  { value: "SCAN_REVIEW", label: "Scan Review" },
  { value: "DELIVERY", label: "Delivery" },
  { value: "POSTNATAL", label: "Postnatal" },
];

export default function AncCaseDetailPage() {
  const params = useParams();
  const id = params.id as string;
  const { user } = useAuthStore();

  const [caseData, setCaseData] = useState<AncCase | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"visits" | "delivery">("visits");
  const [expandedVisits, setExpandedVisits] = useState<Set<string>>(new Set());
  const [showVisitForm, setShowVisitForm] = useState(false);
  const [showDeliveryForm, setShowDeliveryForm] = useState(false);

  const [visitForm, setVisitForm] = useState({
    type: "ROUTINE",
    weeksOfGestation: "",
    weight: "",
    bloodPressure: "",
    fundalHeight: "",
    fetalHeartRate: "",
    presentation: "",
    hemoglobin: "",
    urineProtein: "",
    urineSugar: "",
    notes: "",
    prescribedMeds: "",
    nextVisitDate: "",
  });

  const [deliveryForm, setDeliveryForm] = useState({
    deliveryType: "NORMAL",
    babyGender: "",
    babyWeight: "",
    outcomeNotes: "",
  });

  const canEdit =
    user?.role === "DOCTOR" || user?.role === "ADMIN" || user?.role === "NURSE";
  const canDeliver = user?.role === "DOCTOR" || user?.role === "ADMIN";

  useEffect(() => {
    load();
  }, [id]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ data: AncCase }>(`/antenatal/cases/${id}`);
      setCaseData(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  function toggleVisit(id: string) {
    const s = new Set(expandedVisits);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    setExpandedVisits(s);
  }

  async function submitVisit(e: React.FormEvent) {
    e.preventDefault();
    if (!caseData) return;
    try {
      await api.post("/antenatal/visits", {
        ancCaseId: caseData.id,
        type: visitForm.type,
        weeksOfGestation: visitForm.weeksOfGestation
          ? parseInt(visitForm.weeksOfGestation)
          : undefined,
        weight: visitForm.weight ? parseFloat(visitForm.weight) : undefined,
        bloodPressure: visitForm.bloodPressure || undefined,
        fundalHeight: visitForm.fundalHeight || undefined,
        fetalHeartRate: visitForm.fetalHeartRate
          ? parseInt(visitForm.fetalHeartRate)
          : undefined,
        presentation: visitForm.presentation || undefined,
        hemoglobin: visitForm.hemoglobin
          ? parseFloat(visitForm.hemoglobin)
          : undefined,
        urineProtein: visitForm.urineProtein || undefined,
        urineSugar: visitForm.urineSugar || undefined,
        notes: visitForm.notes || undefined,
        prescribedMeds: visitForm.prescribedMeds || undefined,
        nextVisitDate: visitForm.nextVisitDate || undefined,
      });
      setShowVisitForm(false);
      setVisitForm({
        type: "ROUTINE",
        weeksOfGestation: "",
        weight: "",
        bloodPressure: "",
        fundalHeight: "",
        fetalHeartRate: "",
        presentation: "",
        hemoglobin: "",
        urineProtein: "",
        urineSugar: "",
        notes: "",
        prescribedMeds: "",
        nextVisitDate: "",
      });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add visit");
    }
  }

  async function submitDelivery(e: React.FormEvent) {
    e.preventDefault();
    if (!caseData) return;
    try {
      await api.patch(`/antenatal/cases/${caseData.id}/delivery`, {
        deliveryType: deliveryForm.deliveryType,
        babyGender: deliveryForm.babyGender || undefined,
        babyWeight: deliveryForm.babyWeight
          ? parseFloat(deliveryForm.babyWeight)
          : undefined,
        outcomeNotes: deliveryForm.outcomeNotes || undefined,
      });
      setShowDeliveryForm(false);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to record delivery");
    }
  }

  if (loading || !caseData) {
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  }

  const weeksGestation = Math.round(
    (new Date().getTime() - new Date(caseData.lmpDate).getTime()) /
      (7 * 24 * 60 * 60 * 1000)
  );
  const daysToEdd = Math.round(
    (new Date(caseData.eddDate).getTime() - new Date().getTime()) /
      (24 * 60 * 60 * 1000)
  );

  // Timeline points
  const lmpDate = new Date(caseData.lmpDate);
  const eddDate = new Date(caseData.eddDate);
  const totalMs = eddDate.getTime() - lmpDate.getTime();

  return (
    <div>
      <Link
        href="/dashboard/antenatal"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-primary"
      >
        <ArrowLeft size={14} /> Back to ANC
      </Link>

      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">
            {caseData.caseNumber}
            {caseData.isHighRisk && (
              <span className="ml-3 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                High Risk
              </span>
            )}
            {caseData.deliveredAt && (
              <span className="ml-2 rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                Delivered
              </span>
            )}
          </h1>
          <p className="text-sm text-gray-500">
            {caseData.patient.user.name} · {caseData.patient.mrNumber}
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-gray-500">Patient Info</h3>
          <p className="text-lg font-semibold">{caseData.patient.user.name}</p>
          <p className="text-sm text-gray-500">MR: {caseData.patient.mrNumber}</p>
          {caseData.patient.user.phone && (
            <p className="text-sm text-gray-500">
              Phone: {caseData.patient.user.phone}
            </p>
          )}
          <p className="mt-2 text-sm">
            Doctor: <strong>{caseData.doctor.user.name}</strong>
          </p>
        </div>

        <div className="rounded-xl bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-gray-500">ANC Summary</h3>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <div>
              <span className="text-gray-500">LMP:</span>{" "}
              <strong>{new Date(caseData.lmpDate).toLocaleDateString()}</strong>
            </div>
            <div>
              <span className="text-gray-500">EDD:</span>{" "}
              <strong>{new Date(caseData.eddDate).toLocaleDateString()}</strong>
            </div>
            <div>
              <span className="text-gray-500">Gravida/Parity:</span>{" "}
              <strong>
                G{caseData.gravida} P{caseData.parity}
              </strong>
            </div>
            <div>
              <span className="text-gray-500">Blood Group:</span>{" "}
              <strong>{caseData.bloodGroup || "—"}</strong>
            </div>
            {!caseData.deliveredAt && (
              <>
                <div>
                  <span className="text-gray-500">Gestation:</span>{" "}
                  <strong>{weeksGestation}w</strong>
                </div>
                <div>
                  <span className="text-gray-500">Days to EDD:</span>{" "}
                  <strong className={daysToEdd < 0 ? "text-red-600" : ""}>
                    {daysToEdd < 0 ? `${Math.abs(daysToEdd)}d overdue` : `${daysToEdd}d`}
                  </strong>
                </div>
              </>
            )}
          </div>
          {caseData.isHighRisk && caseData.riskFactors && (
            <div className="mt-3 rounded-lg bg-red-50 p-2 text-xs">
              <strong className="text-red-700 flex items-center gap-1">
                <AlertTriangle size={14} /> Risk Factors:
              </strong>
              <p className="text-red-700">{caseData.riskFactors}</p>
            </div>
          )}
        </div>
      </div>

      {/* Timeline */}
      <div className="mb-6 rounded-xl bg-white p-5 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold text-gray-500">Timeline</h3>
        <div className="relative">
          <div className="h-2 rounded-full bg-gray-200">
            <div
              className="h-2 rounded-full bg-primary"
              style={{
                width: `${Math.min(
                  100,
                  Math.max(
                    0,
                    ((new Date().getTime() - lmpDate.getTime()) / totalMs) * 100
                  )
                )}%`,
              }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-gray-500">
            <span>LMP {lmpDate.toLocaleDateString()}</span>
            <span>Today · {weeksGestation}w</span>
            <span>EDD {eddDate.toLocaleDateString()}</span>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {caseData.visits.map((v) => (
              <span
                key={v.id}
                className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
              >
                <Activity size={12} />
                {v.weeksOfGestation != null ? `${v.weeksOfGestation}w ` : ""}
                {new Date(v.visitDate).toLocaleDateString()}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab("visits")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
            tab === "visits"
              ? "bg-primary text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Visits ({caseData.visits.length})
        </button>
        <button
          onClick={() => setTab("delivery")}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition ${
            tab === "delivery"
              ? "bg-primary text-white"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          Delivery
        </button>
      </div>

      {tab === "visits" && (
        <div className="rounded-xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold">Antenatal Visits</h3>
            {canEdit && !caseData.deliveredAt && (
              <button
                onClick={() => setShowVisitForm(!showVisitForm)}
                className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-dark"
              >
                <Plus size={14} /> Add Visit
              </button>
            )}
          </div>

          {showVisitForm && (
            <form
              onSubmit={submitVisit}
              className="mb-4 rounded-lg border bg-gray-50 p-4"
            >
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium">Type</label>
                  <select
                    value={visitForm.type}
                    onChange={(e) => setVisitForm({ ...visitForm, type: e.target.value })}
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  >
                    {VISIT_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Weeks Gestation</label>
                  <input
                    type="number"
                    value={visitForm.weeksOfGestation}
                    onChange={(e) =>
                      setVisitForm({ ...visitForm, weeksOfGestation: e.target.value })
                    }
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Weight (kg)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={visitForm.weight}
                    onChange={(e) => setVisitForm({ ...visitForm, weight: e.target.value })}
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Blood Pressure</label>
                  <input
                    placeholder="e.g. 120/80"
                    value={visitForm.bloodPressure}
                    onChange={(e) =>
                      setVisitForm({ ...visitForm, bloodPressure: e.target.value })
                    }
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Fundal Height (cm)</label>
                  <input
                    value={visitForm.fundalHeight}
                    onChange={(e) =>
                      setVisitForm({ ...visitForm, fundalHeight: e.target.value })
                    }
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">FHR (bpm)</label>
                  <input
                    type="number"
                    value={visitForm.fetalHeartRate}
                    onChange={(e) =>
                      setVisitForm({ ...visitForm, fetalHeartRate: e.target.value })
                    }
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Presentation</label>
                  <input
                    placeholder="e.g. Cephalic"
                    value={visitForm.presentation}
                    onChange={(e) =>
                      setVisitForm({ ...visitForm, presentation: e.target.value })
                    }
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Hb (g/dl)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={visitForm.hemoglobin}
                    onChange={(e) =>
                      setVisitForm({ ...visitForm, hemoglobin: e.target.value })
                    }
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Urine Protein</label>
                  <input
                    placeholder="nil/+/++/+++"
                    value={visitForm.urineProtein}
                    onChange={(e) =>
                      setVisitForm({ ...visitForm, urineProtein: e.target.value })
                    }
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Urine Sugar</label>
                  <input
                    placeholder="nil/+/++/+++"
                    value={visitForm.urineSugar}
                    onChange={(e) =>
                      setVisitForm({ ...visitForm, urineSugar: e.target.value })
                    }
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium">Next Visit</label>
                  <input
                    type="date"
                    value={visitForm.nextVisitDate}
                    onChange={(e) =>
                      setVisitForm({ ...visitForm, nextVisitDate: e.target.value })
                    }
                    className="w-full rounded border px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium">Prescribed Meds</label>
                <input
                  value={visitForm.prescribedMeds}
                  onChange={(e) =>
                    setVisitForm({ ...visitForm, prescribedMeds: e.target.value })
                  }
                  placeholder="e.g. Folic acid, Iron, Calcium"
                  className="w-full rounded border px-2 py-1.5 text-sm"
                />
              </div>
              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium">Notes</label>
                <textarea
                  rows={2}
                  value={visitForm.notes}
                  onChange={(e) => setVisitForm({ ...visitForm, notes: e.target.value })}
                  className="w-full rounded border px-2 py-1.5 text-sm"
                />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowVisitForm(false)}
                  className="rounded border px-3 py-1.5 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-dark"
                >
                  Save Visit
                </button>
              </div>
            </form>
          )}

          {caseData.visits.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-500">
              No visits recorded yet.
            </p>
          ) : (
            <div className="space-y-2">
              {caseData.visits.map((v) => {
                const isOpen = expandedVisits.has(v.id);
                return (
                  <div
                    key={v.id}
                    className="rounded-lg border bg-white"
                  >
                    <button
                      onClick={() => toggleVisit(v.id)}
                      className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                    >
                      <div className="flex items-center gap-3">
                        {isOpen ? (
                          <ChevronDown size={16} className="text-gray-400" />
                        ) : (
                          <ChevronRight size={16} className="text-gray-400" />
                        )}
                        <div>
                          <p className="text-sm font-medium">
                            {v.type.replace(/_/g, " ")} ·{" "}
                            {new Date(v.visitDate).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-gray-500">
                            {v.weeksOfGestation != null &&
                              `${v.weeksOfGestation}w · `}
                            {v.bloodPressure && `BP ${v.bloodPressure} · `}
                            {v.weight && `${v.weight} kg`}
                          </p>
                        </div>
                      </div>
                      {v.nextVisitDate && (
                        <span className="text-xs text-gray-500">
                          Next: {new Date(v.nextVisitDate).toLocaleDateString()}
                        </span>
                      )}
                    </button>
                    {isOpen && (
                      <div className="grid grid-cols-2 gap-3 border-t bg-gray-50 px-4 py-3 text-xs md:grid-cols-3">
                        {v.fundalHeight && (
                          <div>
                            <span className="text-gray-500">Fundal:</span>{" "}
                            <strong>{v.fundalHeight}</strong>
                          </div>
                        )}
                        {v.fetalHeartRate && (
                          <div>
                            <span className="text-gray-500">FHR:</span>{" "}
                            <strong>{v.fetalHeartRate} bpm</strong>
                          </div>
                        )}
                        {v.presentation && (
                          <div>
                            <span className="text-gray-500">Presentation:</span>{" "}
                            <strong>{v.presentation}</strong>
                          </div>
                        )}
                        {v.hemoglobin && (
                          <div>
                            <span className="text-gray-500">Hb:</span>{" "}
                            <strong>{v.hemoglobin} g/dl</strong>
                          </div>
                        )}
                        {v.urineProtein && (
                          <div>
                            <span className="text-gray-500">Urine protein:</span>{" "}
                            <strong>{v.urineProtein}</strong>
                          </div>
                        )}
                        {v.urineSugar && (
                          <div>
                            <span className="text-gray-500">Urine sugar:</span>{" "}
                            <strong>{v.urineSugar}</strong>
                          </div>
                        )}
                        {v.prescribedMeds && (
                          <div className="col-span-full">
                            <span className="text-gray-500">Prescribed:</span>{" "}
                            <strong>{v.prescribedMeds}</strong>
                          </div>
                        )}
                        {v.notes && (
                          <div className="col-span-full">
                            <span className="text-gray-500">Notes:</span>{" "}
                            {v.notes}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "delivery" && (
        <div className="rounded-xl bg-white p-5 shadow-sm">
          {caseData.deliveredAt ? (
            <div>
              <h3 className="mb-3 flex items-center gap-2 font-semibold">
                <Baby size={18} /> Delivery Details
              </h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-gray-500">Delivered At:</span>{" "}
                  <strong>
                    {new Date(caseData.deliveredAt).toLocaleString()}
                  </strong>
                </div>
                <div>
                  <span className="text-gray-500">Type:</span>{" "}
                  <strong>{caseData.deliveryType?.replace(/_/g, " ")}</strong>
                </div>
                <div>
                  <span className="text-gray-500">Baby Gender:</span>{" "}
                  <strong>{caseData.babyGender || "—"}</strong>
                </div>
                <div>
                  <span className="text-gray-500">Baby Weight:</span>{" "}
                  <strong>
                    {caseData.babyWeight ? `${caseData.babyWeight} kg` : "—"}
                  </strong>
                </div>
              </div>
              {caseData.outcomeNotes && (
                <div className="mt-4">
                  <p className="text-xs text-gray-500">Outcome Notes</p>
                  <p className="mt-1 text-sm">{caseData.outcomeNotes}</p>
                </div>
              )}
            </div>
          ) : canDeliver ? (
            showDeliveryForm ? (
              <form onSubmit={submitDelivery}>
                <h3 className="mb-3 font-semibold">Record Delivery</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Delivery Type
                    </label>
                    <select
                      value={deliveryForm.deliveryType}
                      onChange={(e) =>
                        setDeliveryForm({
                          ...deliveryForm,
                          deliveryType: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="NORMAL">Normal</option>
                      <option value="C_SECTION">C-Section</option>
                      <option value="INSTRUMENTAL">Instrumental</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Baby Gender
                    </label>
                    <select
                      value={deliveryForm.babyGender}
                      onChange={(e) =>
                        setDeliveryForm({
                          ...deliveryForm,
                          babyGender: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="">—</option>
                      <option value="MALE">Male</option>
                      <option value="FEMALE">Female</option>
                      <option value="OTHER">Other</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">
                      Baby Weight (kg)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={deliveryForm.babyWeight}
                      onChange={(e) =>
                        setDeliveryForm({
                          ...deliveryForm,
                          babyWeight: e.target.value,
                        })
                      }
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="mt-4">
                  <label className="mb-1 block text-sm font-medium">
                    Outcome Notes
                  </label>
                  <textarea
                    rows={3}
                    value={deliveryForm.outcomeNotes}
                    onChange={(e) =>
                      setDeliveryForm({
                        ...deliveryForm,
                        outcomeNotes: e.target.value,
                      })
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShowDeliveryForm(false)}
                    className="rounded-lg border px-4 py-2 text-sm"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
                  >
                    Record Delivery
                  </button>
                </div>
              </form>
            ) : (
              <div className="py-8 text-center">
                <Calendar size={36} className="mx-auto mb-3 text-gray-300" />
                <p className="mb-4 text-gray-500">No delivery recorded yet.</p>
                <button
                  onClick={() => setShowDeliveryForm(true)}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
                >
                  Record Delivery
                </button>
              </div>
            )
          ) : (
            <p className="py-8 text-center text-gray-500">Delivery not yet recorded.</p>
          )}
        </div>
      )}
    </div>
  );
}
