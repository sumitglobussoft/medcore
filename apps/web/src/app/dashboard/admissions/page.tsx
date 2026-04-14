"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { Plus, BedDouble } from "lucide-react";

interface Admission {
  id: string;
  admissionNumber: string;
  admittedAt: string;
  dischargedAt?: string | null;
  status: "ADMITTED" | "DISCHARGED" | "TRANSFERRED";
  reason: string;
  diagnosis?: string | null;
  patient: { id: string; mrNumber?: string; user: { name: string; phone?: string } };
  doctor: { id: string; user: { name: string } };
  bed: {
    id: string;
    bedNumber: string;
    ward: { id: string; name: string };
  };
}

interface PatientSearchResult {
  id: string;
  mrNumber: string;
  user: { name: string; phone: string };
}

interface Doctor {
  id: string;
  user: { name: string };
  specialization: string;
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

type Tab = "admitted" | "discharged" | "all";

const STATUS_COLORS: Record<string, string> = {
  ADMITTED: "bg-green-100 text-green-700",
  DISCHARGED: "bg-gray-100 text-gray-700",
  TRANSFERRED: "bg-blue-100 text-blue-700",
};

export default function AdmissionsPage() {
  const { user } = useAuthStore();
  const [admissions, setAdmissions] = useState<Admission[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("admitted");
  const [showModal, setShowModal] = useState(false);

  // Form state
  const [patientSearch, setPatientSearch] = useState("");
  const [patientResults, setPatientResults] = useState<PatientSearchResult[]>(
    []
  );
  const [selectedPatient, setSelectedPatient] =
    useState<PatientSearchResult | null>(null);
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [wards, setWards] = useState<Ward[]>([]);
  const [form, setForm] = useState({
    doctorId: "",
    bedId: "",
    reason: "",
    diagnosis: "",
  });

  const canAdmit =
    user?.role === "ADMIN" ||
    user?.role === "RECEPTION" ||
    user?.role === "DOCTOR";

  useEffect(() => {
    loadAdmissions();
  }, [tab]);

  useEffect(() => {
    if (showModal) {
      loadDoctors();
      loadWards();
    }
  }, [showModal]);

  useEffect(() => {
    if (patientSearch.length < 2) {
      setPatientResults([]);
      return;
    }
    const t = setTimeout(() => {
      searchPatients(patientSearch);
    }, 300);
    return () => clearTimeout(t);
  }, [patientSearch]);

  async function loadAdmissions() {
    setLoading(true);
    try {
      const statusParam =
        tab === "admitted"
          ? "?status=ADMITTED"
          : tab === "discharged"
            ? "?status=DISCHARGED"
            : "";
      const res = await api.get<{ data: Admission[] }>(
        `/admissions${statusParam}`
      );
      setAdmissions(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  async function searchPatients(q: string) {
    try {
      const res = await api.get<{ data: PatientSearchResult[] }>(
        `/patients?search=${encodeURIComponent(q)}&limit=10`
      );
      setPatientResults(res.data);
    } catch {
      setPatientResults([]);
    }
  }

  async function loadDoctors() {
    try {
      const res = await api.get<{ data: Doctor[] }>("/doctors");
      setDoctors(res.data);
    } catch {
      // empty
    }
  }

  async function loadWards() {
    try {
      const res = await api.get<{ data: Ward[] }>("/wards");
      setWards(res.data);
    } catch {
      // empty
    }
  }

  async function submitAdmission(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatient) {
      alert("Select a patient");
      return;
    }
    try {
      await api.post("/admissions", {
        patientId: selectedPatient.id,
        doctorId: form.doctorId,
        bedId: form.bedId,
        reason: form.reason,
        diagnosis: form.diagnosis || undefined,
      });
      setShowModal(false);
      setSelectedPatient(null);
      setPatientSearch("");
      setForm({ doctorId: "", bedId: "", reason: "", diagnosis: "" });
      loadAdmissions();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Admission failed");
    }
  }

  const tabClasses = (t: Tab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition ${
      tab === t
        ? "bg-primary text-white"
        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
    }`;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Admissions</h1>
          <p className="text-sm text-gray-500">
            In-patient admission management
          </p>
        </div>
        {canAdmit && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            <Plus size={16} /> Admit Patient
          </button>
        )}
      </div>

      <div className="mb-4 flex gap-2">
        <button onClick={() => setTab("admitted")} className={tabClasses("admitted")}>
          Currently Admitted
        </button>
        <button
          onClick={() => setTab("discharged")}
          className={tabClasses("discharged")}
        >
          Discharged
        </button>
        <button onClick={() => setTab("all")} className={tabClasses("all")}>
          All
        </button>
      </div>

      <div className="rounded-xl bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : admissions.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No admissions found.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-gray-500">
                <th className="px-4 py-3">Admission #</th>
                <th className="px-4 py-3">Patient</th>
                <th className="px-4 py-3">Doctor</th>
                <th className="px-4 py-3">Ward / Bed</th>
                <th className="px-4 py-3">Admitted</th>
                <th className="px-4 py-3">Diagnosis</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {admissions.map((adm) => (
                <tr key={adm.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">
                    {adm.admissionNumber}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/admissions/${adm.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {adm.patient.user.name}
                    </Link>
                    <p className="text-xs text-gray-500">
                      {adm.patient.mrNumber}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-sm">{adm.doctor.user.name}</td>
                  <td className="px-4 py-3 text-sm">
                    <div className="flex items-center gap-1">
                      <BedDouble size={14} className="text-gray-400" />
                      {adm.bed.ward.name} / {adm.bed.bedNumber}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {new Date(adm.admittedAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {adm.diagnosis || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[adm.status] || ""}`}
                    >
                      {adm.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/dashboard/admissions/${adm.id}`}
                      className="rounded bg-primary px-2 py-1 text-xs text-white hover:bg-primary-dark"
                    >
                      View Chart
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Admit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <form
            onSubmit={submitAdmission}
            className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 className="mb-4 text-lg font-semibold">Admit Patient</h2>

            <div className="space-y-4">
              {/* Patient search */}
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Patient
                </label>
                {selectedPatient ? (
                  <div className="flex items-center justify-between rounded-lg border bg-gray-50 px-3 py-2 text-sm">
                    <span>
                      <strong>{selectedPatient.user.name}</strong> —{" "}
                      {selectedPatient.mrNumber}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedPatient(null);
                        setPatientSearch("");
                      }}
                      className="text-xs text-red-600"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <>
                    <input
                      placeholder="Search by name or MR number"
                      value={patientSearch}
                      onChange={(e) => setPatientSearch(e.target.value)}
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    />
                    {patientResults.length > 0 && (
                      <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border bg-white shadow-sm">
                        {patientResults.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => {
                              setSelectedPatient(p);
                              setPatientResults([]);
                            }}
                            className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                          >
                            <strong>{p.user.name}</strong> · {p.mrNumber} ·{" "}
                            {p.user.phone}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">Doctor</label>
                <select
                  required
                  value={form.doctorId}
                  onChange={(e) =>
                    setForm({ ...form, doctorId: e.target.value })
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">Select Doctor</option>
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.user.name} — {d.specialization}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Available Bed
                </label>
                <select
                  required
                  value={form.bedId}
                  onChange={(e) => setForm({ ...form, bedId: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                >
                  <option value="">Select Bed</option>
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
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Reason for Admission
                </label>
                <textarea
                  required
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  Diagnosis (optional)
                </label>
                <input
                  value={form.diagnosis}
                  onChange={(e) =>
                    setForm({ ...form, diagnosis: e.target.value })
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
              >
                Admit Patient
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
