"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

// ─── Types ─────────────────────────────────────────

interface Doctor {
  id: string;
  user: { name: string };
  specialization: string;
}

interface Appointment {
  id: string;
  tokenNumber: number;
  date: string;
  slotStart: string | null;
  type: string;
  status: string;
  priority: string;
  patient: { user: { name: string; phone: string }; mrNumber?: string };
  doctor: { user: { name: string } };
}

interface Slot {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

interface CalendarEvent {
  id: string;
  patientName: string;
  doctorId: string;
  doctorName: string;
  startDateTime: string;
  endDateTime: string;
  status: string;
  tokenNumber: number;
  type: string;
  priority: string;
}

interface StatsData {
  totalCount: number;
  byStatus: Record<string, number>;
  completedCount: number;
  cancelledCount: number;
  noShowCount: number;
  avgConsultationTimeMin: number;
  peakHour: number | null;
  peakHourCount: number;
}

type PatientTab = "upcoming" | "past" | "cancelled";
type ViewMode = "list" | "calendar" | "stats";

// ─── Constants ─────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  BOOKED: "bg-blue-100 text-blue-700",
  CHECKED_IN: "bg-yellow-100 text-yellow-700",
  IN_CONSULTATION: "bg-green-100 text-green-700",
  COMPLETED: "bg-gray-100 text-gray-700",
  CANCELLED: "bg-red-100 text-red-700",
  NO_SHOW: "bg-slate-100 text-slate-600",
};

const STATUS_BLOCK_COLORS: Record<string, string> = {
  BOOKED: "bg-blue-500 border-blue-600",
  CHECKED_IN: "bg-yellow-500 border-yellow-600",
  IN_CONSULTATION: "bg-green-500 border-green-600",
  COMPLETED: "bg-gray-400 border-gray-500",
  CANCELLED: "bg-red-500 border-red-600",
  NO_SHOW: "bg-slate-400 border-slate-500",
};

const STATUS_HEX: Record<string, string> = {
  BOOKED: "#3b82f6",
  CHECKED_IN: "#eab308",
  IN_CONSULTATION: "#22c55e",
  COMPLETED: "#6b7280",
  CANCELLED: "#ef4444",
  NO_SHOW: "#64748b",
};

const ALL_STATUSES = [
  "BOOKED",
  "CHECKED_IN",
  "IN_CONSULTATION",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ─── Date helpers (manual, no deps) ────────────────

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  r.setDate(r.getDate() - r.getDay()); // Sunday
  return r;
}

function formatShortDate(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function dayOfWeekName(s: string): string {
  const d = new Date(s);
  if (isNaN(d.getTime())) return "";
  return DAY_NAMES[d.getDay()];
}

// ─── Simple chart components (inline — mirror analytics patterns) ─

function DonutChart({
  segments,
  size = 180,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const radius = size / 2 - 10;
  const strokeW = 28;
  const circumference = 2 * Math.PI * radius;

  if (total === 0) {
    return (
      <div className="flex flex-col items-center">
        <div
          className="flex items-center justify-center rounded-full text-sm text-gray-400"
          style={{ width: size, height: size, border: "28px solid #f3f4f6" }}
        >
          No data
        </div>
      </div>
    );
  }

  let acc = 0;
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`translate(${size / 2}, ${size / 2}) rotate(-90)`}>
          <circle r={radius} fill="none" stroke="#f3f4f6" strokeWidth={strokeW} />
          {segments.map((seg, i) => {
            const frac = seg.value / total;
            const dash = frac * circumference;
            const gap = circumference - dash;
            const c = (
              <circle
                key={i}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeW}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-acc}
              >
                <title>{`${seg.label}: ${seg.value} (${((frac * 100) | 0)}%)`}</title>
              </circle>
            );
            acc += dash;
            return c;
          })}
        </g>
      </svg>
      <div className="mt-3 flex flex-wrap justify-center gap-x-3 gap-y-1">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-block h-3 w-3 rounded-sm"
              style={{ backgroundColor: seg.color }}
            />
            <span className="text-gray-700">
              {seg.label} ({seg.value})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HBarChart({
  items,
}: {
  items: { label: string; value: number; color: string }[];
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="space-y-3">
      {items.map((it) => {
        const pct = (it.value / max) * 100;
        return (
          <div key={it.label}>
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700">{it.label}</span>
              <span className="text-gray-600">{it.value}</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: it.color }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Page ──────────────────────────────────────────

export default function AppointmentsPage() {
  const { user } = useAuthStore();
  const isPatient = user?.role === "PATIENT";

  // View toggle
  const [view, setView] = useState<ViewMode>("list");

  // Shared
  const [doctors, setDoctors] = useState<Doctor[]>([]);

  // ─── List view state ──────────────
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBooking, setShowBooking] = useState(false);
  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [selectedDate, setSelectedDate] = useState(toISODate(new Date()));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [filterDate, setFilterDate] = useState(toISODate(new Date()));
  const [patientTab, setPatientTab] = useState<PatientTab>("upcoming");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  // Recurring booking options
  const [isRecurring, setIsRecurring] = useState(false);
  const [recFrequency, setRecFrequency] = useState<"DAILY" | "WEEKLY" | "MONTHLY">("WEEKLY");
  const [recOccurrences, setRecOccurrences] = useState(4);

  // Reschedule modal
  const [reschedTarget, setReschedTarget] = useState<Appointment | null>(null);
  const [reschedDate, setReschedDate] = useState(toISODate(new Date()));
  const [reschedSlots, setReschedSlots] = useState<Slot[]>([]);
  const [reschedLoading, setReschedLoading] = useState(false);

  // ─── Calendar view state ──────────
  const [calWeekStart, setCalWeekStart] = useState<Date>(startOfWeek(new Date()));
  const [calDoctor, setCalDoctor] = useState<string>("");
  const [calEvents, setCalEvents] = useState<CalendarEvent[]>([]);
  const [calLoading, setCalLoading] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);

  // ─── Stats view state ─────────────
  const [statsFrom, setStatsFrom] = useState(toISODate(addDays(new Date(), -30)));
  const [statsTo, setStatsTo] = useState(toISODate(new Date()));
  const [statsDoctor, setStatsDoctor] = useState<string>("");
  const [stats, setStats] = useState<StatsData | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [statsEvents, setStatsEvents] = useState<CalendarEvent[]>([]);

  // ─── Loaders ──────────────────────

  const loadDoctors = useCallback(async () => {
    try {
      const res = await api.get<{ data: Doctor[] }>("/doctors");
      setDoctors(res.data);
    } catch {
      // empty
    }
  }, []);

  const loadAppointments = useCallback(async () => {
    setLoading(true);
    try {
      const endpoint = isPatient
        ? `/appointments?limit=200`
        : `/appointments?date=${filterDate}&limit=100`;
      const res = await api.get<{ data: Appointment[] }>(endpoint);
      setAppointments(res.data);
    } catch {
      // empty
    }
    setLoading(false);
  }, [isPatient, filterDate]);

  const loadSlots = useCallback(async (doctorId: string, date: string) => {
    try {
      const res = await api.get<{ data: { slots: Slot[] } }>(
        `/doctors/${doctorId}/slots?date=${date}`
      );
      setSlots(res.data.slots);
    } catch {
      setSlots([]);
    }
  }, []);

  const loadCalendar = useCallback(async () => {
    setCalLoading(true);
    try {
      const from = toISODate(calWeekStart);
      const to = toISODate(addDays(calWeekStart, 6));
      const qs = new URLSearchParams();
      qs.set("from", from);
      qs.set("to", to);
      if (calDoctor) qs.set("doctorId", calDoctor);
      const res = await api.get<{ data: CalendarEvent[] }>(
        `/appointments/calendar?${qs.toString()}`
      );
      setCalEvents(res.data);
    } catch {
      setCalEvents([]);
    }
    setCalLoading(false);
  }, [calWeekStart, calDoctor]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const qs = new URLSearchParams();
      qs.set("from", statsFrom);
      qs.set("to", statsTo);
      if (statsDoctor) qs.set("doctorId", statsDoctor);
      const [sres, cres] = await Promise.all([
        api.get<{ data: StatsData }>(`/appointments/stats?${qs.toString()}`),
        api.get<{ data: CalendarEvent[] }>(`/appointments/calendar?${qs.toString()}`),
      ]);
      setStats(sres.data);
      setStatsEvents(cres.data);
    } catch {
      setStats(null);
      setStatsEvents([]);
    }
    setStatsLoading(false);
  }, [statsFrom, statsTo, statsDoctor]);

  // ─── Effects ──────────────────────

  useEffect(() => {
    loadDoctors();
  }, [loadDoctors]);

  useEffect(() => {
    if (view === "list") loadAppointments();
  }, [view, loadAppointments]);

  useEffect(() => {
    if (view === "calendar") loadCalendar();
  }, [view, loadCalendar]);

  useEffect(() => {
    if (view === "stats") loadStats();
  }, [view, loadStats]);

  // ─── Actions ──────────────────────

  async function bookAppointment(slotStartTime: string) {
    const patientId = prompt("Enter Patient ID:");
    if (!patientId) return;

    try {
      if (isRecurring) {
        await api.post("/appointments/recurring", {
          patientId,
          doctorId: selectedDoctor,
          startDate: selectedDate,
          slotStart: slotStartTime,
          frequency: recFrequency,
          occurrences: recOccurrences,
        });
        alert(`Created ${recOccurrences} recurring appointments.`);
      } else {
        await api.post("/appointments/book", {
          patientId,
          doctorId: selectedDoctor,
          date: selectedDate,
          slotId: slotStartTime,
        });
        alert("Appointment booked!");
      }
      setShowBooking(false);
      setIsRecurring(false);
      loadAppointments();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Booking failed");
    }
  }

  async function updateStatus(appointmentId: string, status: string) {
    try {
      await api.patch(`/appointments/${appointmentId}/status`, { status });
      loadAppointments();
      if (view === "calendar") loadCalendar();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Update failed");
    }
  }

  function handleCancelClick(appointmentId: string) {
    setCancellingId(appointmentId);
  }

  async function confirmCancel() {
    if (!cancellingId) return;
    try {
      await api.patch(`/appointments/${cancellingId}/status`, {
        status: "CANCELLED",
      });
      setCancellingId(null);
      loadAppointments();
      if (view === "calendar") loadCalendar();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Cancel failed");
      setCancellingId(null);
    }
  }

  function openReschedule(apt: Appointment) {
    setReschedTarget(apt);
    setReschedDate(apt.date.slice(0, 10));
    loadReschedSlots(apt, apt.date.slice(0, 10));
  }

  async function loadReschedSlots(apt: Appointment, date: string) {
    setReschedLoading(true);
    try {
      // Find doctor id — appointments include nested doctor but no id on `doctor` due to type
      // We have apt.id but need doctorId; the list endpoint returns doctor with name only in this page.
      // Re-fetch the full appointment to get doctorId.
      const full = await api.get<{ data: { doctorId: string } }>(
        `/appointments/${apt.id}`
      );
      const doctorId = full.data.doctorId;
      const res = await api.get<{ data: { slots: Slot[] } }>(
        `/doctors/${doctorId}/slots?date=${date}`
      );
      setReschedSlots(res.data.slots);
    } catch {
      setReschedSlots([]);
    }
    setReschedLoading(false);
  }

  async function confirmReschedule(slotStart: string) {
    if (!reschedTarget) return;
    try {
      await api.patch(`/appointments/${reschedTarget.id}/reschedule`, {
        date: reschedDate,
        slotStart,
      });
      alert("Appointment rescheduled.");
      setReschedTarget(null);
      setReschedSlots([]);
      loadAppointments();
      if (view === "calendar") loadCalendar();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Reschedule failed");
    }
  }

  // Group reschedule slots by date (even though we only query one date here, the spec says group by date)
  const reschedSlotsByDate = useMemo(() => {
    const map: Record<string, Slot[]> = {};
    if (!reschedSlots.length) return map;
    map[reschedDate] = reschedSlots;
    return map;
  }, [reschedSlots, reschedDate]);

  // ─── Derived list ─────────────────

  const filteredAppointments = useMemo(() => {
    let list = appointments;
    if (isPatient) {
      const today = toISODate(new Date());
      switch (patientTab) {
        case "upcoming":
          list = list.filter(
            (a) => ["BOOKED", "CHECKED_IN"].includes(a.status) && a.date.slice(0, 10) >= today
          );
          break;
        case "past":
          list = list.filter((a) => a.status === "COMPLETED");
          break;
        case "cancelled":
          list = list.filter((a) => ["CANCELLED", "NO_SHOW"].includes(a.status));
          break;
      }
    }
    if (statusFilter !== "ALL") {
      list = list.filter((a) => a.status === statusFilter);
    }
    return list;
  }, [appointments, isPatient, patientTab, statusFilter]);

  // ─── CSV export ───────────────────

  function exportCSV() {
    const rows = [
      ["Token", "Patient", "Phone", "Doctor", "Date", "Time", "Type", "Status", "Priority"],
      ...filteredAppointments.map((a) => [
        String(a.tokenNumber),
        a.patient.user.name,
        a.patient.user.phone ?? "",
        a.doctor.user.name,
        a.date.slice(0, 10),
        a.slotStart ?? "Walk-in",
        a.type,
        a.status,
        a.priority,
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map((cell) => {
            const s = String(cell ?? "");
            if (s.includes(",") || s.includes('"') || s.includes("\n")) {
              return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
          })
          .join(",")
      )
      .join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `appointments-${filterDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Calendar grid helpers ────────

  const calDays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(calWeekStart, i)),
    [calWeekStart]
  );

  const calHours = useMemo(
    () => Array.from({ length: 13 }, (_, i) => 8 + i), // 08:00..20:00
    []
  );

  // Organize events by day-iso for quick lookup
  const calEventsByDay = useMemo(() => {
    const map: Record<string, CalendarEvent[]> = {};
    for (const ev of calEvents) {
      const dayIso = ev.startDateTime.slice(0, 10);
      if (!map[dayIso]) map[dayIso] = [];
      map[dayIso].push(ev);
    }
    return map;
  }, [calEvents]);

  // ─── Stats derivations ────────────

  const statsByDoctor = useMemo(() => {
    const map: Record<string, { name: string; count: number }> = {};
    for (const ev of statsEvents) {
      if (!map[ev.doctorId]) {
        map[ev.doctorId] = { name: ev.doctorName, count: 0 };
      }
      map[ev.doctorId].count += 1;
    }
    return Object.values(map).sort((a, b) => b.count - a.count);
  }, [statsEvents]);

  const statsByDayOfWeek = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    for (const ev of statsEvents) {
      const d = new Date(ev.startDateTime);
      if (!isNaN(d.getTime())) counts[d.getDay()] += 1;
    }
    return DAY_NAMES.map((name, i) => ({
      label: name,
      value: counts[i],
      color: "#6366f1",
    }));
  }, [statsEvents]);

  // ─── UI helpers ───────────────────

  const tabClasses = (tab: PatientTab) =>
    `px-4 py-2 text-sm font-medium rounded-lg transition ${
      patientTab === tab
        ? "bg-primary text-white"
        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
    }`;

  const viewBtnClasses = (v: ViewMode) =>
    `px-4 py-2 text-sm font-medium transition ${
      view === v
        ? "bg-primary text-white"
        : "bg-white text-gray-700 hover:bg-gray-50"
    }`;

  return (
    <div>
      {/* Cancel confirmation dialog */}
      {cancellingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-800">Cancel Appointment</h3>
            <p className="mt-2 text-sm text-gray-600">
              Are you sure you want to cancel this appointment? This action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setCancellingId(null)}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Keep Appointment
              </button>
              <button
                onClick={confirmCancel}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
              >
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule modal */}
      {reschedTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">Reschedule</h3>
                <p className="text-sm text-gray-500">
                  {reschedTarget.patient.user.name} — Token #{reschedTarget.tokenNumber}
                </p>
              </div>
              <button
                onClick={() => {
                  setReschedTarget(null);
                  setReschedSlots([]);
                }}
                className="text-gray-400 hover:text-gray-600"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium">New Date</label>
              <input
                type="date"
                value={reschedDate}
                onChange={(e) => {
                  setReschedDate(e.target.value);
                  loadReschedSlots(reschedTarget, e.target.value);
                }}
                className="w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            <div className="mt-4">
              <p className="mb-2 text-sm font-medium">Available Slots</p>
              {reschedLoading ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : Object.keys(reschedSlotsByDate).length === 0 ? (
                <p className="text-sm text-gray-500">No slots available.</p>
              ) : (
                Object.entries(reschedSlotsByDate).map(([d, list]) => (
                  <div key={d} className="mb-3">
                    <p className="mb-1 text-xs font-semibold uppercase text-gray-500">
                      {formatShortDate(d)} ({dayOfWeekName(d)})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {list.map((s) => (
                        <button
                          key={s.startTime}
                          disabled={!s.isAvailable}
                          onClick={() => confirmReschedule(s.startTime)}
                          className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                            s.isAvailable
                              ? "bg-green-50 text-green-700 hover:bg-green-100"
                              : "cursor-not-allowed bg-gray-100 text-gray-400 line-through"
                          }`}
                        >
                          {s.startTime} - {s.endTime}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Calendar event details popup */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">
                  Token #{selectedEvent.tokenNumber}
                </h3>
                <p className="text-sm text-gray-500">
                  {selectedEvent.patientName} → Dr. {selectedEvent.doctorName}
                </p>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-gray-500">Start</p>
                <p className="font-medium">
                  {new Date(selectedEvent.startDateTime).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Status</p>
                <span
                  className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    STATUS_COLORS[selectedEvent.status] || ""
                  }`}
                >
                  {selectedEvent.status.replace(/_/g, " ")}
                </span>
              </div>
              <div>
                <p className="text-gray-500">Type</p>
                <p className="font-medium">{selectedEvent.type}</p>
              </div>
              <div>
                <p className="text-gray-500">Priority</p>
                <p className="font-medium">{selectedEvent.priority}</p>
              </div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              {["BOOKED", "CHECKED_IN"].includes(selectedEvent.status) && !isPatient && (
                <button
                  onClick={() => {
                    // Build a minimal Appointment shape for reschedule
                    const a: Appointment = {
                      id: selectedEvent.id,
                      tokenNumber: selectedEvent.tokenNumber,
                      date: selectedEvent.startDateTime,
                      slotStart: selectedEvent.startDateTime.slice(11, 16),
                      type: selectedEvent.type,
                      status: selectedEvent.status,
                      priority: selectedEvent.priority,
                      patient: { user: { name: selectedEvent.patientName, phone: "" } },
                      doctor: { user: { name: selectedEvent.doctorName } },
                    };
                    setSelectedEvent(null);
                    openReschedule(a);
                  }}
                  className="rounded bg-indigo-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-600"
                >
                  Reschedule
                </button>
              )}
              {["BOOKED", "CHECKED_IN"].includes(selectedEvent.status) && (
                <button
                  onClick={() => {
                    setCancellingId(selectedEvent.id);
                    setSelectedEvent(null);
                  }}
                  className="rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"
                >
                  Cancel
                </button>
              )}
              {selectedEvent.status === "IN_CONSULTATION" && !isPatient && (
                <button
                  onClick={() => {
                    updateStatus(selectedEvent.id, "COMPLETED");
                    setSelectedEvent(null);
                  }}
                  className="rounded bg-gray-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-700"
                >
                  Mark Complete
                </button>
              )}
              <a
                href={`/dashboard/patients`}
                className="rounded bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
              >
                View Patient
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {isPatient ? "My Appointments" : "Appointments"}
        </h1>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="inline-flex overflow-hidden rounded-lg border border-gray-200">
            <button onClick={() => setView("list")} className={viewBtnClasses("list")}>
              List
            </button>
            <button onClick={() => setView("calendar")} className={viewBtnClasses("calendar")}>
              Calendar
            </button>
            {!isPatient && (
              <button onClick={() => setView("stats")} className={viewBtnClasses("stats")}>
                Stats
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ───── LIST VIEW ───── */}
      {view === "list" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              {!isPatient && (
                <input
                  type="date"
                  value={filterDate}
                  onChange={(e) => setFilterDate(e.target.value)}
                  className="rounded-lg border px-3 py-2 text-sm"
                />
              )}
              <button
                onClick={exportCSV}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Export CSV
              </button>
            </div>
            {(user?.role === "RECEPTION" || user?.role === "ADMIN") && (
              <button
                onClick={() => setShowBooking(!showBooking)}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
              >
                Book Appointment
              </button>
            )}
          </div>

          {/* Status filter chips */}
          {!isPatient && (
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                onClick={() => setStatusFilter("ALL")}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  statusFilter === "ALL"
                    ? "bg-primary text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                All
              </button>
              {ALL_STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`rounded-full px-3 py-1 text-xs font-medium ${
                    statusFilter === s
                      ? "bg-primary text-white"
                      : STATUS_COLORS[s] + " hover:opacity-80"
                  }`}
                >
                  {s.replace(/_/g, " ")}
                </button>
              ))}
            </div>
          )}

          {/* Patient filter tabs */}
          {isPatient && (
            <div className="mb-4 flex gap-2">
              <button onClick={() => setPatientTab("upcoming")} className={tabClasses("upcoming")}>
                Upcoming
              </button>
              <button onClick={() => setPatientTab("past")} className={tabClasses("past")}>
                Past
              </button>
              <button onClick={() => setPatientTab("cancelled")} className={tabClasses("cancelled")}>
                Cancelled
              </button>
            </div>
          )}

          {/* Booking form */}
          {showBooking && (
            <div className="mb-6 rounded-xl bg-white p-6 shadow-sm">
              <h2 className="mb-4 font-semibold">Book New Appointment</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium">Doctor</label>
                  <select
                    value={selectedDoctor}
                    onChange={(e) => {
                      setSelectedDoctor(e.target.value);
                      if (e.target.value) loadSlots(e.target.value, selectedDate);
                    }}
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
                  <label className="mb-1 block text-sm font-medium">Date</label>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(e) => {
                      setSelectedDate(e.target.value);
                      if (selectedDoctor) loadSlots(selectedDoctor, e.target.value);
                    }}
                    className="w-full rounded-lg border px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={() => setIsRecurring(!isRecurring)}
                    className={`w-full rounded-lg px-3 py-2 text-sm font-medium ${
                      isRecurring
                        ? "bg-indigo-600 text-white hover:bg-indigo-700"
                        : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {isRecurring ? "Recurring ON" : "Book Recurring"}
                  </button>
                </div>
              </div>

              {isRecurring && (
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-sm font-medium">Frequency</label>
                    <select
                      value={recFrequency}
                      onChange={(e) =>
                        setRecFrequency(e.target.value as "DAILY" | "WEEKLY" | "MONTHLY")
                      }
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    >
                      <option value="DAILY">Daily</option>
                      <option value="WEEKLY">Weekly (same day)</option>
                      <option value="MONTHLY">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium">Occurrences</label>
                    <input
                      type="number"
                      min={2}
                      max={52}
                      value={recOccurrences}
                      onChange={(e) =>
                        setRecOccurrences(Math.max(2, Math.min(52, Number(e.target.value) || 2)))
                      }
                      className="w-full rounded-lg border px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              )}

              {slots.length > 0 && (
                <div className="mt-4">
                  <p className="mb-2 text-sm font-medium">
                    {isRecurring
                      ? "Pick a start slot (will repeat):"
                      : "Available Slots:"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {slots.map((slot) => (
                      <button
                        key={slot.startTime}
                        disabled={!slot.isAvailable}
                        onClick={() => bookAppointment(slot.startTime)}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                          slot.isAvailable
                            ? "bg-green-50 text-green-700 hover:bg-green-100"
                            : "cursor-not-allowed bg-gray-100 text-gray-400 line-through"
                        }`}
                      >
                        {slot.startTime} - {slot.endTime}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Appointments table */}
          <div className="rounded-xl bg-white shadow-sm">
            {loading ? (
              <div className="p-8 text-center text-gray-500">Loading...</div>
            ) : filteredAppointments.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                {isPatient
                  ? patientTab === "upcoming"
                    ? "No upcoming appointments"
                    : patientTab === "past"
                      ? "No past appointments"
                      : "No cancelled appointments"
                  : "No appointments match this filter"}
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b text-left text-sm text-gray-500">
                    <th className="px-4 py-3">Token</th>
                    {!isPatient && <th className="px-4 py-3">Patient</th>}
                    <th className="px-4 py-3">Doctor</th>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAppointments.map((apt) => (
                    <tr key={apt.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-bold">{apt.tokenNumber}</td>
                      {!isPatient && (
                        <td className="px-4 py-3">
                          <p className="font-medium">{apt.patient.user.name}</p>
                          <p className="text-xs text-gray-500">{apt.patient.user.phone}</p>
                        </td>
                      )}
                      <td className="px-4 py-3 text-sm">{apt.doctor.user.name}</td>
                      <td className="px-4 py-3 text-sm">{apt.date.slice(0, 10)}</td>
                      <td className="px-4 py-3 text-sm">{apt.slotStart || "Walk-in"}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded px-2 py-0.5 text-xs font-medium ${
                            apt.type === "WALK_IN"
                              ? "bg-orange-100 text-orange-700"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {apt.type === "WALK_IN" ? "Walk-in" : "Scheduled"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            STATUS_COLORS[apt.status] || ""
                          }`}
                        >
                          {apt.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          {/* Reschedule for BOOKED / CHECKED_IN */}
                          {["BOOKED", "CHECKED_IN"].includes(apt.status) &&
                            (isPatient ||
                              user?.role === "RECEPTION" ||
                              user?.role === "ADMIN" ||
                              user?.role === "DOCTOR" ||
                              user?.role === "NURSE") && (
                              <button
                                onClick={() => openReschedule(apt)}
                                className="rounded bg-indigo-500 px-2 py-1 text-xs text-white hover:bg-indigo-600"
                              >
                                Reschedule
                              </button>
                            )}
                          {apt.status === "BOOKED" &&
                            (isPatient ||
                              user?.role === "RECEPTION" ||
                              user?.role === "ADMIN") && (
                              <button
                                onClick={() => handleCancelClick(apt.id)}
                                className="rounded bg-red-500 px-2 py-1 text-xs text-white hover:bg-red-600"
                              >
                                Cancel
                              </button>
                            )}
                          {!isPatient && apt.status === "BOOKED" && (
                            <button
                              onClick={() => updateStatus(apt.id, "CHECKED_IN")}
                              className="rounded bg-yellow-500 px-2 py-1 text-xs text-white hover:bg-yellow-600"
                            >
                              Check In
                            </button>
                          )}
                          {!isPatient && apt.status === "CHECKED_IN" && (
                            <button
                              onClick={() => updateStatus(apt.id, "IN_CONSULTATION")}
                              className="rounded bg-green-500 px-2 py-1 text-xs text-white hover:bg-green-600"
                            >
                              Start Consult
                            </button>
                          )}
                          {!isPatient && apt.status === "IN_CONSULTATION" && (
                            <button
                              onClick={() => updateStatus(apt.id, "COMPLETED")}
                              className="rounded bg-gray-500 px-2 py-1 text-xs text-white hover:bg-gray-600"
                            >
                              Complete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ───── CALENDAR VIEW ───── */}
      {view === "calendar" && (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => setCalWeekStart(startOfWeek(new Date()))}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
              >
                Today
              </button>
              <button
                onClick={() => setCalWeekStart(addDays(calWeekStart, -7))}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
              >
                ← Prev Week
              </button>
              <button
                onClick={() => setCalWeekStart(addDays(calWeekStart, 7))}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
              >
                Next Week →
              </button>
              <span className="ml-2 text-sm font-medium text-gray-700">
                {formatShortDate(toISODate(calWeekStart))} –{" "}
                {formatShortDate(toISODate(addDays(calWeekStart, 6)))}
              </span>
            </div>
            <select
              value={calDoctor}
              onChange={(e) => setCalDoctor(e.target.value)}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              <option value="">All Doctors</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.user.name}
                </option>
              ))}
            </select>
          </div>

          <div className="overflow-x-auto rounded-xl bg-white shadow-sm">
            {calLoading ? (
              <div className="p-8 text-center text-gray-500">Loading calendar…</div>
            ) : (
              <div className="min-w-200">
                {/* Header row */}
                <div
                  className="grid border-b bg-gray-50 text-xs font-semibold text-gray-700"
                  style={{ gridTemplateColumns: "60px repeat(7, 1fr)" }}
                >
                  <div className="px-2 py-2" />
                  {calDays.map((d) => {
                    const iso = toISODate(d);
                    const isToday = iso === toISODate(new Date());
                    return (
                      <div
                        key={iso}
                        className={`border-l px-2 py-2 text-center ${
                          isToday ? "bg-blue-50 text-blue-700" : ""
                        }`}
                      >
                        <div>{DAY_NAMES[d.getDay()]}</div>
                        <div className="text-sm font-bold">{d.getDate()}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Hour rows */}
                {calHours.map((h) => (
                  <div
                    key={h}
                    className="grid border-b text-xs"
                    style={{
                      gridTemplateColumns: "60px repeat(7, 1fr)",
                      minHeight: "56px",
                    }}
                  >
                    <div className="border-r px-2 py-1 text-right text-gray-500">
                      {String(h).padStart(2, "0")}:00
                    </div>
                    {calDays.map((d) => {
                      const iso = toISODate(d);
                      const dayEvents = calEventsByDay[iso] || [];
                      const hourEvents = dayEvents.filter((ev) => {
                        const hr = parseInt(ev.startDateTime.slice(11, 13), 10);
                        return hr === h;
                      });
                      return (
                        <div
                          key={iso + "-" + h}
                          className="relative border-l bg-white hover:bg-gray-50"
                        >
                          {hourEvents.map((ev) => {
                            const min = parseInt(ev.startDateTime.slice(14, 16), 10) || 0;
                            const topPct = (min / 60) * 100;
                            const hPct = 25; // ~15min block of 60min row = 25%
                            return (
                              <button
                                key={ev.id}
                                onClick={() => setSelectedEvent(ev)}
                                className={`absolute left-1 right-1 overflow-hidden rounded border px-1.5 py-0.5 text-left text-[10px] font-medium text-white shadow-sm ${
                                  STATUS_BLOCK_COLORS[ev.status] ||
                                  "bg-gray-400 border-gray-500"
                                }`}
                                style={{
                                  top: `${topPct}%`,
                                  height: `${hPct}%`,
                                  minHeight: "20px",
                                }}
                                title={`${ev.patientName} — ${ev.doctorName} (${ev.status})`}
                              >
                                <div className="truncate">
                                  #{ev.tokenNumber} {ev.patientName}
                                </div>
                                <div className="truncate opacity-90">
                                  {ev.startDateTime.slice(11, 16)} · Dr. {ev.doctorName}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Legend */}
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {ALL_STATUSES.map((s) => (
              <div key={s} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: STATUS_HEX[s] }}
                />
                <span className="text-gray-700">{s.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ───── STATS VIEW ───── */}
      {view === "stats" && !isPatient && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">From</label>
              <input
                type="date"
                value={statsFrom}
                onChange={(e) => setStatsFrom(e.target.value)}
                className="rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">To</label>
              <input
                type="date"
                value={statsTo}
                onChange={(e) => setStatsTo(e.target.value)}
                className="rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Doctor</label>
              <select
                value={statsDoctor}
                onChange={(e) => setStatsDoctor(e.target.value)}
                className="rounded-lg border px-3 py-2 text-sm"
              >
                <option value="">All Doctors</option>
                {doctors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.user.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <button
                onClick={loadStats}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
              >
                Refresh
              </button>
            </div>
          </div>

          {statsLoading ? (
            <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
              Loading stats…
            </div>
          ) : !stats ? (
            <div className="rounded-xl bg-white p-8 text-center text-gray-500 shadow-sm">
              No data.
            </div>
          ) : (
            <>
              {/* Summary cards */}
              <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                <StatCard label="Total" value={stats.totalCount} color="bg-blue-50 text-blue-700" />
                <StatCard
                  label="Completed"
                  value={stats.completedCount}
                  color="bg-green-50 text-green-700"
                />
                <StatCard
                  label="Cancelled"
                  value={stats.cancelledCount}
                  color="bg-red-50 text-red-700"
                />
                <StatCard
                  label="No-Show"
                  value={stats.noShowCount}
                  color="bg-slate-50 text-slate-700"
                />
                <StatCard
                  label="Avg Consult (min)"
                  value={stats.avgConsultationTimeMin}
                  color="bg-indigo-50 text-indigo-700"
                />
                <StatCard
                  label="Peak Hour"
                  value={
                    stats.peakHour !== null
                      ? `${String(stats.peakHour).padStart(2, "0")}:00`
                      : "—"
                  }
                  color="bg-amber-50 text-amber-700"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <section className="rounded-xl bg-white p-5 shadow-sm">
                  <h2 className="mb-4 font-semibold">By Status</h2>
                  <DonutChart
                    segments={ALL_STATUSES.map((s) => ({
                      label: s.replace(/_/g, " "),
                      value: stats.byStatus[s] || 0,
                      color: STATUS_HEX[s],
                    })).filter((s) => s.value > 0)}
                  />
                </section>

                <section className="rounded-xl bg-white p-5 shadow-sm">
                  <h2 className="mb-4 font-semibold">By Doctor</h2>
                  {statsByDoctor.length === 0 ? (
                    <p className="text-sm text-gray-500">No data.</p>
                  ) : (
                    <HBarChart
                      items={statsByDoctor.map((s) => ({
                        label: s.name,
                        value: s.count,
                        color: "#0ea5e9",
                      }))}
                    />
                  )}
                </section>

                <section className="rounded-xl bg-white p-5 shadow-sm">
                  <h2 className="mb-4 font-semibold">By Day of Week</h2>
                  <HBarChart items={statsByDayOfWeek} />
                </section>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number | string;
  color: string;
}) {
  return (
    <div className={`rounded-xl p-4 shadow-sm ${color}`}>
      <p className="text-xs font-medium uppercase opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
