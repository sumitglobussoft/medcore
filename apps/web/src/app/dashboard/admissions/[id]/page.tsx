"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import {
  Activity,
  Pill,
  ClipboardList,
  FlaskConical,
  FileText,
  ArrowLeft,
  Printer,
} from "lucide-react";

interface Admission {
  id: string;
  admissionNumber: string;
  admittedAt: string;
  dischargedAt?: string | null;
  status: string;
  reason: string;
  diagnosis?: string | null;
  dischargeSummary?: string | null;
  patient: {
    id: string;
    mrNumber?: string;
    age?: number | null;
    gender?: string;
    bloodGroup?: string | null;
    user: { name: string; phone?: string; email?: string };
  };
  doctor: { id: string; user: { name: string } };
  bed: {
    id: string;
    bedNumber: string;
    ward: { id: string; name: string };
  };
}

interface Vital {
  id: string;
  recordedAt: string;
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  temperature?: number | null;
  pulse?: number | null;
  respiratoryRate?: number | null;
  spO2?: number | null;
  painScore?: number | null;
  bloodSugar?: number | null;
  notes?: string | null;
  nurse?: { user: { name: string } };
}

interface MedicationOrder {
  id: string;
  dosage: string;
  frequency: string;
  route: string;
  startDate: string;
  endDate?: string | null;
  isActive: boolean;
  instructions?: string | null;
  medicine: { id: string; name: string; genericName?: string | null };
  administrations?: Administration[];
}

interface Administration {
  id: string;
  scheduledAt: string;
  administeredAt?: string | null;
  status: string;
  notes?: string | null;
}

interface NurseRound {
  id: string;
  roundedAt: string;
  notes: string;
  nurse?: { user: { name: string } };
}

interface LabOrder {
  id: string;
  orderNumber?: string;
  orderedAt: string;
  status: string;
  notes?: string | null;
  items?: Array<{ test: { name: string }; status: string }>;
}

interface Bed {
  id: string;
  bedNumber: string;
  status: string;
  ward: { id: string; name: string };
}
interface Ward {
  id: string;
  name: string;
  beds?: Bed[];
}
interface Medicine {
  id: string;
  name: string;
  genericName?: string | null;
}
interface LabTest {
  id: string;
  name: string;
  category?: string;
}

type Tab =
  | "overview"
  | "vitals"
  | "medications"
  | "rounds"
  | "labs";

export default function AdmissionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useAuthStore();
  const [tab, setTab] = useState<Tab>("overview");
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAdmission();
  }, [id]);

  async function loadAdmission() {
    setLoading(true);
    try {
      const res = await api.get<{ data: Admission }>(`/admissions/${id}`);
      setAdmission(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  if (loading)
    return <div className="p-8 text-center text-gray-500">Loading...</div>;
  if (!admission)
    return (
      <div className="p-8 text-center text-gray-500">Admission not found.</div>
    );

  const tabClass = (t: Tab) =>
    `flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition ${
      tab === t
        ? "border-primary text-primary"
        : "border-transparent text-gray-500 hover:text-gray-800"
    }`;

  return (
    <div>
      <div className="no-print">
        <Link
          href="/dashboard/admissions"
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-800"
        >
          <ArrowLeft size={14} /> Back to Admissions
        </Link>
      </div>

      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">
              {admission.patient.user.name}
            </h1>
            <p className="text-sm text-gray-500">
              MR: {admission.patient.mrNumber} · Admission:{" "}
              {admission.admissionNumber}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.print()}
              aria-label="Print discharge summary"
              className="no-print inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              <Printer size={14} aria-hidden="true" /> Print
            </button>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                admission.status === "ADMITTED"
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {admission.status}
            </span>
          </div>
        </div>
      </div>

      <div className="no-print mb-6 flex gap-1 border-b">
        <button onClick={() => setTab("overview")} className={tabClass("overview")}>
          <FileText size={14} /> Overview
        </button>
        <button onClick={() => setTab("vitals")} className={tabClass("vitals")}>
          <Activity size={14} /> Vitals
        </button>
        <button
          onClick={() => setTab("medications")}
          className={tabClass("medications")}
        >
          <Pill size={14} /> Medications
        </button>
        <button onClick={() => setTab("rounds")} className={tabClass("rounds")}>
          <ClipboardList size={14} /> Nurse Rounds
        </button>
        <button onClick={() => setTab("labs")} className={tabClass("labs")}>
          <FlaskConical size={14} /> Lab Orders
        </button>
      </div>

      {tab === "overview" && (
        <OverviewTab admission={admission} onUpdate={loadAdmission} />
      )}
      {tab === "vitals" && (
        <VitalsTab admissionId={id} canRecord={user?.role === "NURSE" || user?.role === "DOCTOR"} />
      )}
      {tab === "medications" && (
        <MedicationsTab admissionId={id} canOrder={user?.role === "DOCTOR"} />
      )}
      {tab === "rounds" && (
        <RoundsTab admissionId={id} canAdd={user?.role === "NURSE"} />
      )}
      {tab === "labs" && (
        <LabsTab
          admission={admission}
          canOrder={user?.role === "DOCTOR"}
        />
      )}
    </div>
  );
}

interface BillInfo {
  days: number;
  grandTotal: number;
  breakdown: Array<{ label: string; days: number; ratePerDay: number; amount: number }>;
}

function OverviewTab({
  admission,
  onUpdate,
}: {
  admission: Admission;
  onUpdate: () => void;
}) {
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const [wards, setWards] = useState<Ward[]>([]);
  const [newBedId, setNewBedId] = useState("");
  const [bill, setBill] = useState<BillInfo | null>(null);
  const [dischargeForm, setDischargeForm] = useState({
    finalDiagnosis: "",
    treatmentGiven: "",
    conditionAtDischarge: "STABLE",
    dischargeMedications: "",
    followUpInstructions: "",
  });

  useEffect(() => {
    api
      .get<{ data: BillInfo }>(`/admissions/${admission.id}/bill`)
      .then((res) => setBill(res.data))
      .catch(() => {});
  }, [admission.id]);

  useEffect(() => {
    if (transferOpen) {
      api
        .get<{ data: Ward[] }>("/wards")
        .then((res) => setWards(res.data))
        .catch(() => {});
    }
  }, [transferOpen]);

  async function discharge() {
    try {
      await api.patch(`/admissions/${admission.id}/discharge`, {
        dischargeSummary: summary,
        finalDiagnosis: dischargeForm.finalDiagnosis || undefined,
        treatmentGiven: dischargeForm.treatmentGiven || undefined,
        conditionAtDischarge: dischargeForm.conditionAtDischarge || undefined,
        dischargeMedications: dischargeForm.dischargeMedications || undefined,
        followUpInstructions: dischargeForm.followUpInstructions || undefined,
      });
      setDischargeOpen(false);
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Discharge failed");
    }
  }

  async function transfer() {
    try {
      await api.patch(`/admissions/${admission.id}/transfer`, {
        bedId: newBedId,
      });
      setTransferOpen(false);
      setNewBedId("");
      onUpdate();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Transfer failed");
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className="lg:col-span-3 space-y-3">
        <IsolationPanel admissionId={admission.id} />
        <LosPredictionCard admissionId={admission.id} admittedAt={admission.admittedAt} />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <MedReconciliationButton
            admissionId={admission.id}
            patientId={admission.patient.id}
            type="ADMISSION"
          />
          <MedReconciliationButton
            admissionId={admission.id}
            patientId={admission.patient.id}
            type="DISCHARGE"
          />
        </div>
        <BelongingsCard admissionId={admission.id} />
      </div>
      <div className="rounded-xl bg-white p-6 shadow-sm lg:col-span-2">
        <h3 className="mb-4 font-semibold">Admission Details</h3>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Field label="Admission #" value={admission.admissionNumber} />
          <Field
            label="Admitted"
            value={new Date(admission.admittedAt).toLocaleString()}
          />
          <Field label="Doctor" value={admission.doctor.user.name} />
          <Field
            label="Bed"
            value={`${admission.bed.ward.name} / ${admission.bed.bedNumber}`}
          />
          <Field label="Reason" value={admission.reason} fullWidth />
          <Field
            label="Diagnosis"
            value={admission.diagnosis || "—"}
            fullWidth
          />
          {admission.dischargedAt && (
            <Field
              label="Discharged"
              value={new Date(admission.dischargedAt).toLocaleString()}
            />
          )}
          {admission.dischargeSummary && (
            <Field
              label="Discharge Summary"
              value={admission.dischargeSummary}
              fullWidth
            />
          )}
        </dl>
      </div>

      <div className="space-y-4">
        <div className="rounded-xl bg-white p-6 shadow-sm">
          <h3 className="mb-4 font-semibold">Patient</h3>
          <dl className="space-y-2 text-sm">
            <Field label="Name" value={admission.patient.user.name} />
            <Field label="MR" value={admission.patient.mrNumber || "—"} />
            <Field
              label="Phone"
              value={admission.patient.user.phone || "—"}
            />
            <Field
              label="Age / Sex"
              value={`${admission.patient.age ?? "—"} / ${admission.patient.gender || "—"}`}
            />
            <Field
              label="Blood Group"
              value={admission.patient.bloodGroup || "—"}
            />
          </dl>
        </div>

        {bill && (
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-3 font-semibold">Running Bill</h3>
            <div className="space-y-2 text-sm">
              {bill.breakdown.map((b, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-gray-600">
                    {b.label} × {b.days}d @ ₹{b.ratePerDay}
                  </span>
                  <span className="font-medium">₹{b.amount.toLocaleString()}</span>
                </div>
              ))}
              <div className="mt-2 flex justify-between border-t pt-2 text-base">
                <span className="font-semibold">Total ({bill.days} days)</span>
                <span className="font-bold text-primary">
                  ₹{bill.grandTotal.toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {admission.status === "ADMITTED" && (
          <div className="rounded-xl bg-white p-6 shadow-sm">
            <h3 className="mb-3 font-semibold">Actions</h3>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setTransferOpen(true)}
                className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-medium text-white hover:bg-blue-600"
              >
                Transfer Bed
              </button>
              <button
                onClick={() => setDischargeOpen(true)}
                className="rounded-lg bg-red-500 px-3 py-2 text-sm font-medium text-white hover:bg-red-600"
              >
                Discharge
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Discharge Modal */}
      {dischargeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 font-semibold">Discharge Patient</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600">
                  Discharge Summary *
                </label>
                <textarea
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    Final Diagnosis
                  </label>
                  <input
                    value={dischargeForm.finalDiagnosis}
                    onChange={(e) =>
                      setDischargeForm({
                        ...dischargeForm,
                        finalDiagnosis: e.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600">
                    Condition at Discharge
                  </label>
                  <select
                    value={dischargeForm.conditionAtDischarge}
                    onChange={(e) =>
                      setDischargeForm({
                        ...dischargeForm,
                        conditionAtDischarge: e.target.value,
                      })
                    }
                    className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    <option value="STABLE">Stable</option>
                    <option value="IMPROVED">Improved</option>
                    <option value="CRITICAL">Critical</option>
                    <option value="UNCHANGED">Unchanged</option>
                    <option value="DECEASED">Deceased</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">
                  Treatment Given
                </label>
                <textarea
                  value={dischargeForm.treatmentGiven}
                  onChange={(e) =>
                    setDischargeForm({
                      ...dischargeForm,
                      treatmentGiven: e.target.value,
                    })
                  }
                  rows={2}
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">
                  Discharge Medications
                </label>
                <textarea
                  value={dischargeForm.dischargeMedications}
                  onChange={(e) =>
                    setDischargeForm({
                      ...dischargeForm,
                      dischargeMedications: e.target.value,
                    })
                  }
                  rows={2}
                  placeholder="e.g. Amoxicillin 500mg TID x 5 days"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">
                  Follow-up Instructions
                </label>
                <textarea
                  value={dischargeForm.followUpInstructions}
                  onChange={(e) =>
                    setDischargeForm({
                      ...dischargeForm,
                      followUpInstructions: e.target.value,
                    })
                  }
                  rows={2}
                  placeholder="e.g. Review in 1 week with CBC report"
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setDischargeOpen(false)}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={discharge}
                disabled={!summary.trim()}
                className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
              >
                Confirm Discharge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transfer Modal */}
      {transferOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 font-semibold">Transfer to New Bed</h3>
            <select
              value={newBedId}
              onChange={(e) => setNewBedId(e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            >
              <option value="">Select bed</option>
              {wards.map((w) => (
                <optgroup key={w.id} label={w.name}>
                  {(w.beds || [])
                    .filter((b) => b.status === "AVAILABLE")
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {w.name} / Bed {b.bedNumber}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setTransferOpen(false)}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={transfer}
                disabled={!newBedId}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
              >
                Transfer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  fullWidth = false,
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "sm:col-span-2" : ""}>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm">{value}</dd>
    </div>
  );
}

function VitalsTab({
  admissionId,
  canRecord,
}: {
  admissionId: string;
  canRecord: boolean;
}) {
  const [vitals, setVitals] = useState<Vital[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    bpSystolic: "",
    bpDiastolic: "",
    temperature: "",
    pulse: "",
    respiratoryRate: "",
    spO2: "",
    painScore: "",
    bloodSugar: "",
    notes: "",
  });

  useEffect(() => {
    load();
  }, [admissionId]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ data: Vital[] }>(
        `/admissions/${admissionId}/vitals`
      );
      setVitals(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const payload: Record<string, unknown> = { notes: form.notes || undefined };
      const numKeys = [
        "bpSystolic",
        "bpDiastolic",
        "temperature",
        "pulse",
        "respiratoryRate",
        "spO2",
        "painScore",
        "bloodSugar",
      ];
      for (const k of numKeys) {
        const v = (form as unknown as Record<string, string>)[k];
        if (v !== "") payload[k] = parseFloat(v);
      }
      await api.post(`/admissions/${admissionId}/vitals`, payload);
      setForm({
        bpSystolic: "",
        bpDiastolic: "",
        temperature: "",
        pulse: "",
        respiratoryRate: "",
        spO2: "",
        painScore: "",
        bloodSugar: "",
        notes: "",
      });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save vitals");
    }
  }

  return (
    <div className="space-y-4">
      {canRecord && (
        <form
          onSubmit={submit}
          className="rounded-xl bg-white p-6 shadow-sm"
        >
          <h3 className="mb-4 font-semibold">Record Vitals</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Input
              label="BP Systolic"
              value={form.bpSystolic}
              onChange={(v) => setForm({ ...form, bpSystolic: v })}
            />
            <Input
              label="BP Diastolic"
              value={form.bpDiastolic}
              onChange={(v) => setForm({ ...form, bpDiastolic: v })}
            />
            <Input
              label="Temp (°C)"
              value={form.temperature}
              onChange={(v) => setForm({ ...form, temperature: v })}
            />
            <Input
              label="Pulse"
              value={form.pulse}
              onChange={(v) => setForm({ ...form, pulse: v })}
            />
            <Input
              label="Resp Rate"
              value={form.respiratoryRate}
              onChange={(v) => setForm({ ...form, respiratoryRate: v })}
            />
            <Input
              label="SpO2 %"
              value={form.spO2}
              onChange={(v) => setForm({ ...form, spO2: v })}
            />
            <Input
              label="Pain (0-10)"
              value={form.painScore}
              onChange={(v) => setForm({ ...form, painScore: v })}
            />
            <Input
              label="Blood Sugar"
              value={form.bloodSugar}
              onChange={(v) => setForm({ ...form, bloodSugar: v })}
            />
          </div>
          <textarea
            placeholder="Notes"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
          />
          <div className="mt-3 flex justify-end">
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
            >
              Save Vitals
            </button>
          </div>
        </form>
      )}

      <div className="rounded-xl bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : vitals.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No vitals recorded yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-gray-500">
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">BP</th>
                <th className="px-3 py-2">Temp</th>
                <th className="px-3 py-2">Pulse</th>
                <th className="px-3 py-2">RR</th>
                <th className="px-3 py-2">SpO2</th>
                <th className="px-3 py-2">Pain</th>
                <th className="px-3 py-2">Sugar</th>
                <th className="px-3 py-2">Notes</th>
              </tr>
            </thead>
            <tbody>
              {vitals.map((v) => (
                <tr key={v.id} className="border-b last:border-0">
                  <td className="px-3 py-2 text-xs">
                    {new Date(v.recordedAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    {v.bpSystolic && v.bpDiastolic
                      ? `${v.bpSystolic}/${v.bpDiastolic}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2">{v.temperature ?? "—"}</td>
                  <td className="px-3 py-2">{v.pulse ?? "—"}</td>
                  <td className="px-3 py-2">{v.respiratoryRate ?? "—"}</td>
                  <td className="px-3 py-2">{v.spO2 ?? "—"}</td>
                  <td className="px-3 py-2">{v.painScore ?? "—"}</td>
                  <td className="px-3 py-2">{v.bloodSugar ?? "—"}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">
                    {v.notes || "—"}
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

function Input({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-gray-600">
        {label}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-2 py-1.5 text-sm"
      />
    </div>
  );
}

function MedicationsTab({
  admissionId,
  canOrder,
}: {
  admissionId: string;
  canOrder: boolean;
}) {
  const [orders, setOrders] = useState<MedicationOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [medSearch, setMedSearch] = useState("");
  const [medResults, setMedResults] = useState<Medicine[]>([]);
  const [selectedMed, setSelectedMed] = useState<Medicine | null>(null);
  const [form, setForm] = useState({
    dosage: "",
    frequency: "",
    route: "ORAL",
    startDate: new Date().toISOString().split("T")[0],
    endDate: "",
    instructions: "",
  });

  useEffect(() => {
    load();
  }, [admissionId]);

  useEffect(() => {
    if (medSearch.length < 2) {
      setMedResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ data: Medicine[] }>(
          `/medicines?search=${encodeURIComponent(medSearch)}`
        );
        setMedResults(res.data);
      } catch {
        setMedResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [medSearch]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ data: MedicationOrder[] }>(
        `/medication/orders?admissionId=${admissionId}`
      );
      setOrders(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedMed) {
      alert("Select a medicine");
      return;
    }
    try {
      await api.post("/medication/orders", {
        admissionId,
        medicineId: selectedMed.id,
        dosage: form.dosage,
        frequency: form.frequency,
        route: form.route,
        startDate: form.startDate,
        endDate: form.endDate || undefined,
        instructions: form.instructions || undefined,
      });
      setShowForm(false);
      setSelectedMed(null);
      setMedSearch("");
      setForm({
        dosage: "",
        frequency: "",
        route: "ORAL",
        startDate: new Date().toISOString().split("T")[0],
        endDate: "",
        instructions: "",
      });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create order");
    }
  }

  async function toggleActive(order: MedicationOrder) {
    try {
      await api.patch(`/medication/orders/${order.id}`, {
        isActive: !order.isActive,
      });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update");
    }
  }

  return (
    <div className="space-y-4">
      {canOrder && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            {showForm ? "Cancel" : "+ Add Order"}
          </button>
        </div>
      )}

      {showForm && (
        <form
          onSubmit={submit}
          className="rounded-xl bg-white p-6 shadow-sm"
        >
          <h3 className="mb-4 font-semibold">New Medication Order</h3>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-sm font-medium">Medicine</label>
              {selectedMed ? (
                <div className="flex items-center justify-between rounded-lg border bg-gray-50 px-3 py-2 text-sm">
                  <span>{selectedMed.name}</span>
                  <button
                    type="button"
                    onClick={() => setSelectedMed(null)}
                    className="text-xs text-red-600"
                  >
                    Change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    placeholder="Search medicines"
                    value={medSearch}
                    onChange={(e) => setMedSearch(e.target.value)}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  />
                  {medResults.length > 0 && (
                    <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border bg-white shadow-sm">
                      {medResults.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            setSelectedMed(m);
                            setMedResults([]);
                          }}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                        >
                          <strong>{m.name}</strong>
                          {m.genericName && ` (${m.genericName})`}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Dosage</label>
                <input
                  required
                  placeholder="e.g. 500mg"
                  value={form.dosage}
                  onChange={(e) => setForm({ ...form, dosage: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Frequency
                </label>
                <input
                  required
                  placeholder="e.g. TID"
                  value={form.frequency}
                  onChange={(e) =>
                    setForm({ ...form, frequency: e.target.value })
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">Route</label>
                <select
                  value={form.route}
                  onChange={(e) => setForm({ ...form, route: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="ORAL">Oral</option>
                  <option value="IV">IV</option>
                  <option value="IM">IM</option>
                  <option value="SC">SC</option>
                  <option value="TOPICAL">Topical</option>
                  <option value="INHALATION">Inhalation</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Start Date
                </label>
                <input
                  required
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  End Date
                </label>
                <input
                  type="date"
                  value={form.endDate}
                  onChange={(e) =>
                    setForm({ ...form, endDate: e.target.value })
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <textarea
              placeholder="Instructions (optional)"
              value={form.instructions}
              onChange={(e) =>
                setForm({ ...form, instructions: e.target.value })
              }
              rows={2}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
            >
              Create Order
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
          Loading...
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
          No medication orders.
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <div key={o.id} className="rounded-xl bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between">
                <div>
                  <h4 className="font-semibold">{o.medicine.name}</h4>
                  {o.medicine.genericName && (
                    <p className="text-xs text-gray-500">
                      {o.medicine.genericName}
                    </p>
                  )}
                  <p className="mt-1 text-sm">
                    <span className="font-medium">{o.dosage}</span> ·{" "}
                    {o.frequency} · {o.route}
                  </p>
                  <p className="text-xs text-gray-500">
                    {o.startDate}
                    {o.endDate ? ` → ${o.endDate}` : " → ongoing"}
                  </p>
                  {o.instructions && (
                    <p className="mt-1 text-xs italic text-gray-600">
                      {o.instructions}
                    </p>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={o.isActive}
                    onChange={() => toggleActive(o)}
                  />
                  Active
                </label>
              </div>

              {o.administrations && o.administrations.length > 0 && (
                <div className="mt-3 border-t pt-3">
                  <p className="mb-1 text-xs font-semibold text-gray-600">
                    Recent Administrations
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {o.administrations.slice(0, 8).map((a) => (
                      <span
                        key={a.id}
                        className={`rounded px-2 py-0.5 text-xs ${
                          a.status === "ADMINISTERED"
                            ? "bg-green-100 text-green-700"
                            : a.status === "MISSED"
                              ? "bg-red-100 text-red-700"
                              : a.status === "REFUSED"
                                ? "bg-orange-100 text-orange-700"
                                : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {new Date(a.scheduledAt).toLocaleString(undefined, {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}{" "}
                        · {a.status}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RoundsTab({
  admissionId,
  canAdd,
}: {
  admissionId: string;
  canAdd: boolean;
}) {
  const [rounds, setRounds] = useState<NurseRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState("");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    load();
  }, [admissionId]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ data: NurseRound[] }>(
        `/nurse-rounds?admissionId=${admissionId}`
      );
      setRounds(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/nurse-rounds", { admissionId, notes });
      setNotes("");
      setShowForm(false);
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to add round");
    }
  }

  return (
    <div className="space-y-4">
      {canAdd && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            {showForm ? "Cancel" : "+ Add Round"}
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="rounded-xl bg-white p-6 shadow-sm">
          <h3 className="mb-3 font-semibold">New Nurse Round</h3>
          <textarea
            required
            placeholder="Round notes..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
            >
              Save
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
          Loading...
        </div>
      ) : rounds.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
          No rounds recorded.
        </div>
      ) : (
        <div className="space-y-2">
          {rounds.map((r) => (
            <div key={r.id} className="rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{new Date(r.roundedAt).toLocaleString()}</span>
                {r.nurse && <span>By: {r.nurse.user.name}</span>}
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap">{r.notes}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LabsTab({
  admission,
  canOrder,
}: {
  admission: Admission;
  canOrder: boolean;
}) {
  const [orders, setOrders] = useState<LabOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [tests, setTests] = useState<LabTest[]>([]);
  const [selectedTests, setSelectedTests] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    load();
  }, [admission.id]);

  useEffect(() => {
    if (showForm) {
      api
        .get<{ data: LabTest[] }>("/lab/tests")
        .then((res) => setTests(res.data))
        .catch(() => {});
    }
  }, [showForm]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get<{ data: LabOrder[] }>(
        `/lab/orders?admissionId=${admission.id}`
      );
      setOrders(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selectedTests.length === 0) {
      alert("Select at least one test");
      return;
    }
    try {
      await api.post("/lab/orders", {
        patientId: admission.patient.id,
        admissionId: admission.id,
        testIds: selectedTests,
        notes: notes || undefined,
      });
      setShowForm(false);
      setSelectedTests([]);
      setNotes("");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create order");
    }
  }

  const grouped = tests.reduce(
    (acc, t) => {
      const cat = t.category || "Other";
      (acc[cat] ||= []).push(t);
      return acc;
    },
    {} as Record<string, LabTest[]>
  );

  return (
    <div className="space-y-4">
      {canOrder && (
        <div className="flex justify-end">
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            {showForm ? "Cancel" : "+ Order Labs"}
          </button>
        </div>
      )}

      {showForm && (
        <form onSubmit={submit} className="rounded-xl bg-white p-6 shadow-sm">
          <h3 className="mb-3 font-semibold">New Lab Order</h3>
          <div className="max-h-64 overflow-y-auto rounded-lg border p-3">
            {Object.keys(grouped).length === 0 ? (
              <p className="text-sm text-gray-500">Loading tests...</p>
            ) : (
              Object.entries(grouped).map(([cat, list]) => (
                <div key={cat} className="mb-3">
                  <h4 className="mb-1 text-xs font-semibold uppercase text-gray-500">
                    {cat}
                  </h4>
                  <div className="grid grid-cols-2 gap-1">
                    {list.map((t) => (
                      <label
                        key={t.id}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={selectedTests.includes(t.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTests([...selectedTests, t.id]);
                            } else {
                              setSelectedTests(
                                selectedTests.filter((id) => id !== t.id)
                              );
                            }
                          }}
                        />
                        {t.name}
                      </label>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
          <textarea
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-3 w-full rounded-lg border px-3 py-2 text-sm"
          />
          <div className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border px-4 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
            >
              Create Order
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
          Loading...
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
          No lab orders.
        </div>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <Link
              key={o.id}
              href={`/dashboard/lab/${o.id}`}
              className="block rounded-xl bg-white p-4 shadow-sm hover:shadow"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    {o.orderNumber || o.id.slice(0, 8)}
                  </p>
                  <p className="text-xs text-gray-500">
                    {new Date(o.orderedAt).toLocaleString()}
                  </p>
                  {o.items && (
                    <p className="mt-1 text-sm text-gray-600">
                      {o.items.map((i) => i.test.name).join(", ")}
                    </p>
                  )}
                </div>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    o.status === "COMPLETED"
                      ? "bg-green-100 text-green-700"
                      : o.status === "IN_PROGRESS"
                        ? "bg-blue-100 text-blue-700"
                        : o.status === "CANCELLED"
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                  }`}
                >
                  {o.status}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ISOLATION PANEL ──────────────────────────────────
const ISOLATION_TYPES = [
  "STANDARD",
  "CONTACT",
  "DROPLET",
  "AIRBORNE",
  "REVERSE_ISOLATION",
];

function IsolationPanel({ admissionId }: { admissionId: string }) {
  const [info, setInfo] = useState<{
    isolationType: string | null;
    isolationReason: string | null;
    isolationStartDate: string | null;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState("STANDARD");
  const [reason, setReason] = useState("");

  const load = async () => {
    try {
      const res = await api.get<{ data: any }>(`/admissions/${admissionId}`);
      setInfo({
        isolationType: res.data.isolationType,
        isolationReason: res.data.isolationReason,
        isolationStartDate: res.data.isolationStartDate,
      });
      if (res.data.isolationType) setType(res.data.isolationType);
      if (res.data.isolationReason) setReason(res.data.isolationReason);
    } catch {}
  };
  useEffect(() => {
    load();
  }, [admissionId]);

  const apply = async (clear = false) => {
    try {
      await api.patch(
        `/admissions/${admissionId}/isolation`,
        clear ? { clear: true } : { isolationType: type, isolationReason: reason }
      );
      setEditing(false);
      load();
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const active = info?.isolationType && info.isolationType !== "STANDARD";

  return (
    <div
      className={`rounded-xl p-4 shadow-sm ${
        active ? "bg-red-50 border-l-4 border-red-500" : "bg-white"
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div
            className={`text-sm font-semibold ${
              active ? "text-red-800" : "text-gray-700"
            }`}
          >
            {active
              ? `Isolation Active: ${info!.isolationType!.replace(/_/g, " ")}`
              : "Isolation Status: Standard"}
          </div>
          {active && info?.isolationReason && (
            <div className="text-xs text-red-700 mt-0.5">
              {info.isolationReason}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {active && (
            <button
              onClick={() => apply(true)}
              className="text-xs px-2 py-1 border border-green-300 text-green-700 bg-white rounded"
            >
              Clear
            </button>
          )}
          <button
            onClick={() => setEditing(!editing)}
            className="text-xs px-2 py-1 border rounded bg-white"
          >
            {editing ? "Cancel" : active ? "Update" : "Set"}
          </button>
        </div>
      </div>
      {editing && (
        <div className="mt-3 space-y-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
          >
            {ISOLATION_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
          <input
            placeholder="Reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm"
          />
          <button
            onClick={() => apply(false)}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

// ─── LOS PREDICTION CARD ──────────────────────────────
function LosPredictionCard({
  admissionId,
  admittedAt,
}: {
  admissionId: string;
  admittedAt: string;
}) {
  const [pred, setPred] = useState<{
    expectedDays: number;
    confidence: string;
    similar_cases_count: number;
  } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get<{ data: any }>(
          `/admissions/${admissionId}/los-prediction`
        );
        setPred(res.data);
      } catch {
        setPred(null);
      }
    })();
  }, [admissionId]);

  if (!pred) return null;
  const admitDate = new Date(admittedAt);
  const expectedDischarge = new Date(admitDate);
  expectedDischarge.setDate(expectedDischarge.getDate() + pred.expectedDays);
  const now = new Date();
  const daysLeft = Math.max(
    0,
    Math.ceil((expectedDischarge.getTime() - now.getTime()) / 86400000)
  );

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm flex items-center gap-4">
      <div className="text-2xl">LOS</div>
      <div className="flex-1">
        <div className="text-sm font-semibold text-gray-700">
          Expected discharge:{" "}
          {expectedDischarge.toLocaleDateString(undefined, {
            weekday: "short",
            day: "numeric",
            month: "short",
          })}
          {daysLeft > 0 && (
            <span className="ml-2 text-blue-600">
              ({daysLeft} more day{daysLeft === 1 ? "" : "s"})
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500">
          Predicted LOS {pred.expectedDays}d - confidence {pred.confidence} - based
          on {pred.similar_cases_count} similar cases
        </div>
      </div>
    </div>
  );
}

// ─── MED RECONCILIATION BUTTON + MODAL ────────────────
interface MedItem {
  name: string;
  dosage?: string;
  frequency?: string;
  route?: string;
  continued?: boolean;
  notes?: string;
}

function MedReconciliationButton({
  admissionId,
  patientId,
  type,
}: {
  admissionId: string;
  patientId: string;
  type: "ADMISSION" | "DISCHARGE";
}) {
  const [open, setOpen] = useState(false);
  const [home, setHome] = useState<MedItem[]>([]);
  const [hospital, setHospital] = useState<MedItem[]>([]);
  const [discharge, setDischarge] = useState<MedItem[]>([]);
  const [notes, setNotes] = useState("");
  const [counseled, setCounseled] = useState(false);
  const [loading, setLoading] = useState(false);

  const openModal = async () => {
    setOpen(true);
    setLoading(true);
    try {
      const res = await api.get<{ data: any }>(
        `/med-reconciliation/suggest?patientId=${patientId}&admissionId=${admissionId}`
      );
      setHome(res.data.homeMedications || []);
      setHospital(res.data.hospitalMedications || []);
      if (type === "DISCHARGE") {
        setDischarge(res.data.hospitalMedications || []);
      }
    } catch {}
    setLoading(false);
  };

  const save = async () => {
    try {
      await api.post("/med-reconciliation", {
        patientId,
        admissionId,
        reconciliationType: type,
        homeMedications: home,
        hospitalMedications: hospital,
        dischargeMedications: discharge,
        patientCounseled: counseled,
        notes,
        changes: { added: [], removed: [], modified: [] },
      });
      setOpen(false);
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const addItem = (setter: (v: MedItem[]) => void, current: MedItem[]) => {
    setter([
      ...current,
      { name: "", dosage: "", frequency: "", continued: true },
    ]);
  };

  const renderColumn = (
    title: string,
    list: MedItem[],
    setter: (v: MedItem[]) => void
  ) => (
    <div className="flex-1 min-w-0 border rounded p-3 bg-slate-50">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-semibold text-sm">{title}</h4>
        <button
          onClick={() => addItem(setter, list)}
          className="text-xs text-blue-600"
        >
          + Add
        </button>
      </div>
      <ul className="space-y-2 max-h-80 overflow-y-auto">
        {list.length === 0 && (
          <li className="text-xs text-slate-400">None</li>
        )}
        {list.map((m, i) => (
          <li key={i} className="flex items-center gap-1">
            <input
              value={m.name}
              onChange={(e) => {
                const next = [...list];
                next[i] = { ...m, name: e.target.value };
                setter(next);
              }}
              placeholder="Name"
              className="flex-1 border rounded px-1 py-0.5 text-xs"
            />
            <input
              value={m.dosage || ""}
              onChange={(e) => {
                const next = [...list];
                next[i] = { ...m, dosage: e.target.value };
                setter(next);
              }}
              placeholder="Dose"
              className="w-16 border rounded px-1 py-0.5 text-xs"
            />
            <button
              onClick={() => setter(list.filter((_, j) => j !== i))}
              className="text-red-500 text-xs"
            >
              x
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <>
      <button
        onClick={openModal}
        className="p-3 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50 hover:bg-blue-100 text-sm font-medium text-blue-800"
      >
        {type === "ADMISSION"
          ? "Reconcile Medications (on Admission)"
          : "Discharge Medications Reconciliation"}
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg w-full max-w-5xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">
                Medication Reconciliation - {type}
              </h2>
              <button onClick={() => setOpen(false)}>Close</button>
            </div>
            {loading ? (
              <div className="p-6 text-center text-slate-500">
                Loading suggestions...
              </div>
            ) : (
              <div className="flex flex-col lg:flex-row gap-3">
                {renderColumn("Home Meds (before)", home, setHome)}
                {renderColumn("Hospital Meds (during)", hospital, setHospital)}
                {renderColumn("Discharge Meds (after)", discharge, setDischarge)}
              </div>
            )}
            <div className="mt-3">
              <textarea
                placeholder="Reconciliation notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full border rounded p-2 text-sm"
                rows={2}
              />
            </div>
            <label className="flex items-center gap-2 mt-2 text-sm">
              <input
                type="checkbox"
                checked={counseled}
                onChange={(e) => setCounseled(e.target.checked)}
              />
              Patient counseled about medications
            </label>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                onClick={save}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded"
              >
                Save Reconciliation
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── BELONGINGS CARD ──────────────────────────────────
interface BelongingItem {
  name: string;
  description?: string;
  value?: number;
  checkedIn?: boolean;
  checkedInAt?: string;
  checkedOutAt?: string;
}

function BelongingsCard({ admissionId }: { admissionId: string }) {
  const [rec, setRec] = useState<{
    items: BelongingItem[];
    notes: string | null;
  } | null>(null);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newVal, setNewVal] = useState("");

  const load = async () => {
    try {
      const res = await api.get<{ data: any }>(
        `/admissions/${admissionId}/belongings`
      );
      if (res.data) {
        setRec({
          items: (res.data.items as BelongingItem[]) || [],
          notes: res.data.notes,
        });
      } else {
        setRec({ items: [], notes: null });
      }
    } catch {
      setRec({ items: [], notes: null });
    }
  };
  useEffect(() => {
    load();
  }, [admissionId]);

  const add = async () => {
    if (!newName) return;
    const items = [
      ...(rec?.items || []),
      {
        name: newName,
        description: newDesc,
        value: newVal ? Number(newVal) : undefined,
        checkedIn: true,
        checkedInAt: new Date().toISOString(),
      },
    ];
    await api.post(`/admissions/${admissionId}/belongings`, {
      items,
      notes: rec?.notes ?? undefined,
    });
    setNewName("");
    setNewDesc("");
    setNewVal("");
    load();
  };

  const checkoutAll = async () => {
    if (!confirm("Check out all belongings?")) return;
    await api.post(`/admissions/${admissionId}/belongings/checkout`, {});
    load();
  };

  if (!rec) return null;

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">Patient Belongings</h3>
        {rec.items.length > 0 && (
          <button
            onClick={checkoutAll}
            className="text-xs px-2 py-1 border border-amber-300 text-amber-700 rounded"
          >
            Check out all
          </button>
        )}
      </div>
      {rec.items.length === 0 ? (
        <p className="text-xs text-slate-400 py-2">No belongings recorded.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm mb-3">
          {rec.items.map((it, i) => (
            <li key={i} className="py-1.5 flex items-center justify-between">
              <div>
                <div className="font-medium">{it.name}</div>
                {it.description && (
                  <div className="text-xs text-slate-500">{it.description}</div>
                )}
              </div>
              <div className="text-xs text-slate-500">
                {it.checkedIn ? (
                  <span className="text-green-700">Checked in</span>
                ) : (
                  <span className="text-slate-400">Checked out</span>
                )}
                {it.value ? ` - ${it.value}` : ""}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2 mt-2">
        <input
          placeholder="Item name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 min-w-[120px] border rounded px-2 py-1 text-sm"
        />
        <input
          placeholder="Description"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          className="flex-1 min-w-[120px] border rounded px-2 py-1 text-sm"
        />
        <input
          placeholder="Value"
          type="number"
          value={newVal}
          onChange={(e) => setNewVal(e.target.value)}
          className="w-20 border rounded px-2 py-1 text-sm"
        />
        <button
          onClick={add}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded"
        >
          Add
        </button>
      </div>
    </div>
  );
}
