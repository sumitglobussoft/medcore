"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Complaint {
  id: string;
  ticketNumber: string;
  patientId: string | null;
  name: string | null;
  phone: string | null;
  category: string;
  description: string;
  status: string;
  priority: string;
  assignedTo: string | null;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
  patient?: { user: { name: string; phone: string } };
}

interface UserOption {
  id: string;
  name: string;
  role: string;
}

interface Stats {
  total: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
  avgResolutionHours: number;
  overdueCount: number;
  criticalOpen: number;
}

const TABS: Array<{ key: string; label: string; status?: string }> = [
  { key: "OPEN", label: "Open", status: "OPEN" },
  { key: "UNDER_REVIEW", label: "Under Review", status: "UNDER_REVIEW" },
  { key: "RESOLVED", label: "Resolved", status: "RESOLVED" },
  { key: "ALL", label: "All" },
];

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
const CATEGORIES = [
  "Service",
  "Billing",
  "Cleanliness",
  "Staff Behavior",
  "Food",
  "Wait Time",
  "Other",
];

export default function ComplaintsPage() {
  const [complaints, setComplaints] = useState<Complaint[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [tab, setTab] = useState("OPEN");
  const [showModal, setShowModal] = useState(false);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveText, setResolveText] = useState("");
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    patientId: "",
    category: "Service",
    description: "",
    priority: "MEDIUM",
  });

  useEffect(() => {
    load();
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function load() {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      const current = TABS.find((t) => t.key === tab);
      if (current?.status) qs.set("status", current.status);
      qs.set("limit", "100");

      const [listRes, statsRes] = await Promise.all([
        api.get<{ data: Complaint[] }>(`/complaints?${qs.toString()}`),
        api.get<{ data: Stats }>(`/complaints/stats`),
      ]);
      setComplaints(listRes.data);
      setStats(statsRes.data);
    } catch {
      // empty
    }
    setLoading(false);
  }

  async function loadUsers() {
    try {
      const res = await api.get<{ data: UserOption[] }>("/chat/users");
      setUsers(res.data.filter((u) => u.role === "ADMIN" || u.role === "RECEPTION"));
    } catch {
      // empty
    }
  }

  async function submit() {
    if (!form.description) {
      alert("Description required");
      return;
    }
    try {
      const body: Record<string, unknown> = {
        category: form.category,
        description: form.description,
        priority: form.priority,
      };
      if (form.patientId) body.patientId = form.patientId;
      if (form.name) body.name = form.name;
      if (form.phone) body.phone = form.phone;
      if (!form.patientId && !form.name) {
        alert("Either patient ID or caller name required");
        return;
      }
      await api.post("/complaints", body);
      setShowModal(false);
      setForm({
        name: "",
        phone: "",
        patientId: "",
        category: "Service",
        description: "",
        priority: "MEDIUM",
      });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  }

  async function assign(id: string, userId: string) {
    try {
      await api.patch(`/complaints/${id}`, { assignedTo: userId });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  }

  async function changeStatus(id: string, status: string) {
    try {
      await api.patch(`/complaints/${id}`, { status });
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  }

  async function resolveSubmit() {
    if (!resolveId) return;
    try {
      await api.patch(`/complaints/${resolveId}`, {
        status: "RESOLVED",
        resolution: resolveText,
      });
      setResolveId(null);
      setResolveText("");
      load();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed");
    }
  }

  const priorityColor: Record<string, string> = {
    LOW: "bg-gray-100 text-gray-700",
    MEDIUM: "bg-blue-100 text-blue-700",
    HIGH: "bg-orange-100 text-orange-700",
    CRITICAL: "bg-red-100 text-red-700",
  };

  const statusColor: Record<string, string> = {
    OPEN: "bg-yellow-100 text-yellow-700",
    UNDER_REVIEW: "bg-blue-100 text-blue-700",
    RESOLVED: "bg-green-100 text-green-700",
    ESCALATED: "bg-red-100 text-red-700",
    CLOSED: "bg-gray-100 text-gray-700",
  };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Complaints</h1>
        <button
          onClick={() => setShowModal(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
        >
          New Complaint
        </button>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">Open</p>
          <p className="text-2xl font-bold text-yellow-600">
            {stats?.byStatus.OPEN || 0}
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">Critical Open</p>
          <p className="text-2xl font-bold text-red-600">
            {stats?.criticalOpen || 0}
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">Overdue (&gt;7d)</p>
          <p className="text-2xl font-bold text-orange-600">
            {stats?.overdueCount || 0}
          </p>
        </div>
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <p className="text-xs text-gray-500">Avg Resolution</p>
          <p className="text-2xl font-bold text-gray-700">
            {stats?.avgResolutionHours || 0}h
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              tab === t.key
                ? "bg-primary text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl bg-white shadow-sm">
        {loading ? (
          <div className="p-8 text-center text-gray-500">Loading...</div>
        ) : complaints.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            No complaints in this category
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b text-left text-sm text-gray-500">
                <th className="px-4 py-3">Ticket</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Assigned</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {complaints.map((c) => {
                const assignee = users.find((u) => u.id === c.assignedTo);
                return (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-mono text-xs font-semibold">
                      {c.ticketNumber}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {c.patient?.user.name || c.name || "-"}
                    </td>
                    <td className="px-4 py-3 text-sm">{c.category}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityColor[c.priority] || ""}`}
                      >
                        {c.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor[c.status] || ""}`}
                      >
                        {c.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={c.assignedTo || ""}
                        onChange={(e) => assign(c.id, e.target.value)}
                        className="rounded border px-2 py-1 text-xs"
                        disabled={c.status === "RESOLVED" || c.status === "CLOSED"}
                      >
                        <option value="">
                          {assignee ? assignee.name : "Unassigned"}
                        </option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {c.status === "OPEN" && (
                          <button
                            onClick={() => changeStatus(c.id, "UNDER_REVIEW")}
                            className="rounded bg-blue-500 px-2 py-1 text-xs text-white hover:bg-blue-600"
                          >
                            Review
                          </button>
                        )}
                        {c.status !== "RESOLVED" && c.status !== "CLOSED" && (
                          <button
                            onClick={() => setResolveId(c.id)}
                            className="rounded bg-green-500 px-2 py-1 text-xs text-white hover:bg-green-600"
                          >
                            Resolve
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* New complaint modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold">New Complaint</h3>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Patient ID (optional)
                </label>
                <input
                  value={form.patientId}
                  onChange={(e) =>
                    setForm({ ...form, patientId: e.target.value })
                  }
                  placeholder="UUID of patient if known"
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Caller Name
                  </label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Phone
                  </label>
                  <input
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
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
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-gray-600">
                    Priority
                  </label>
                  <select
                    value={form.priority}
                    onChange={(e) =>
                      setForm({ ...form, priority: e.target.value })
                    }
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  >
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-600">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) =>
                    setForm({ ...form, description: e.target.value })
                  }
                  rows={4}
                  className="w-full rounded-lg border px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
              >
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Resolve modal */}
      {resolveId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold">Resolve Complaint</h3>
            <textarea
              value={resolveText}
              onChange={(e) => setResolveText(e.target.value)}
              placeholder="Describe the resolution..."
              rows={4}
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => {
                  setResolveId(null);
                  setResolveText("");
                }}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={resolveSubmit}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white"
              >
                Mark Resolved
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
