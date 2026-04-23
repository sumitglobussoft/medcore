import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { ApiError, API_BASE_URL } from "../../lib/api";

const ACCESS_TOKEN_KEY = "medcore_access_token";
const FALLBACK_URL = "https://medcore.globusdemos.com/api/v1";
const BASE_URL: string =
  API_BASE_URL ||
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  FALLBACK_URL;

interface DiaryEntryItem {
  symptom: string;
  severity: number;
  notes?: string;
}

interface DiaryRow {
  id: string;
  patientId: string;
  symptomDate: string;
  entries: DiaryEntryItem[];
  lastAnalysis: null | {
    trends: Array<{
      symptom: string;
      direction: "improving" | "worsening" | "stable" | "fluctuating";
      averageSeverity: number;
      peakSeverity: number;
    }>;
    followUpRecommended: boolean;
    reasoning: string;
  };
  lastAnalysisAt: string | null;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(
      res.status,
      (body as any)?.error || (body as any)?.message || res.statusText,
      body
    );
  }
  return res.json();
}

async function fetchDiary(): Promise<DiaryRow[]> {
  const res = await request<{ success: boolean; data: DiaryRow[] }>(
    "/ai/symptom-diary"
  );
  return res.data ?? [];
}

async function submitEntry(payload: {
  symptomDate: string;
  entries: DiaryEntryItem[];
}): Promise<DiaryRow> {
  const res = await request<{ success: boolean; data: DiaryRow }>(
    "/ai/symptom-diary",
    { method: "POST", body: JSON.stringify(payload) }
  );
  return res.data;
}

async function runAnalysis(): Promise<
  NonNullable<DiaryRow["lastAnalysis"]>
> {
  const res = await request<{
    success: boolean;
    data: NonNullable<DiaryRow["lastAnalysis"]>;
  }>("/ai/symptom-diary/analyze", { method: "POST", body: JSON.stringify({}) });
  return res.data;
}

export default function SymptomDiaryScreen() {
  const router = useRouter();

  const [rows, setRows] = useState<DiaryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [symptom, setSymptom] = useState("");
  const [severity, setSeverity] = useState(5);
  const [notes, setNotes] = useState("");

  const [analysis, setAnalysis] = useState<DiaryRow["lastAnalysis"]>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await fetchDiary();
      setRows(data);
      // Pre-populate any existing analysis
      const latest = data.find((r) => r.lastAnalysis);
      setAnalysis(latest?.lastAnalysis ?? null);
    } catch (err: any) {
      setError(err?.message || "Could not load diary");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = async () => {
    const trimmed = symptom.trim();
    if (!trimmed) {
      Alert.alert("Missing symptom", "Please describe the symptom.");
      return;
    }
    setSubmitting(true);
    try {
      await submitEntry({
        symptomDate: new Date().toISOString(),
        entries: [
          {
            symptom: trimmed,
            severity: Math.max(1, Math.min(10, Math.round(severity))),
            notes: notes.trim() || undefined,
          },
        ],
      });
      setSymptom("");
      setNotes("");
      setSeverity(5);
      await load();
    } catch (err: any) {
      Alert.alert("Save failed", err?.message || "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const data = await runAnalysis();
      setAnalysis(data);
    } catch (err: any) {
      Alert.alert("Analysis failed", err?.message || "Please try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  const sparkline = useMemo(() => {
    // Compact 14-day severity average for a tiny header bar chart.
    const byDate = new Map<string, number[]>();
    for (const r of rows) {
      const d = r.symptomDate.slice(0, 10);
      const arr = byDate.get(d) ?? [];
      for (const e of r.entries) arr.push(e.severity);
      byDate.set(d, arr);
    }
    const days: { date: string; avg: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const vals = byDate.get(key) ?? [];
      const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
      days.push({ date: key, avg });
    }
    return days;
  }, [rows]);

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Symptom Diary</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Loading your diary...</Text>
        </View>
      ) : (
        <View style={styles.body}>
          {/* Sparkline */}
          <View style={styles.sparkCard}>
            <Text style={styles.sparkTitle}>Last 14 days</Text>
            <View style={styles.sparkRow}>
              {sparkline.map((d) => (
                <View key={d.date} style={styles.sparkColWrap}>
                  <View
                    style={[
                      styles.sparkBar,
                      { height: Math.max(2, d.avg * 6) },
                      d.avg >= 7 ? styles.sparkBarHigh : d.avg >= 4 ? styles.sparkBarMid : styles.sparkBarLow,
                    ]}
                  />
                </View>
              ))}
            </View>
            <Text style={styles.sparkFoot}>Avg severity per day (0-10)</Text>
          </View>

          {/* Log form */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Log today's symptom</Text>
            <TextInput
              style={styles.input}
              placeholder="Symptom (e.g. headache)"
              placeholderTextColor="#9ca3af"
              value={symptom}
              onChangeText={setSymptom}
            />
            <Text style={styles.severityLabel}>Severity: {severity}/10</Text>
            <View style={styles.severityRow}>
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                <TouchableOpacity
                  key={n}
                  onPress={() => setSeverity(n)}
                  style={[
                    styles.severityDot,
                    severity >= n && styles.severityDotActive,
                  ]}
                />
              ))}
            </View>
            <TextInput
              style={[styles.input, { height: 60 }]}
              placeholder="Notes (optional)"
              placeholderTextColor="#9ca3af"
              value={notes}
              onChangeText={setNotes}
              multiline
            />
            <TouchableOpacity
              style={styles.submitBtn}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.submitBtnText}>Save entry</Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Analyse */}
          <View style={styles.formCard}>
            <View style={styles.analyseRow}>
              <Text style={styles.formTitle}>AI trend insights</Text>
              <TouchableOpacity
                onPress={handleAnalyze}
                disabled={analyzing || rows.length === 0}
                style={[styles.analyseBtn, rows.length === 0 && styles.analyseBtnDisabled]}
              >
                {analyzing ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.analyseBtnText}>Analyse</Text>
                )}
              </TouchableOpacity>
            </View>
            {analysis ? (
              <View>
                {analysis.followUpRecommended && (
                  <View style={styles.followUpBox}>
                    <Ionicons name="alert-circle" size={18} color="#92400e" />
                    <Text style={styles.followUpText}>
                      We recommend booking a follow-up appointment.
                    </Text>
                  </View>
                )}
                <Text style={styles.reasoning}>{analysis.reasoning}</Text>
                {analysis.trends.map((t, i) => (
                  <View key={i} style={styles.trendRow}>
                    <Text style={styles.trendSymptom}>{t.symptom}</Text>
                    <Text style={styles.trendDir}>{t.direction}</Text>
                    <Text style={styles.trendAvg}>avg {t.averageSeverity}/10</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyAnalyse}>
                Log at least one entry, then press Analyse to see trends.
              </Text>
            )}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          {/* Recent entries */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Recent entries</Text>
            {rows.length === 0 ? (
              <Text style={styles.emptyAnalyse}>No entries yet.</Text>
            ) : (
              rows.slice(0, 10).map((r) => (
                <View key={r.id} style={styles.entryRow}>
                  <Text style={styles.entryDate}>
                    {new Date(r.symptomDate).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                    })}
                  </Text>
                  <View style={{ flex: 1 }}>
                    {r.entries.map((e, i) => (
                      <Text key={i} style={styles.entryText}>
                        {e.symptom} — {e.severity}/10
                        {e.notes ? ` · ${e.notes}` : ""}
                      </Text>
                    ))}
                  </View>
                </View>
              ))
            )}
          </View>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  header: {
    backgroundColor: "#2563eb",
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  backBtn: { padding: 4 },
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "bold" },
  center: { padding: 48, alignItems: "center", gap: 12 },
  loadingText: { color: "#6b7280", fontSize: 14 },
  body: { padding: 16, gap: 12 },
  sparkCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    gap: 8,
  },
  sparkTitle: { fontSize: 13, fontWeight: "600", color: "#111827" },
  sparkRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    height: 60,
    gap: 4,
  },
  sparkColWrap: { flex: 1, alignItems: "center", justifyContent: "flex-end", height: "100%" },
  sparkBar: { width: 8, borderRadius: 4 },
  sparkBarLow: { backgroundColor: "#bbf7d0" },
  sparkBarMid: { backgroundColor: "#fcd34d" },
  sparkBarHigh: { backgroundColor: "#fca5a5" },
  sparkFoot: { fontSize: 10, color: "#9ca3af" },
  formCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    gap: 10,
  },
  formTitle: { fontSize: 14, fontWeight: "700", color: "#111827" },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: "#111827",
    backgroundColor: "#f9fafb",
  },
  severityLabel: { fontSize: 12, color: "#6b7280" },
  severityRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 3,
  },
  severityDot: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#e5e7eb",
  },
  severityDotActive: { backgroundColor: "#2563eb" },
  submitBtn: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
  },
  submitBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  analyseRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  analyseBtn: {
    backgroundColor: "#111827",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 10,
  },
  analyseBtnDisabled: { backgroundColor: "#9ca3af" },
  analyseBtnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  followUpBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#fef3c7",
    padding: 10,
    borderRadius: 10,
    marginBottom: 8,
  },
  followUpText: { color: "#92400e", fontSize: 12, flex: 1 },
  reasoning: { fontSize: 13, color: "#111827", marginBottom: 8, lineHeight: 18 },
  trendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f3f4f6",
  },
  trendSymptom: { fontSize: 13, fontWeight: "600", color: "#111827", flex: 1 },
  trendDir: { fontSize: 11, color: "#2563eb", fontWeight: "600", textTransform: "capitalize" },
  trendAvg: { fontSize: 11, color: "#6b7280" },
  emptyAnalyse: { color: "#9ca3af", fontSize: 12, fontStyle: "italic" },
  errorText: { color: "#991b1b", fontSize: 13 },
  entryRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f3f4f6",
  },
  entryDate: { fontSize: 11, color: "#6b7280", width: 60, paddingTop: 2 },
  entryText: { fontSize: 13, color: "#111827", lineHeight: 18 },
});
