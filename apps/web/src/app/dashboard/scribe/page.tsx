"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import {
  Mic,
  MicOff,
  FileText,
  CheckCircle,
  Loader2,
  AlertTriangle,
  ShieldAlert,
  AlertOctagon,
  ChevronDown,
  ChevronUp,
  Edit3,
  Save,
  X,
  Activity,
  Clipboard,
  Pill,
  FlaskConical,
  UserCheck,
} from "lucide-react";

// ─── Types ───────────────────────────────────────────────

interface DrugInteractionAlert {
  drug1: string;
  drug2: string;
  severity: "MILD" | "MODERATE" | "SEVERE" | "CONTRAINDICATED";
  description: string;
}

interface DrugSafetyReport {
  alerts: DrugInteractionAlert[];
  hasContraindicated: boolean;
  hasSevere: boolean;
  checkedAt: string;
  checkedMeds: string[];
}

interface SOAPNote {
  subjective?: {
    chiefComplaint?: string;
    hpi?: string;
    pastMedicalHistory?: string;
    medications?: string[];
    allergies?: string[];
  };
  objective?: { vitals?: string; examinationFindings?: string };
  assessment?: {
    impression?: string;
    icd10Codes?: { code: string; description: string; confidence: number; evidenceSpan?: string }[];
  };
  plan?: {
    medications?: { name: string; dose: string; frequency: string; duration: string; notes?: string }[];
    investigations?: string[];
    procedures?: string[];
    referrals?: string[];
    followUpTimeline?: string;
    patientInstructions?: string;
  };
}

// ─── Section component ───────────────────────────────────

function SOAPSection({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className="flex items-center gap-2 font-semibold text-sm text-gray-700">
          {icon} {title}
        </span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>
      {open && <div className="p-4">{children}</div>}
    </div>
  );
}

function EditableField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
        {!editing ? (
          <button onClick={() => { setDraft(value); setEditing(true); }} className="text-xs text-blue-500 hover:underline flex items-center gap-1">
            <Edit3 className="w-3 h-3" /> Edit
          </button>
        ) : (
          <div className="flex gap-2">
            <button onClick={() => { onChange(draft); setEditing(false); }} className="text-xs text-green-600 hover:underline flex items-center gap-1">
              <Save className="w-3 h-3" /> Save
            </button>
            <button onClick={() => setEditing(false)} className="text-xs text-gray-400 hover:underline flex items-center gap-1">
              <X className="w-3 h-3" /> Cancel
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="w-full border border-blue-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      ) : (
        <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 min-h-[2.5rem]">
          {value || <span className="text-gray-400 italic">Not captured</span>}
        </p>
      )}
    </div>
  );
}

// ─── Drug Alert Banner ───────────────────────────────────

const SEVERITY_CONFIG = {
  CONTRAINDICATED: { bg: "bg-red-50", border: "border-red-400", text: "text-red-800", badge: "bg-red-600 text-white", icon: AlertOctagon, label: "CONTRAINDICATED" },
  SEVERE: { bg: "bg-orange-50", border: "border-orange-400", text: "text-orange-800", badge: "bg-orange-500 text-white", icon: ShieldAlert, label: "SEVERE" },
  MODERATE: { bg: "bg-yellow-50", border: "border-yellow-400", text: "text-yellow-800", badge: "bg-yellow-500 text-white", icon: AlertTriangle, label: "MODERATE" },
  MILD: { bg: "bg-blue-50", border: "border-blue-300", text: "text-blue-800", badge: "bg-blue-400 text-white", icon: AlertTriangle, label: "MILD" },
};

function DrugAlertBanner({
  report,
  acknowledged,
  onAcknowledge,
}: {
  report: DrugSafetyReport;
  acknowledged: boolean;
  onAcknowledge: () => void;
}) {
  if (!report.alerts.length) return null;

  const sortOrder = { CONTRAINDICATED: 0, SEVERE: 1, MODERATE: 2, MILD: 3 };
  const sorted = [...report.alerts].sort((a, b) => sortOrder[a.severity] - sortOrder[b.severity]);

  return (
    <div className={`rounded-xl border-2 p-4 space-y-3 ${report.hasContraindicated ? "border-red-400 bg-red-50" : "border-orange-300 bg-orange-50"}`}>
      <div className="flex items-center gap-2">
        <ShieldAlert className={`w-5 h-5 ${report.hasContraindicated ? "text-red-600" : "text-orange-500"}`} />
        <p className={`font-semibold text-sm ${report.hasContraindicated ? "text-red-800" : "text-orange-800"}`}>
          Drug Safety Alerts — {report.alerts.length} {report.alerts.length === 1 ? "issue" : "issues"} found
        </p>
        <span className="text-xs text-gray-400 ml-auto">Checked: {new Date(report.checkedAt).toLocaleTimeString()}</span>
      </div>

      <div className="space-y-2">
        {sorted.map((alert, i) => {
          const cfg = SEVERITY_CONFIG[alert.severity];
          const Icon = cfg.icon;
          return (
            <div key={i} className={`rounded-lg border p-3 ${cfg.bg} ${cfg.border}`}>
              <div className="flex items-start gap-2">
                <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${cfg.text}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${cfg.badge}`}>{cfg.label}</span>
                    <span className="text-xs font-medium text-gray-800">{alert.drug1}</span>
                    <span className="text-xs text-gray-500">+</span>
                    <span className="text-xs font-medium text-gray-800">{alert.drug2}</span>
                  </div>
                  <p className={`text-xs ${cfg.text}`}>{alert.description}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {report.hasContraindicated && !acknowledged && (
        <div className="border-t border-red-200 pt-3">
          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              onChange={(e) => e.target.checked && onAcknowledge()}
              className="mt-0.5 w-4 h-4 accent-red-600"
            />
            <span className="text-xs text-red-800 font-medium">
              I have reviewed the CONTRAINDICATED alert(s) above and accept clinical responsibility for prescribing despite this warning.
            </span>
          </label>
        </div>
      )}
      {report.hasContraindicated && acknowledged && (
        <p className="text-xs text-red-700 font-medium flex items-center gap-1">
          <CheckCircle className="w-3.5 h-3.5" /> Override acknowledged — you may now sign off.
        </p>
      )}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────

export default function ScribePage() {
  const { token } = useAuthStore();
  const [appointments, setAppointments] = useState<any[]>([]);
  const [selectedAppointment, setSelectedAppointment] = useState<any>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [soapDraft, setSoapDraft] = useState<SOAPNote | null>(null);
  const [editedSOAP, setEditedSOAP] = useState<SOAPNote | null>(null);
  const [signedOff, setSignedOff] = useState(false);
  const [loading, setLoading] = useState(false);
  const [transcriptLength, setTranscriptLength] = useState(0);
  const [liveText, setLiveText] = useState("");
  const [rxSafetyReport, setRxSafetyReport] = useState<DrugSafetyReport | null>(null);
  const [alertsAcknowledged, setAlertsAcknowledged] = useState(false);
  const recognitionRef = useRef<any>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch today's appointments for this doctor
  useEffect(() => {
    const fetchAppts = async () => {
      try {
        const today = new Date().toISOString().split("T")[0];
        const res = await api.get<any>(`/appointments?date=${today}&status=CHECKED_IN,BOOKED`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setAppointments(res.data.data?.appointments || []);
      } catch {
        // silent
      }
    };
    fetchAppts();
  }, [token]);

  // Poll for SOAP updates while recording
  useEffect(() => {
    if (recording && sessionId) {
      pollRef.current = setInterval(async () => {
        try {
          const res = await api.get<any>(`/ai/scribe/${sessionId}/soap`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.data.data?.soapDraft) {
            setSoapDraft(res.data.data.soapDraft);
            setEditedSOAP(res.data.data.soapDraft);
          }
          if (res.data.data?.rxDraft?.alerts) {
            setRxSafetyReport(res.data.data.rxDraft);
            setAlertsAcknowledged(false);
          }
        } catch { /* silent */ }
      }, 15000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [recording, sessionId, token]);

  const startScribe = async (appointment: any) => {
    setLoading(true);
    try {
      const res = await api.post<any>(
        "/ai/scribe/start",
        { appointmentId: appointment.id, consentObtained: true, audioRetentionDays: 30 },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSessionId(res.data.data.sessionId);
      setSelectedAppointment(appointment);
      toast.success("Scribe session started");
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to start scribe");
    } finally {
      setLoading(false);
    }
  };

  const startRecording = useCallback(() => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      toast.error("Speech recognition not supported in this browser");
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-IN";

    let finalBuffer: string[] = [];

    recognition.onresult = async (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalBuffer.push(transcript);
          // Send to backend every 5 final results
          if (finalBuffer.length >= 5 && sessionId) {
            const entries = finalBuffer.map((text) => ({
              speaker: "DOCTOR",
              text,
              timestamp: new Date().toISOString(),
              confidence: event.results[i][0].confidence || 0.9,
            }));
            finalBuffer = [];
            try {
              const res = await api.post<any>(
                `/ai/scribe/${sessionId}/transcript`,
                { entries },
                { headers: { Authorization: `Bearer ${token}` } }
              );
              setTranscriptLength(res.data.data.transcriptLength);
              if (res.data.data.soapDraft) {
                setSoapDraft(res.data.data.soapDraft);
                setEditedSOAP(res.data.data.soapDraft);
              }
              if (res.data.data.rxSafetyReport?.alerts) {
                setRxSafetyReport(res.data.data.rxSafetyReport);
                setAlertsAcknowledged(false);
              }
            } catch { /* silent */ }
          }
        } else {
          interim += transcript;
        }
      }
      setLiveText(interim);
    };

    recognition.onerror = () => setRecording(false);
    recognition.onend = () => setRecording(false);
    recognition.start();
    recognitionRef.current = recognition;
    setRecording(true);
  }, [sessionId, token]);

  const stopRecording = useCallback(() => {
    recognitionRef.current?.stop();
    setRecording(false);
    setLiveText("");
  }, []);

  const updateSOAPField = (path: string[], value: string) => {
    setEditedSOAP((prev) => {
      if (!prev) return prev;
      const updated = { ...prev };
      let obj: any = updated;
      for (let i = 0; i < path.length - 1; i++) {
        obj[path[i]] = { ...(obj[path[i]] || {}) };
        obj = obj[path[i]];
      }
      obj[path[path.length - 1]] = value;
      return updated;
    });
  };

  const handleSignOff = async () => {
    if (!sessionId || !editedSOAP) return;
    setLoading(true);
    try {
      await api.post<any>(
        `/ai/scribe/${sessionId}/finalize`,
        { soapFinal: editedSOAP, rxApproved: true, doctorEdits: [] },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSignedOff(true);
      toast.success("SOAP note signed and saved to EHR");
    } catch (err: any) {
      toast.error(err?.response?.data?.error || "Failed to sign off");
    } finally {
      setLoading(false);
    }
  };

  const handleWithdrawConsent = async () => {
    if (!sessionId) return;
    try {
      await api.delete<any>(`/ai/scribe/${sessionId}`, { headers: { Authorization: `Bearer ${token}` } });
      stopRecording();
      setSessionId(null);
      setSoapDraft(null);
      setEditedSOAP(null);
      toast.info("Consent withdrawn — transcript purged");
    } catch { /* silent */ }
  };

  // ── Signed off screen ────────────────────────────────
  if (signedOff) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-4rem)]">
        <div className="text-center space-y-3">
          <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
          <h2 className="text-xl font-bold text-gray-800">Note Signed & Saved</h2>
          <p className="text-gray-500 text-sm">The SOAP note has been committed to the EHR.</p>
          <button
            onClick={() => { setSessionId(null); setSoapDraft(null); setEditedSOAP(null); setSignedOff(false); setSelectedAppointment(null); }}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            Next patient
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] gap-4 p-4 overflow-hidden">
      {/* ── Left: appointment picker + controls ────────── */}
      <div className="w-72 flex flex-col gap-3">
        {/* Appointment selector */}
        <div className="bg-white rounded-2xl shadow border border-gray-100 p-4">
          <p className="font-semibold text-sm text-gray-700 mb-3 flex items-center gap-2">
            <UserCheck className="w-4 h-4 text-blue-600" /> Today&apos;s Patients
          </p>
          {appointments.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-4">No appointments today</p>
          ) : (
            <div className="space-y-1.5">
              {appointments.map((appt) => (
                <button
                  key={appt.id}
                  onClick={() => !sessionId && startScribe(appt)}
                  disabled={!!sessionId || loading}
                  className={`w-full text-left px-3 py-2 rounded-xl border text-sm transition-all ${
                    selectedAppointment?.id === appt.id
                      ? "border-blue-500 bg-blue-50"
                      : "border-gray-200 hover:border-blue-200 disabled:opacity-50"
                  }`}
                >
                  <p className="font-medium text-gray-800 truncate">{appt.patient?.user?.name}</p>
                  <p className="text-xs text-gray-500">Token #{appt.tokenNumber} · {appt.slotStart || "Walk-in"}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Scribe controls */}
        {sessionId && (
          <div className="bg-white rounded-2xl shadow border border-gray-100 p-4 space-y-3">
            <p className="font-semibold text-sm text-gray-700 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" /> Scribe Active
            </p>
            <div className="text-xs text-gray-500 space-y-1">
              <p>Patient: <span className="font-medium text-gray-700">{selectedAppointment?.patient?.user?.name}</span></p>
              <p>Transcript: <span className="font-medium text-gray-700">{transcriptLength} entries</span></p>
            </div>

            {liveText && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2 text-xs text-gray-600 italic">
                {liveText}
              </div>
            )}

            <button
              onClick={recording ? stopRecording : startRecording}
              className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium text-sm transition-all ${
                recording
                  ? "bg-red-500 hover:bg-red-600 text-white"
                  : "bg-emerald-500 hover:bg-emerald-600 text-white"
              }`}
            >
              {recording ? <><MicOff className="w-4 h-4" /> Stop Recording</> : <><Mic className="w-4 h-4" /> Start Recording</>}
            </button>

            <button
              onClick={handleWithdrawConsent}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-xl border border-red-200 text-red-600 text-sm hover:bg-red-50"
            >
              <X className="w-4 h-4" /> Withdraw Consent
            </button>
          </div>
        )}

        {/* Consent notice */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs text-amber-800 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            Patient consent is required before starting the scribe. Ensure verbal or written consent is obtained.
          </p>
        </div>
      </div>

      {/* ── Right: SOAP draft ──────────────────────────── */}
      <div className="flex-1 flex flex-col bg-white rounded-2xl shadow border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-blue-600" />
            <p className="font-semibold text-sm text-gray-800">AI-Drafted SOAP Note</p>
            {soapDraft && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">Auto-updating</span>}
          </div>
          {editedSOAP && !signedOff && (
            <button
              onClick={handleSignOff}
              disabled={loading || !!(rxSafetyReport?.hasContraindicated && !alertsAcknowledged)}
              title={rxSafetyReport?.hasContraindicated && !alertsAcknowledged ? "Acknowledge CONTRAINDICATED alerts before signing" : undefined}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              Sign & Save to EHR
            </button>
          )}
        </div>

        {!sessionId ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center space-y-2">
              <Clipboard className="w-12 h-12 mx-auto opacity-30" />
              <p className="text-sm">Select a patient and start the scribe to generate a SOAP note</p>
            </div>
          </div>
        ) : !editedSOAP ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            <div className="text-center space-y-2">
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-blue-400" />
              <p className="text-sm">Listening… SOAP draft will appear after a few exchanges</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {/* Subjective */}
            <SOAPSection title="Subjective" icon={<Activity className="w-4 h-4 text-blue-500" />}>
              <div className="space-y-3">
                <EditableField
                  label="Chief Complaint"
                  value={editedSOAP?.subjective?.chiefComplaint || ""}
                  onChange={(v) => updateSOAPField(["subjective", "chiefComplaint"], v)}
                />
                <EditableField
                  label="History of Present Illness"
                  value={editedSOAP?.subjective?.hpi || ""}
                  onChange={(v) => updateSOAPField(["subjective", "hpi"], v)}
                />
                <EditableField
                  label="Past Medical History"
                  value={editedSOAP?.subjective?.pastMedicalHistory || ""}
                  onChange={(v) => updateSOAPField(["subjective", "pastMedicalHistory"], v)}
                />
              </div>
            </SOAPSection>

            {/* Objective */}
            <SOAPSection title="Objective" icon={<FlaskConical className="w-4 h-4 text-purple-500" />}>
              <div className="space-y-3">
                <EditableField
                  label="Vitals"
                  value={editedSOAP?.objective?.vitals || ""}
                  onChange={(v) => updateSOAPField(["objective", "vitals"], v)}
                />
                <EditableField
                  label="Examination Findings"
                  value={editedSOAP?.objective?.examinationFindings || ""}
                  onChange={(v) => updateSOAPField(["objective", "examinationFindings"], v)}
                />
              </div>
            </SOAPSection>

            {/* Assessment */}
            <SOAPSection title="Assessment" icon={<Clipboard className="w-4 h-4 text-orange-500" />}>
              <div className="space-y-3">
                <EditableField
                  label="Clinical Impression / Diagnosis"
                  value={editedSOAP?.assessment?.impression || ""}
                  onChange={(v) => updateSOAPField(["assessment", "impression"], v)}
                />
                {editedSOAP?.assessment?.icd10Codes && editedSOAP.assessment.icd10Codes.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Suggested ICD-10 Codes</p>
                    <div className="space-y-1.5">
                      {editedSOAP.assessment.icd10Codes.map((code, i) => (
                        <div key={i} className="flex items-start gap-2 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2">
                          <span className="text-xs font-mono font-bold text-orange-700">{code.code}</span>
                          <div className="flex-1">
                            <p className="text-xs text-gray-700">{code.description}</p>
                            {code.evidenceSpan && <p className="text-xs text-gray-400 italic mt-0.5">"{code.evidenceSpan}"</p>}
                          </div>
                          <span className="text-xs text-orange-600">{Math.round(code.confidence * 100)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </SOAPSection>

            {/* Plan */}
            <SOAPSection title="Plan" icon={<Pill className="w-4 h-4 text-green-500" />}>
              <div className="space-y-3">
                {rxSafetyReport && (
                  <DrugAlertBanner
                    report={rxSafetyReport}
                    acknowledged={alertsAcknowledged}
                    onAcknowledge={() => setAlertsAcknowledged(true)}
                  />
                )}
                {editedSOAP?.plan?.medications && editedSOAP.plan.medications.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">Medications</p>
                    <div className="space-y-1.5">
                      {editedSOAP.plan.medications.map((med, i) => (
                        <div key={i} className="bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                          <p className="text-sm font-medium text-gray-800">{med.name}</p>
                          <p className="text-xs text-gray-600">{med.dose} · {med.frequency} · {med.duration}</p>
                          {med.notes && <p className="text-xs text-gray-400 mt-0.5">{med.notes}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <EditableField
                  label="Investigations Ordered"
                  value={editedSOAP?.plan?.investigations?.join(", ") || ""}
                  onChange={(v) => updateSOAPField(["plan", "investigations"], v)}
                />
                <EditableField
                  label="Follow-up"
                  value={editedSOAP?.plan?.followUpTimeline || ""}
                  onChange={(v) => updateSOAPField(["plan", "followUpTimeline"], v)}
                />
                <EditableField
                  label="Patient Instructions"
                  value={editedSOAP?.plan?.patientInstructions || ""}
                  onChange={(v) => updateSOAPField(["plan", "patientInstructions"], v)}
                />
              </div>
            </SOAPSection>

            <p className="text-xs text-center text-gray-400 pb-2">
              AI-generated draft — review all sections before signing. Nothing is saved until you click &quot;Sign &amp; Save to EHR&quot;.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
