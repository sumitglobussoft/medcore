"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface QueuePatient {
  tokenNumber: number;
  patientName: string;
  patientId: string;
  appointmentId: string;
  status: string;
  hasVitals: boolean;
}

interface Doctor {
  id: string;
  user: { name: string };
  specialization: string;
}

export default function VitalsPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [queue, setQueue] = useState<QueuePatient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<QueuePatient | null>(null);
  const [form, setForm] = useState({
    bloodPressureSystolic: "",
    bloodPressureDiastolic: "",
    temperature: "",
    weight: "",
    height: "",
    pulseRate: "",
    spO2: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .get<{ data: Doctor[] }>("/doctors")
      .then((r) => setDoctors(r.data))
      .catch(() => {});
  }, []);

  async function loadQueue(doctorId: string) {
    try {
      const today = new Date().toISOString().split("T")[0];
      const res = await api.get<{
        data: { queue: QueuePatient[] };
      }>(`/queue/${doctorId}?date=${today}`);
      setQueue(
        res.data.queue.filter(
          (q) => !q.hasVitals && q.status !== "COMPLETED" && q.status !== "CANCELLED"
        )
      );
    } catch {
      setQueue([]);
    }
  }

  async function saveVitals(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatient) return;

    setSaving(true);
    try {
      await api.post(`/patients/${selectedPatient.patientId}/vitals`, {
        appointmentId: selectedPatient.appointmentId,
        patientId: selectedPatient.patientId,
        bloodPressureSystolic: form.bloodPressureSystolic
          ? parseInt(form.bloodPressureSystolic)
          : undefined,
        bloodPressureDiastolic: form.bloodPressureDiastolic
          ? parseInt(form.bloodPressureDiastolic)
          : undefined,
        temperature: form.temperature
          ? parseFloat(form.temperature)
          : undefined,
        weight: form.weight ? parseFloat(form.weight) : undefined,
        height: form.height ? parseFloat(form.height) : undefined,
        pulseRate: form.pulseRate ? parseInt(form.pulseRate) : undefined,
        spO2: form.spO2 ? parseInt(form.spO2) : undefined,
        notes: form.notes || undefined,
      });

      alert("Vitals saved!");
      setSelectedPatient(null);
      setForm({
        bloodPressureSystolic: "",
        bloodPressureDiastolic: "",
        temperature: "",
        weight: "",
        height: "",
        pulseRate: "",
        spO2: "",
        notes: "",
      });
      if (selectedDoctor) loadQueue(selectedDoctor);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to save vitals");
    }
    setSaving(false);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-6 text-2xl font-bold">Record Vitals</h1>

      {/* Doctor selection */}
      <div className="mb-6 grid grid-cols-3 gap-2">
        {doctors.map((d) => (
          <button
            key={d.id}
            onClick={() => {
              setSelectedDoctor(d.id);
              loadQueue(d.id);
            }}
            className={`rounded-lg border-2 p-3 text-left text-sm ${
              selectedDoctor === d.id
                ? "border-primary bg-blue-50"
                : "border-gray-200 hover:border-gray-300"
            }`}
          >
            <p className="font-medium">{d.user.name}</p>
            <p className="text-xs text-gray-500">{d.specialization}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Patient queue (no vitals yet) */}
        <div className="col-span-1">
          <h2 className="mb-3 font-semibold">Awaiting Vitals</h2>
          {queue.length === 0 ? (
            <p className="text-sm text-gray-500">
              {selectedDoctor
                ? "All patients have vitals"
                : "Select a doctor"}
            </p>
          ) : (
            <div className="space-y-2">
              {queue.map((p) => (
                <button
                  key={p.appointmentId}
                  onClick={() => setSelectedPatient(p)}
                  className={`w-full rounded-lg border-2 p-3 text-left ${
                    selectedPatient?.appointmentId === p.appointmentId
                      ? "border-primary bg-blue-50"
                      : "border-gray-200"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                      {p.tokenNumber}
                    </span>
                    <span className="text-sm font-medium">{p.patientName}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Vitals form */}
        <div className="col-span-2">
          {selectedPatient ? (
            <form onSubmit={saveVitals} className="rounded-xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-semibold">
                Vitals — Token #{selectedPatient.tokenNumber} ({selectedPatient.patientName})
              </h2>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    BP Systolic (mmHg)
                  </label>
                  <input
                    type="number"
                    value={form.bloodPressureSystolic}
                    onChange={(e) =>
                      setForm({ ...form, bloodPressureSystolic: e.target.value })
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="120"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    BP Diastolic (mmHg)
                  </label>
                  <input
                    type="number"
                    value={form.bloodPressureDiastolic}
                    onChange={(e) =>
                      setForm({ ...form, bloodPressureDiastolic: e.target.value })
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="80"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Temperature (F)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.temperature}
                    onChange={(e) =>
                      setForm({ ...form, temperature: e.target.value })
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="98.6"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Pulse Rate (bpm)
                  </label>
                  <input
                    type="number"
                    value={form.pulseRate}
                    onChange={(e) =>
                      setForm({ ...form, pulseRate: e.target.value })
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="72"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    SpO2 (%)
                  </label>
                  <input
                    type="number"
                    value={form.spO2}
                    onChange={(e) =>
                      setForm({ ...form, spO2: e.target.value })
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="98"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Weight (kg)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.weight}
                    onChange={(e) =>
                      setForm({ ...form, weight: e.target.value })
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="70"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Height (cm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={form.height}
                    onChange={(e) =>
                      setForm({ ...form, height: e.target.value })
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                    placeholder="170"
                  />
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1 block text-sm font-medium">Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                  rows={2}
                  placeholder="Any additional observations..."
                />
              </div>

              <button
                type="submit"
                disabled={saving}
                className="mt-4 w-full rounded-lg bg-secondary py-2.5 font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save Vitals"}
              </button>
            </form>
          ) : (
            <div className="flex h-64 items-center justify-center rounded-xl bg-white text-gray-400 shadow-sm">
              Select a patient to record vitals
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
