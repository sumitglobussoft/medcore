import { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { ApiError, API_BASE_URL } from "../../lib/api";

// Keep i18n inline (EN + Hindi) — this screen is reached from the patient
// dashboard and is expected to be available in both locales per PRD §i18n.
type Lang = "en" | "hi";
const T = {
  en: {
    title: "Download My Data",
    subtitle: "DPDP Act 2023 — Right to Data Portability",
    disclaimer:
      "We'll package everything this hospital holds about you. Exports may take up to a few minutes. Download links are valid for 1 hour.",
    pickFormat: "Choose a format",
    formatJson: "JSON — full record",
    formatJsonHint: "Best for importing into another system",
    formatFhir: "FHIR R4 bundle",
    formatFhirHint: "Interoperable with ABDM / other EHRs",
    formatPdf: "PDF summary",
    formatPdfHint: "Human-readable — not a clinical document",
    requestBtn: "Request export",
    requesting: "Requesting...",
    pastExports: "Past exports",
    noPastExports: "No exports yet.",
    download: "Download",
    statusQueued: "Queued",
    statusProcessing: "Processing",
    statusReady: "Ready",
    statusFailed: "Failed",
    rateLimited:
      "You have reached the daily limit of 3 exports. Try again tomorrow.",
    genericError: "Something went wrong. Please try again.",
  },
  hi: {
    title: "मेरा डेटा डाउनलोड करें",
    subtitle: "DPDP अधिनियम 2023 — डेटा पोर्टेबिलिटी का अधिकार",
    disclaimer:
      "हम आपके बारे में इस अस्पताल का सारा डेटा पैक करेंगे। निर्यात कुछ मिनट ले सकता है। डाउनलोड लिंक 1 घंटे के लिए मान्य है।",
    pickFormat: "फॉर्मेट चुनें",
    formatJson: "JSON — पूर्ण रिकॉर्ड",
    formatJsonHint: "दूसरे सिस्टम में आयात के लिए सर्वश्रेष्ठ",
    formatFhir: "FHIR R4 बंडल",
    formatFhirHint: "ABDM / अन्य EHR के साथ संगत",
    formatPdf: "PDF सारांश",
    formatPdfHint: "पठनीय — क्लिनिकल दस्तावेज़ नहीं",
    requestBtn: "निर्यात का अनुरोध करें",
    requesting: "अनुरोध हो रहा है...",
    pastExports: "पिछले निर्यात",
    noPastExports: "अभी तक कोई निर्यात नहीं।",
    download: "डाउनलोड",
    statusQueued: "कतार में",
    statusProcessing: "प्रसंस्करण",
    statusReady: "तैयार",
    statusFailed: "विफल",
    rateLimited:
      "आप दैनिक सीमा 3 निर्यात तक पहुँच गए हैं। कल फिर प्रयास करें।",
    genericError: "कुछ गलत हुआ। कृपया पुनः प्रयास करें।",
  },
} as const;

const ACCESS_TOKEN_KEY = "medcore_access_token";
const FALLBACK_URL = "https://medcore.globusdemos.com/api/v1";
const BASE_URL: string =
  API_BASE_URL ||
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  FALLBACK_URL;

type ExportFormat = "json" | "fhir" | "pdf";
type ExportStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED";

interface ExportRow {
  requestId: string;
  format: ExportFormat;
  status: ExportStatus;
  requestedAt: string;
  readyAt: string | null;
  errorMessage: string | null;
  fileSize: number | null;
  downloadUrl: string | null;
  downloadTtlSeconds: number | null;
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

async function listMyExports(existing: ExportRow[]): Promise<ExportRow[]> {
  // There's no list endpoint — the screen keeps its own local history of
  // requestIds in memory and polls each. New requests prepend as QUEUED.
  const refreshed: ExportRow[] = [];
  for (const row of existing) {
    try {
      const res = await request<{ success: boolean; data: ExportRow }>(
        `/patient-data-export/${row.requestId}`
      );
      refreshed.push(res.data);
    } catch {
      refreshed.push(row);
    }
  }
  return refreshed;
}

async function createExport(format: ExportFormat): Promise<ExportRow> {
  const res = await request<{
    success: boolean;
    data: { requestId: string; status: ExportStatus; format: ExportFormat };
  }>("/patient-data-export", {
    method: "POST",
    body: JSON.stringify({ format }),
  });
  return {
    requestId: res.data.requestId,
    format: res.data.format,
    status: res.data.status,
    requestedAt: new Date().toISOString(),
    readyAt: null,
    errorMessage: null,
    fileSize: null,
    downloadUrl: null,
    downloadTtlSeconds: null,
  };
}

export default function DataExportScreen() {
  const router = useRouter();
  // Locale state — real apps plumb this through a store; this screen is
  // standalone per task scope, so read a SecureStore key as a best-effort.
  const [lang, setLang] = useState<Lang>("en");
  const t = T[lang];

  const [format, setFormat] = useState<ExportFormat>("json");
  const [rows, setRows] = useState<ExportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Resolve the preferred language once on mount. Same pattern as other AI
  // screens — we don't block the render if this fails.
  useEffect(() => {
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync("medcore_lang");
        if (saved === "hi" || saved === "en") setLang(saved);
      } catch {
        // non-fatal
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const latest = await listMyExports(rows);
      setRows(latest);
    } finally {
      setRefreshing(false);
    }
  }, [rows]);

  // Poll every 5 s while anything is still QUEUED/PROCESSING — stop as soon
  // as everything has settled into READY/FAILED so we aren't hammering the
  // API for nothing.
  useEffect(() => {
    const hasWork = rows.some(
      (r) => r.status === "QUEUED" || r.status === "PROCESSING"
    );
    if (!hasWork) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      try {
        const latest = await listMyExports(rows);
        setRows(latest);
      } catch {
        // non-fatal
      }
    }, 5000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [rows]);

  const handleRequest = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const created = await createExport(format);
      setRows((prev) => [created, ...prev]);
    } catch (err: any) {
      if (err?.status === 429) {
        setError(t.rateLimited);
        Alert.alert(t.title, t.rateLimited);
      } else {
        const msg = err?.message || t.genericError;
        setError(msg);
        Alert.alert(t.title, msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async (row: ExportRow) => {
    if (!row.downloadUrl) return;
    try {
      // downloadUrl is a relative API path + signed query string. Resolve to
      // an absolute URL so the system browser can open it without needing
      // the Authorization header (signature is the auth grant).
      const apiBase = BASE_URL.replace(/\/api\/v1\/?$/, "");
      const absolute = row.downloadUrl.startsWith("http")
        ? row.downloadUrl
        : `${apiBase}${row.downloadUrl}`;
      const can = await Linking.canOpenURL(absolute);
      if (can) await Linking.openURL(absolute);
    } catch (err: any) {
      Alert.alert(t.title, err?.message || t.genericError);
    }
  };

  const statusLabel = (s: ExportStatus): string =>
    s === "QUEUED"
      ? t.statusQueued
      : s === "PROCESSING"
        ? t.statusProcessing
        : s === "READY"
          ? t.statusReady
          : t.statusFailed;

  const statusColor = (s: ExportStatus): string =>
    s === "READY" ? "#059669" : s === "FAILED" ? "#dc2626" : "#2563eb";

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={refresh} />
      }
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t.title}</Text>
      </View>

      <View style={styles.body}>
        <View style={styles.card}>
          <Text style={styles.subtitle}>{t.subtitle}</Text>
          <Text style={styles.disclaimer}>{t.disclaimer}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t.pickFormat}</Text>
          {(
            [
              { key: "json", label: t.formatJson, hint: t.formatJsonHint },
              { key: "fhir", label: t.formatFhir, hint: t.formatFhirHint },
              { key: "pdf", label: t.formatPdf, hint: t.formatPdfHint },
            ] as Array<{ key: ExportFormat; label: string; hint: string }>
          ).map((opt) => {
            const selected = format === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[styles.fmtRow, selected && styles.fmtRowSelected]}
                onPress={() => setFormat(opt.key)}
              >
                <Ionicons
                  name={
                    selected ? "radio-button-on" : "radio-button-off"
                  }
                  size={20}
                  color={selected ? "#2563eb" : "#9ca3af"}
                />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={styles.fmtLabel}>{opt.label}</Text>
                  <Text style={styles.fmtHint}>{opt.hint}</Text>
                </View>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={[styles.btn, submitting && styles.btnDisabled]}
            onPress={handleRequest}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.btnText}>{t.requestBtn}</Text>
            )}
          </TouchableOpacity>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t.pastExports}</Text>
          {loading ? (
            <ActivityIndicator size="small" color="#2563eb" />
          ) : rows.length === 0 ? (
            <Text style={styles.empty}>{t.noPastExports}</Text>
          ) : (
            rows.map((row) => (
              <View key={row.requestId} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowFmt}>{row.format.toUpperCase()}</Text>
                  <Text style={styles.rowDate}>
                    {new Date(row.requestedAt).toLocaleString()}
                  </Text>
                  <Text style={[styles.rowStatus, { color: statusColor(row.status) }]}>
                    {statusLabel(row.status)}
                  </Text>
                  {row.errorMessage ? (
                    <Text style={styles.rowError}>{row.errorMessage}</Text>
                  ) : null}
                </View>
                {row.status === "READY" && row.downloadUrl ? (
                  <TouchableOpacity
                    style={styles.dlBtn}
                    onPress={() => handleDownload(row)}
                  >
                    <Ionicons name="download" size={16} color="#fff" />
                    <Text style={styles.dlBtnText}>{t.download}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ))
          )}
        </View>
      </View>
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
  body: { padding: 16, gap: 12 },
  card: { backgroundColor: "#fff", borderRadius: 16, padding: 14, gap: 10 },
  cardTitle: { fontSize: 14, fontWeight: "700", color: "#111827" },
  subtitle: { fontSize: 13, color: "#2563eb", fontWeight: "600" },
  disclaimer: { fontSize: 12, color: "#6b7280", lineHeight: 18 },
  fmtRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fafafa",
  },
  fmtRowSelected: { borderColor: "#2563eb", backgroundColor: "#eff6ff" },
  fmtLabel: { fontSize: 13, fontWeight: "600", color: "#111827" },
  fmtHint: { fontSize: 11, color: "#6b7280" },
  btn: {
    backgroundColor: "#2563eb",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 4,
  },
  btnDisabled: { backgroundColor: "#9ca3af" },
  btnText: { color: "#fff", fontSize: 14, fontWeight: "700" },
  errorText: { color: "#991b1b", fontSize: 12 },
  empty: { color: "#9ca3af", fontSize: 12, fontStyle: "italic" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#f3f4f6",
  },
  rowFmt: { fontSize: 13, fontWeight: "700", color: "#111827" },
  rowDate: { fontSize: 11, color: "#6b7280" },
  rowStatus: { fontSize: 12, fontWeight: "600", marginTop: 2 },
  rowError: { fontSize: 11, color: "#991b1b", marginTop: 2 },
  dlBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#059669",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
  },
  dlBtnText: { color: "#fff", fontSize: 12, fontWeight: "600" },
});
