"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Doctor {
  id: string;
  user: { name: string };
  specialization: string;
}

interface PatientResult {
  id: string;
  mrNumber: string;
  user: { name: string; phone: string };
}

export default function WalkInPage() {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<PatientResult[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<PatientResult | null>(null);
  const [showNewPatient, setShowNewPatient] = useState(false);
  const [newPatient, setNewPatient] = useState({
    name: "",
    phone: "",
    gender: "MALE",
    age: "",
  });
  const [result, setResult] = useState<{
    tokenNumber: number;
    doctorName: string;
    patientName: string;
  } | null>(null);

  useEffect(() => {
    api
      .get<{ data: Doctor[] }>("/doctors")
      .then((r) => setDoctors(r.data))
      .catch(() => {});
  }, []);

  async function searchPatients(q: string) {
    setSearch(q);
    if (q.length < 2) {
      setSearchResults([]);
      return;
    }
    try {
      const res = await api.get<{ data: PatientResult[] }>(
        `/patients?search=${encodeURIComponent(q)}&limit=5`
      );
      setSearchResults(res.data);
    } catch {
      // empty
    }
  }

  async function registerAndWalkIn() {
    try {
      // Register new patient first
      const patientRes = await api.post<{ data: PatientResult }>("/patients", {
        name: newPatient.name,
        phone: newPatient.phone,
        gender: newPatient.gender,
        age: newPatient.age ? parseInt(newPatient.age) : undefined,
      });

      // Then register walk-in
      await submitWalkIn(patientRes.data.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Registration failed");
    }
  }

  async function submitWalkIn(patientId: string) {
    try {
      const res = await api.post<{
        data: {
          tokenNumber: number;
          doctor: { user: { name: string } };
          patient: { user: { name: string } };
        };
      }>("/appointments/walk-in", {
        patientId,
        doctorId: selectedDoctor,
        priority,
        notes: notes || undefined,
      });

      setResult({
        tokenNumber: res.data.tokenNumber,
        doctorName: res.data.doctor.user.name,
        patientName: res.data.patient.user.name,
      });

      // Reset form
      setSelectedPatient(null);
      setSearch("");
      setNotes("");
      setPriority("NORMAL");
      setShowNewPatient(false);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Walk-in registration failed");
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">Walk-in Registration</h1>

      {/* Success token display */}
      {result && (
        <div className="mb-6 rounded-xl bg-green-50 border-2 border-green-200 p-8 text-center">
          <p className="text-sm text-green-600">Token Assigned</p>
          <p className="text-6xl font-bold text-green-700">{result.tokenNumber}</p>
          <p className="mt-2 text-lg">{result.patientName}</p>
          <p className="text-sm text-gray-500">Doctor: {result.doctorName}</p>
          <button
            onClick={() => setResult(null)}
            className="mt-4 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-white"
          >
            Register Next
          </button>
        </div>
      )}

      {!result && (
        <div className="rounded-xl bg-white p-6 shadow-sm">
          {/* Step 1: Select Doctor */}
          <div className="mb-6">
            <label className="mb-2 block font-medium">1. Select Doctor</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {doctors.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDoctor(d.id)}
                  className={`rounded-lg border-2 p-3 text-left text-sm transition ${
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
          </div>

          {/* Step 2: Find or register patient */}
          <div className="mb-6">
            <label className="mb-2 block font-medium">2. Patient</label>

            {selectedPatient ? (
              <div className="flex items-center justify-between rounded-lg bg-green-50 p-3">
                <div>
                  <p className="font-medium">{selectedPatient.user.name}</p>
                  <p className="text-sm text-gray-500">
                    {selectedPatient.mrNumber} | {selectedPatient.user.phone}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedPatient(null)}
                  className="text-sm text-red-500"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <input
                  placeholder="Search patient by name, phone, or MR number..."
                  value={search}
                  onChange={(e) => searchPatients(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
                {searchResults.length > 0 && (
                  <div className="mt-2 rounded-lg border">
                    {searchResults.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedPatient(p);
                          setSearchResults([]);
                        }}
                        className="w-full border-b px-3 py-2 text-left text-sm last:border-0 hover:bg-gray-50"
                      >
                        {p.user.name} — {p.mrNumber} — {p.user.phone}
                      </button>
                    ))}
                  </div>
                )}
                <button
                  onClick={() => setShowNewPatient(true)}
                  className="mt-2 text-sm font-medium text-primary"
                >
                  + New Patient
                </button>

                {showNewPatient && (
                  <div className="mt-3 rounded-lg border bg-gray-50 p-4">
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        placeholder="Name"
                        value={newPatient.name}
                        onChange={(e) =>
                          setNewPatient({ ...newPatient, name: e.target.value })
                        }
                        className="rounded border px-2 py-1.5 text-sm"
                      />
                      <input
                        placeholder="Phone"
                        value={newPatient.phone}
                        onChange={(e) =>
                          setNewPatient({ ...newPatient, phone: e.target.value })
                        }
                        className="rounded border px-2 py-1.5 text-sm"
                      />
                      <select
                        value={newPatient.gender}
                        onChange={(e) =>
                          setNewPatient({
                            ...newPatient,
                            gender: e.target.value,
                          })
                        }
                        className="rounded border px-2 py-1.5 text-sm"
                      >
                        <option value="MALE">Male</option>
                        <option value="FEMALE">Female</option>
                        <option value="OTHER">Other</option>
                      </select>
                      <input
                        placeholder="Age"
                        type="number"
                        value={newPatient.age}
                        onChange={(e) =>
                          setNewPatient({ ...newPatient, age: e.target.value })
                        }
                        className="rounded border px-2 py-1.5 text-sm"
                      />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Step 3: Priority & Notes */}
          <div className="mb-6 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">Priority</label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              >
                <option value="NORMAL">Normal</option>
                <option value="URGENT">Urgent</option>
                <option value="EMERGENCY">Emergency</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">Notes</label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
          </div>

          {/* Submit */}
          <button
            disabled={!selectedDoctor || (!selectedPatient && !showNewPatient)}
            onClick={() => {
              if (selectedPatient) {
                submitWalkIn(selectedPatient.id);
              } else if (showNewPatient) {
                registerAndWalkIn();
              }
            }}
            className="w-full rounded-lg bg-secondary py-3 font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Assign Token
          </button>
        </div>
      )}
    </div>
  );
}
