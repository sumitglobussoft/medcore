"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

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
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; phone?: string }>({});
  const [result, setResult] = useState<{
    tokenNumber: number;
    doctorName: string;
    patientName: string;
    // Issue #118: surface MR number on the success card alongside the
    // patient name so the front-desk can confirm at a glance.
    mrNumber: string;
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

  function validateNewPatient(): boolean {
    const errs: { name?: string; phone?: string } = {};
    if (!newPatient.name.trim()) errs.name = "Name is required";
    const digits = newPatient.phone.replace(/\D/g, "");
    if (!newPatient.phone.trim()) errs.phone = "Phone number is required";
    else if (digits.length < 10 || digits.length > 13)
      errs.phone = "Enter a valid 10-digit phone";
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function registerAndWalkIn() {
    if (!validateNewPatient()) return;
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
      toast.error(err instanceof Error ? err.message : "Registration failed");
    }
  }

  async function submitWalkIn(patientId: string) {
    try {
      const res = await api.post<{
        data: {
          tokenNumber: number;
          doctor: { user: { name: string } };
          patient: { user: { name: string }; mrNumber?: string };
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
        // Issue #118: server may return mrNumber on the embedded patient.
        // Fall back to the locally selected patient (search result) when
        // not present so the success card never goes blank.
        mrNumber:
          res.data.patient.mrNumber ?? selectedPatient?.mrNumber ?? "",
      });

      // Reset form
      setSelectedPatient(null);
      setSearch("");
      setNotes("");
      setPriority("NORMAL");
      setShowNewPatient(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Walk-in registration failed");
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold text-gray-900 dark:text-gray-100">Walk-in Registration</h1>

      {/* Success token display — Issue #118: patient name + MR number must
          be prominent. Previously the patient name rendered as a thin
          text-lg line that visually disappeared next to the giant token. */}
      {result && (
        <div
          className="mb-6 rounded-xl bg-green-50 border-2 border-green-200 p-8 text-center"
          data-testid="walkin-success"
        >
          <p className="text-sm text-green-600">Token Assigned</p>
          <p
            className="text-6xl font-bold text-green-700"
            data-testid="walkin-token"
          >
            {result.tokenNumber}
          </p>
          <p
            className="mt-3 text-2xl font-semibold text-gray-900 dark:text-gray-100"
            data-testid="walkin-patient-name"
          >
            {result.patientName}
          </p>
          {result.mrNumber && (
            <p
              className="mt-1 text-sm font-medium text-gray-700 dark:text-gray-300"
              data-testid="walkin-mr-number"
            >
              MR # {result.mrNumber}
            </p>
          )}
          <p className="mt-2 text-sm text-gray-500">Doctor: {result.doctorName}</p>
          <button
            onClick={() => setResult(null)}
            className="mt-4 rounded-lg bg-primary px-6 py-2 text-sm font-medium text-white"
          >
            Register Next
          </button>
        </div>
      )}

      {!result && (
        <div className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
          {/* Step 1: Select Doctor */}
          <div className="mb-6">
            <label className="mb-2 block font-medium">1. Select Doctor</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {doctors.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setSelectedDoctor(d.id)}
                  className={`rounded-lg border-2 p-3 text-left text-sm text-gray-900 transition dark:text-gray-100 ${
                    selectedDoctor === d.id
                      ? "border-primary bg-blue-50 dark:border-blue-400 dark:bg-blue-900/30"
                      : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-500"
                  }`}
                >
                  <p className="font-medium">{d.user.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{d.specialization}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Find or register patient */}
          <div className="mb-6">
            <label className="mb-2 block font-medium">2. Patient</label>

            {selectedPatient ? (
              <div className="flex items-center justify-between rounded-lg bg-green-50 p-3 dark:bg-green-900/30">
                <div>
                  <p className="font-medium text-gray-900 dark:text-gray-100">{selectedPatient.user.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-300">
                    {selectedPatient.mrNumber} | {selectedPatient.user.phone}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedPatient(null)}
                  className="text-sm text-red-500 dark:text-red-400"
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
                  className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
                />
                {searchResults.length > 0 && (
                  <div className="mt-2 rounded-lg border border-gray-200 dark:border-gray-700">
                    {searchResults.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => {
                          setSelectedPatient(p);
                          setSearchResults([]);
                        }}
                        className="w-full border-b border-gray-200 px-3 py-2 text-left text-sm text-gray-900 last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-100 dark:hover:bg-gray-700"
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
                  <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <input
                          placeholder="Name"
                          value={newPatient.name}
                          onChange={(e) =>
                            setNewPatient({ ...newPatient, name: e.target.value })
                          }
                          className={`w-full rounded border bg-white px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500 ${
                            fieldErrors.name ? "border-red-500" : "border-gray-200 dark:border-gray-600"
                          }`}
                        />
                        {fieldErrors.name && (
                          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.name}</p>
                        )}
                      </div>
                      <div>
                        <input
                          placeholder="Phone"
                          value={newPatient.phone}
                          onChange={(e) =>
                            setNewPatient({ ...newPatient, phone: e.target.value })
                          }
                          className={`w-full rounded border bg-white px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500 ${
                            fieldErrors.phone ? "border-red-500" : "border-gray-200 dark:border-gray-600"
                          }`}
                        />
                        {fieldErrors.phone && (
                          <p className="mt-1 text-xs text-red-600 dark:text-red-400">{fieldErrors.phone}</p>
                        )}
                      </div>
                      <select
                        value={newPatient.gender}
                        onChange={(e) =>
                          setNewPatient({
                            ...newPatient,
                            gender: e.target.value,
                          })
                        }
                        className="rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
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
                        className="rounded border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
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
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
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
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder-gray-400 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
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
