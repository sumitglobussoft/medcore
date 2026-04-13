"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { FREQUENCY_OPTIONS } from "@medcore/shared";

interface PrescriptionRecord {
  id: string;
  diagnosis: string;
  advice: string | null;
  followUpDate: string | null;
  createdAt: string;
  items: Array<{
    medicineName: string;
    dosage: string;
    frequency: string;
    duration: string;
    instructions: string | null;
  }>;
  doctor: { user: { name: string } };
  patient: { user: { name: string; phone: string } };
}

export default function PrescriptionsPage() {
  const { user } = useAuthStore();
  const [prescriptions, setPrescriptions] = useState<PrescriptionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Form state
  const [form, setForm] = useState({
    appointmentId: "",
    patientId: "",
    diagnosis: "",
    advice: "",
    followUpDate: "",
  });
  const [medicines, setMedicines] = useState([
    { medicineName: "", dosage: "", frequency: "", duration: "", instructions: "" },
  ]);

  useEffect(() => {
    loadPrescriptions();
  }, []);

  async function loadPrescriptions() {
    setLoading(true);
    try {
      const res = await api.get<{ data: PrescriptionRecord[] }>(
        "/prescriptions?limit=50"
      );
      setPrescriptions(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  function addMedicine() {
    setMedicines([
      ...medicines,
      { medicineName: "", dosage: "", frequency: "", duration: "", instructions: "" },
    ]);
  }

  function removeMedicine(idx: number) {
    setMedicines(medicines.filter((_, i) => i !== idx));
  }

  function updateMedicine(idx: number, field: string, value: string) {
    const updated = [...medicines];
    (updated[idx] as Record<string, string>)[field] = value;
    setMedicines(updated);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post("/prescriptions", {
        appointmentId: form.appointmentId,
        patientId: form.patientId,
        diagnosis: form.diagnosis,
        items: medicines.filter((m) => m.medicineName),
        advice: form.advice || undefined,
        followUpDate: form.followUpDate || undefined,
      });
      setShowForm(false);
      setForm({ appointmentId: "", patientId: "", diagnosis: "", advice: "", followUpDate: "" });
      setMedicines([{ medicineName: "", dosage: "", frequency: "", duration: "", instructions: "" }]);
      loadPrescriptions();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to create prescription");
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Prescriptions</h1>
        {user?.role === "DOCTOR" && (
          <button
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            Write Prescription
          </button>
        )}
      </div>

      {/* Prescription form */}
      {showForm && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 rounded-xl bg-white p-6 shadow-sm"
        >
          <h2 className="mb-4 font-semibold">New Prescription</h2>

          <div className="mb-4 grid grid-cols-2 gap-4">
            <input
              required
              placeholder="Appointment ID"
              value={form.appointmentId}
              onChange={(e) => setForm({ ...form, appointmentId: e.target.value })}
              className="rounded-lg border px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Patient ID"
              value={form.patientId}
              onChange={(e) => setForm({ ...form, patientId: e.target.value })}
              className="rounded-lg border px-3 py-2 text-sm"
            />
            <input
              required
              placeholder="Diagnosis"
              value={form.diagnosis}
              onChange={(e) => setForm({ ...form, diagnosis: e.target.value })}
              className="col-span-2 rounded-lg border px-3 py-2 text-sm"
            />
          </div>

          {/* Medicines */}
          <div className="mb-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-medium">Medicines</p>
              <button
                type="button"
                onClick={addMedicine}
                className="text-sm font-medium text-primary"
              >
                + Add Medicine
              </button>
            </div>
            {medicines.map((med, idx) => (
              <div
                key={idx}
                className="mb-2 grid grid-cols-6 gap-2 rounded-lg border bg-gray-50 p-3"
              >
                <input
                  placeholder="Medicine name"
                  value={med.medicineName}
                  onChange={(e) => updateMedicine(idx, "medicineName", e.target.value)}
                  className="col-span-2 rounded border px-2 py-1.5 text-sm"
                />
                <input
                  placeholder="Dosage"
                  value={med.dosage}
                  onChange={(e) => updateMedicine(idx, "dosage", e.target.value)}
                  className="rounded border px-2 py-1.5 text-sm"
                />
                <select
                  value={med.frequency}
                  onChange={(e) => updateMedicine(idx, "frequency", e.target.value)}
                  className="rounded border px-2 py-1.5 text-sm"
                >
                  <option value="">Frequency</option>
                  {FREQUENCY_OPTIONS.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="Duration"
                  value={med.duration}
                  onChange={(e) => updateMedicine(idx, "duration", e.target.value)}
                  className="rounded border px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => removeMedicine(idx)}
                  className="text-sm text-red-500"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4">
            <textarea
              placeholder="Advice / Notes"
              value={form.advice}
              onChange={(e) => setForm({ ...form, advice: e.target.value })}
              className="rounded-lg border px-3 py-2 text-sm"
              rows={2}
            />
            <div>
              <label className="mb-1 block text-sm">Follow-up Date</label>
              <input
                type="date"
                value={form.followUpDate}
                onChange={(e) => setForm({ ...form, followUpDate: e.target.value })}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
            >
              Save Prescription
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-lg border px-4 py-2 text-sm"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Prescriptions list */}
      <div className="space-y-3">
        {loading ? (
          <div className="rounded-xl bg-white p-8 text-center text-gray-500">
            Loading...
          </div>
        ) : prescriptions.length === 0 ? (
          <div className="rounded-xl bg-white p-8 text-center text-gray-500">
            No prescriptions found
          </div>
        ) : (
          prescriptions.map((rx) => (
            <div key={rx.id} className="rounded-xl bg-white p-4 shadow-sm">
              <button
                onClick={() =>
                  setExpanded(expanded === rx.id ? null : rx.id)
                }
                className="w-full text-left"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium">{rx.patient.user.name}</p>
                    <p className="text-sm text-gray-500">
                      Diagnosis: {rx.diagnosis}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium">
                      {rx.doctor.user.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {new Date(rx.createdAt).toLocaleDateString("en-IN")}
                    </p>
                  </div>
                </div>
              </button>

              {expanded === rx.id && (
                <div className="mt-4 border-t pt-4">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="pb-2">Medicine</th>
                        <th className="pb-2">Dosage</th>
                        <th className="pb-2">Frequency</th>
                        <th className="pb-2">Duration</th>
                        <th className="pb-2">Instructions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rx.items.map((item, i) => (
                        <tr key={i} className="border-t">
                          <td className="py-2 font-medium">
                            {item.medicineName}
                          </td>
                          <td className="py-2">{item.dosage}</td>
                          <td className="py-2">{item.frequency}</td>
                          <td className="py-2">{item.duration}</td>
                          <td className="py-2 text-gray-500">
                            {item.instructions || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rx.advice && (
                    <p className="mt-3 text-sm">
                      <span className="font-medium">Advice:</span> {rx.advice}
                    </p>
                  )}
                  {rx.followUpDate && (
                    <p className="mt-1 text-sm">
                      <span className="font-medium">Follow-up:</span>{" "}
                      {new Date(rx.followUpDate).toLocaleDateString("en-IN")}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
