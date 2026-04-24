"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { useAuthStore } from "@/lib/store";
import { Search, Plus, Pill, X } from "lucide-react";

interface Medicine {
  id: string;
  name: string;
  genericName?: string | null;
  form?: string | null;
  strength?: string | null;
  category?: string | null;
  rxRequired?: boolean;
  manufacturer?: string | null;
  interactions?: Interaction[];
}

interface Interaction {
  id: string;
  severity: string;
  description: string;
  interactsWith?: { id: string; name: string };
}

const CATEGORIES = [
  "",
  "Antibiotic",
  "Analgesic",
  "Antiviral",
  "Antifungal",
  "Antihypertensive",
  "Antidiabetic",
  "Cardiac",
  "Respiratory",
  "Gastrointestinal",
  "Psychiatric",
  "Other",
];

export default function MedicinesPage() {
  const { user } = useAuthStore();
  const [medicines, setMedicines] = useState<Medicine[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [selected, setSelected] = useState<Medicine | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({
    name: "",
    genericName: "",
    form: "",
    strength: "",
    category: "",
    rxRequired: true,
    manufacturer: "",
  });

  const isAdmin = user?.role === "ADMIN";

  useEffect(() => {
    load();
  }, [search, category]);

  async function load() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (category) params.set("category", category);
      const q = params.toString() ? `?${params.toString()}` : "";
      const res = await api.get<{ data: Medicine[] }>(`/medicines${q}`);
      setMedicines(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  async function openDetail(m: Medicine) {
    try {
      const res = await api.get<{ data: Medicine }>(`/medicines/${m.id}`);
      setSelected(res.data);
    } catch {
      setSelected(m);
    }
  }

  async function createMedicine(e: React.FormEvent) {
    e.preventDefault();
    // Issue #41: Manufacturer is required. Guard here in addition to the
    // `required` attribute (which covers the happy path) and the server-side
    // Zod refinement (which is the source of truth).
    if (!form.manufacturer.trim()) {
      toast.error("Manufacturer is required");
      return;
    }
    try {
      await api.post("/medicines", {
        ...form,
        genericName: form.genericName || undefined,
        form: form.form || undefined,
        strength: form.strength || undefined,
        category: form.category || undefined,
        manufacturer: form.manufacturer.trim(),
      });
      setShowAdd(false);
      setForm({
        name: "",
        genericName: "",
        form: "",
        strength: "",
        category: "",
        rxRequired: true,
        manufacturer: "",
      });
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create medicine");
    }
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Medicines</h1>
          <p className="text-sm text-gray-500">
            Medicine catalog &amp; interactions
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            <Plus size={16} /> Add Medicine
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
          />
          <input
            placeholder="Search medicines..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border px-3 py-2 pl-9 text-sm"
          />
        </div>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c || "All Categories"}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
          Loading...
        </div>
      ) : medicines.length === 0 ? (
        <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
          No medicines found.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {medicines.map((m) => (
            <button
              key={m.id}
              onClick={() => openDetail(m)}
              className="rounded-xl bg-white p-4 text-left shadow-sm hover:shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <Pill size={16} className="text-primary" />
                  <div>
                    <h3 className="font-semibold">{m.name}</h3>
                    {m.genericName && (
                      <p className="text-xs text-gray-500">
                        {m.genericName}
                      </p>
                    )}
                  </div>
                </div>
                {m.rxRequired && (
                  <span className="rounded bg-red-100 px-1.5 py-0.5 text-xs text-red-700">
                    Rx
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm text-gray-600">
                {[m.form, m.strength].filter(Boolean).join(" · ") || "—"}
              </p>
              <p
                className="mt-1 text-xs text-gray-500"
                data-testid="medicine-manufacturer"
              >
                Mfg: {m.manufacturer || "—"}
              </p>
              {m.category && (
                <span className="mt-2 inline-block rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                  {m.category}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h2 className="text-xl font-bold">{selected.name}</h2>
                {selected.genericName && (
                  <p className="text-sm text-gray-500">
                    {selected.genericName}
                  </p>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="rounded p-1 hover:bg-gray-100"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="Form" value={selected.form || "—"} />
              <Info label="Strength" value={selected.strength || "—"} />
              <Info label="Category" value={selected.category || "—"} />
              <Info
                label="Rx Required"
                value={selected.rxRequired ? "Yes" : "No"}
              />
              <Info
                label="Manufacturer"
                value={selected.manufacturer || "—"}
                fullWidth
              />
            </div>

            <div className="mt-4 border-t pt-4">
              <h3 className="mb-2 font-semibold">Drug Interactions</h3>
              {!selected.interactions || selected.interactions.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No known interactions recorded.
                </p>
              ) : (
                <div className="space-y-2">
                  {selected.interactions.map((i) => (
                    <div
                      key={i.id}
                      className={`rounded-lg border-l-4 bg-gray-50 p-3 ${
                        i.severity === "MAJOR"
                          ? "border-red-500"
                          : i.severity === "MODERATE"
                            ? "border-yellow-500"
                            : "border-blue-400"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {i.interactsWith?.name}
                        </span>
                        <span className="text-xs font-semibold">
                          {i.severity}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-gray-600">
                        {i.description}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Medicine Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form
            onSubmit={createMedicine}
            className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
          >
            <h2 className="mb-4 text-lg font-semibold">Add Medicine</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium">Name</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Generic Name
                  </label>
                  <input
                    value={form.genericName}
                    onChange={(e) =>
                      setForm({ ...form, genericName: e.target.value })
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Category
                  </label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      setForm({ ...form, category: e.target.value })
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c || "—"}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">Form</label>
                  <input
                    placeholder="Tablet, Syrup..."
                    value={form.form}
                    onChange={(e) => setForm({ ...form, form: e.target.value })}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    Strength
                  </label>
                  <input
                    placeholder="500mg"
                    value={form.strength}
                    onChange={(e) =>
                      setForm({ ...form, strength: e.target.value })
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  Manufacturer <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  value={form.manufacturer}
                  onChange={(e) =>
                    setForm({ ...form, manufacturer: e.target.value })
                  }
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.rxRequired}
                  onChange={(e) =>
                    setForm({ ...form, rxRequired: e.target.checked })
                  }
                />
                Prescription required (Rx)
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="rounded-lg border px-4 py-2 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Info({
  label,
  value,
  fullWidth = false,
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <div className={fullWidth ? "col-span-2" : ""}>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}
