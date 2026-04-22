"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import {
  Bot,
  Send,
  AlertTriangle,
  Phone,
  CheckCircle,
  Loader2,
  User,
  Stethoscope,
  Calendar,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface SpecialtySuggestion {
  specialty: string;
  confidence: number;
  reasoning: string;
}

interface DoctorSuggestion {
  doctorId: string;
  name: string;
  specialty: string;
  qualification?: string;
  photoUrl?: string;
  reasoning: string;
  confidence: number;
}

interface Slot {
  startTime: string;
  endTime: string;
  isAvailable: boolean;
}

// ─── Component ───────────────────────────────────────────

export default function AIBookingPage() {
  const { token, user } = useAuthStore();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [isEmergency, setIsEmergency] = useState(false);
  const [emergencyReason, setEmergencyReason] = useState("");
  const [readyForDoctors, setReadyForDoctors] = useState(false);
  const [doctorSuggestions, setDoctorSuggestions] = useState<DoctorSuggestion[]>([]);
  const [selectedDoctor, setSelectedDoctor] = useState<DoctorSuggestion | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<Slot | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [bookingDone, setBookingDone] = useState(false);
  const [bookedAppointment, setBookedAppointment] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => { scrollToBottom(); }, [messages]);

  const startSession = useCallback(async () => {
    setStarting(true);
    try {
      const res = await api.post<any>(
        "/ai/triage/start",
        { language, inputMode: "text" },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const { sessionId: sid, message } = res.data.data;
      setSessionId(sid);
      setMessages([{ role: "assistant", content: message, timestamp: new Date().toISOString() }]);
    } catch {
      toast.error("Failed to start AI assistant");
    } finally {
      setStarting(false);
    }
  }, [language, token]);

  useEffect(() => { startSession(); }, [startSession]);

  const sendMessage = async () => {
    if (!input.trim() || !sessionId || loading) return;
    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage, timestamp: new Date().toISOString() }]);
    setLoading(true);

    try {
      const res = await api.post<any>(
        `/ai/triage/${sessionId}/message`,
        { message: userMessage },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const data = res.data.data;

      if (data.isEmergency) {
        setIsEmergency(true);
        setEmergencyReason(data.emergencyReason || "");
        setMessages((prev) => [...prev, { role: "assistant", content: data.message, timestamp: new Date().toISOString() }]);
        return;
      }

      setMessages((prev) => [...prev, { role: "assistant", content: data.message, timestamp: new Date().toISOString() }]);

      if (data.readyForDoctorSuggestion) {
        setReadyForDoctors(true);
        fetchDoctorSuggestions();
      }
    } catch {
      toast.error("Failed to send message");
    } finally {
      setLoading(false);
    }
  };

  const fetchDoctorSuggestions = async () => {
    if (!sessionId) return;
    try {
      const res = await api.get<any>(`/ai/triage/${sessionId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setDoctorSuggestions(res.data.data.doctorSuggestions || []);
    } catch {
      toast.error("Failed to fetch doctor suggestions");
    }
  };

  const fetchSlots = async (doctorId: string, date: string) => {
    try {
      const res = await api.get<any>(`/doctors/${doctorId}/slots?date=${date}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setSlots(res.data.data.slots || []);
    } catch {
      toast.error("Failed to fetch slots");
    }
  };

  const handleDoctorSelect = (doctor: DoctorSuggestion) => {
    setSelectedDoctor(doctor);
    setSelectedSlot(null);
    setSlots([]);
    const today = new Date();
    today.setDate(today.getDate() + 1);
    const dateStr = today.toISOString().split("T")[0];
    setSelectedDate(dateStr);
    fetchSlots(doctor.doctorId, dateStr);
  };

  const handleDateChange = (date: string) => {
    setSelectedDate(date);
    if (selectedDoctor) fetchSlots(selectedDoctor.doctorId, date);
  };

  const handleBook = async () => {
    if (!sessionId || !selectedDoctor || !selectedSlot || !selectedDate) return;
    setLoading(true);
    try {
      const patient = await api.get<any>("/patients?limit=1", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const patientId = patient.data.data.patients?.[0]?.id;
      if (!patientId) { toast.error("Patient record not found"); return; }

      const res = await api.post<any>(
        `/ai/triage/${sessionId}/book`,
        {
          doctorId: selectedDoctor.doctorId,
          date: selectedDate,
          slotStart: selectedSlot.startTime,
          slotEnd: selectedSlot.endTime,
          patientId,
        },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setBookedAppointment(res.data.data.appointment);
      setBookingDone(true);
      toast.success("Appointment booked successfully!");
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Booking failed");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  };

  // ── Emergency screen ──────────────────────────────────
  if (isEmergency) {
    return (
      <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
        <div className="max-w-lg w-full bg-white rounded-2xl shadow-xl border-2 border-red-500 p-8 text-center">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-red-700 mb-2">Emergency Detected</h1>
          <p className="text-gray-600 mb-4">{emergencyReason}</p>
          <div className="bg-red-100 rounded-xl p-4 mb-6 text-left space-y-2">
            <p className="font-semibold text-red-800">Please act immediately:</p>
            <p className="text-red-700 flex items-center gap-2"><Phone className="w-4 h-4" /> Call <strong>112</strong> or your hospital emergency number</p>
            <p className="text-red-700">Go to the nearest Emergency Department</p>
          </div>
          <p className="text-xs text-gray-400">This AI assistant cannot handle emergencies. Please seek immediate care.</p>
        </div>
      </div>
    );
  }

  // ── Booking confirmation ──────────────────────────────
  if (bookingDone && bookedAppointment) {
    return (
      <div className="min-h-screen bg-green-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl p-8 text-center">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Appointment Booked!</h1>
          <div className="bg-gray-50 rounded-xl p-4 text-left space-y-2 mb-6">
            <p className="text-sm text-gray-600"><span className="font-medium">Doctor:</span> {selectedDoctor?.name}</p>
            <p className="text-sm text-gray-600"><span className="font-medium">Specialty:</span> {selectedDoctor?.specialty}</p>
            <p className="text-sm text-gray-600"><span className="font-medium">Date:</span> {selectedDate}</p>
            <p className="text-sm text-gray-600"><span className="font-medium">Time:</span> {selectedSlot?.startTime}</p>
            <p className="text-sm text-gray-600"><span className="font-medium">Token:</span> #{bookedAppointment.tokenNumber}</p>
          </div>
          <button
            onClick={() => { setBookingDone(false); setSessionId(null); setMessages([]); setReadyForDoctors(false); startSession(); }}
            className="flex items-center gap-2 mx-auto px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            <RefreshCw className="w-4 h-4" /> Book another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-4 p-4">
      {/* ── Chat panel ─────────────────────────────────── */}
      <div className="flex flex-col flex-1 bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-semibold text-gray-800 text-sm">MedCore AI Assistant</p>
            <p className="text-xs text-gray-500">Appointment routing assistant — not a diagnostic tool</p>
          </div>
          <div className="ml-auto flex gap-2">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "hi")}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white"
            >
              <option value="en">English</option>
              <option value="hi">हिंदी</option>
            </select>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {starting ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-blue-600" />
                  </div>
                )}
                <div
                  className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white rounded-tr-sm"
                      : "bg-gray-100 text-gray-800 rounded-tl-sm"
                  }`}
                >
                  {msg.content}
                </div>
                {msg.role === "user" && (
                  <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <User className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
            ))
          )}
          {loading && (
            <div className="flex gap-2 justify-start">
              <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-blue-600" />
              </div>
              <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-2.5">
                <div className="flex gap-1 items-center h-5">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-gray-100">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={language === "hi" ? "अपनी तकलीफ बताएँ..." : "Describe your symptoms..."}
              rows={1}
              disabled={loading || starting || !sessionId}
              className="flex-1 resize-none border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
            />
            <button
              onClick={sendMessage}
              disabled={loading || starting || !input.trim() || !sessionId}
              className="w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Send className="w-4 h-4 text-white" />
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-1 text-center">
            {language === "hi"
              ? "यह एक अपॉइंटमेंट बुकिंग सहायक है, डायग्नोसिस टूल नहीं।"
              : "Appointment routing only — not a diagnostic tool. For emergencies, call 112."}
          </p>
        </div>
      </div>

      {/* ── Doctor suggestion panel ────────────────────── */}
      {readyForDoctors && (
        <div className="w-96 flex flex-col bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-emerald-50 to-teal-50">
            <p className="font-semibold text-gray-800 text-sm flex items-center gap-2">
              <Stethoscope className="w-4 h-4 text-emerald-600" />
              Recommended Doctors
            </p>
            <p className="text-xs text-gray-500">Based on your symptoms</p>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {doctorSuggestions.length === 0 ? (
              <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                No doctors available for suggested specialty
              </div>
            ) : (
              doctorSuggestions.map((doc) => (
                <button
                  key={doc.doctorId}
                  onClick={() => handleDoctorSelect(doc)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    selectedDoctor?.doctorId === doc.doctorId
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-blue-200 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm text-gray-800">{doc.name}</p>
                      <p className="text-xs text-blue-600">{doc.specialty}</p>
                      {doc.qualification && <p className="text-xs text-gray-400">{doc.qualification}</p>}
                    </div>
                    <div className="flex-shrink-0 text-right">
                      <p className="text-xs font-medium text-emerald-600">{Math.round(doc.confidence * 100)}% match</p>
                      <ChevronRight className="w-4 h-4 text-gray-400 ml-auto" />
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{doc.reasoning}</p>
                </button>
              ))
            )}
          </div>

          {/* Slot picker */}
          {selectedDoctor && (
            <div className="border-t border-gray-100 p-3 space-y-3">
              <p className="text-xs font-semibold text-gray-600 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> Select Date & Slot
              </p>
              <input
                type="date"
                value={selectedDate}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => handleDateChange(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {slots.length > 0 ? (
                <div className="grid grid-cols-3 gap-1.5 max-h-28 overflow-y-auto">
                  {slots.filter((s) => s.isAvailable).map((slot) => (
                    <button
                      key={slot.startTime}
                      onClick={() => setSelectedSlot(slot)}
                      className={`text-xs py-1.5 rounded-lg border transition-all ${
                        selectedSlot?.startTime === slot.startTime
                          ? "bg-blue-600 text-white border-blue-600"
                          : "border-gray-200 hover:border-blue-300"
                      }`}
                    >
                      {slot.startTime}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center py-2">No slots available</p>
              )}
              <button
                onClick={handleBook}
                disabled={!selectedSlot || loading}
                className="w-full py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                Confirm Appointment
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
