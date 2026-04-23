import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";
import { ApiError, API_BASE_URL } from "../../lib/api";

// Inline minimal client so we don't have to modify shared lib/ai.ts in this pass.
const ACCESS_TOKEN_KEY = "medcore_access_token";
const FALLBACK_URL = "https://medcore.globusdemos.com/api/v1";
const BASE_URL: string =
  API_BASE_URL ||
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  FALLBACK_URL;

interface FlaggedItem {
  description: string;
  amount: number;
  reason: string;
}

interface BillExplanation {
  id: string;
  invoiceId: string;
  language: string;
  content: string;
  status: "DRAFT" | "APPROVED" | "SENT";
  flaggedItems: FlaggedItem[];
  sentAt: string | null;
  createdAt: string;
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

async function fetchByInvoice(invoiceId: string): Promise<BillExplanation> {
  const res = await request<{ success: boolean; data: BillExplanation }>(
    `/ai/bill-explainer/${invoiceId}`
  );
  return res.data;
}

async function generateForInvoice(invoiceId: string): Promise<BillExplanation> {
  const res = await request<{ success: boolean; data: BillExplanation }>(
    `/ai/bill-explainer/${invoiceId}/generate`,
    { method: "POST", body: JSON.stringify({}) }
  );
  return res.data;
}

export default function BillExplanationScreen() {
  const { invoiceId, explanationId } = useLocalSearchParams<{
    invoiceId?: string;
    explanationId?: string;
  }>();
  const router = useRouter();

  const [explanation, setExplanation] = useState<BillExplanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(
    async (isRefresh = false) => {
      if (!invoiceId && !explanationId) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        // Prefer direct fetch by explanationId; else by invoice
        if (explanationId) {
          const res = await request<{ success: boolean; data: BillExplanation }>(
            `/ai/bill-explainer/${explanationId}`
          );
          setExplanation(res.data);
        } else if (invoiceId) {
          const data = await fetchByInvoice(invoiceId);
          setExplanation(data);
        }
      } catch (err: any) {
        if (err instanceof ApiError && err.status === 404) {
          setExplanation(null);
          setError(null); // handled via "request explanation" CTA
        } else {
          setError(err?.message || "Could not load explanation");
          setExplanation(null);
        }
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [invoiceId, explanationId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const handleRequest = async () => {
    if (!invoiceId) return;
    setRequesting(true);
    try {
      const created = await generateForInvoice(invoiceId);
      setExplanation(created);
    } catch (err: any) {
      setError(err?.message || "Could not request explanation");
    } finally {
      setRequesting(false);
    }
  };

  const flagged = Array.isArray(explanation?.flaggedItems)
    ? explanation!.flaggedItems
    : [];

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Bill Explanation</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Loading explanation...</Text>
        </View>
      ) : error ? (
        <View style={styles.messageBox}>
          <Ionicons name="alert-circle" size={24} color="#dc2626" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : !explanation ? (
        <View style={styles.emptyBox}>
          <Ionicons name="receipt-outline" size={36} color="#6b7280" />
          <Text style={styles.emptyTitle}>No explanation yet</Text>
          <Text style={styles.emptyBody}>
            We can generate a plain-language breakdown of this bill. Your billing desk will review and send it to you.
          </Text>
          {invoiceId ? (
            <TouchableOpacity
              onPress={handleRequest}
              style={styles.requestBtn}
              disabled={requesting}
            >
              {requesting ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.requestBtnText}>Request an explanation</Text>
              )}
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusChip,
                explanation.status === "SENT"
                  ? styles.statusSent
                  : explanation.status === "APPROVED"
                  ? styles.statusApproved
                  : styles.statusDraft,
              ]}
            >
              <Text style={styles.statusText}>
                {explanation.status === "SENT"
                  ? "Delivered"
                  : explanation.status === "APPROVED"
                  ? "Approved"
                  : "Awaiting review"}
              </Text>
            </View>
            <Text style={styles.dateText}>
              {new Date(explanation.createdAt).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}
            </Text>
          </View>

          {flagged.length > 0 && (
            <View style={styles.flagBox}>
              <Text style={styles.flagTitle}>Items to double-check</Text>
              {flagged.map((fv, i) => (
                <View key={i} style={styles.flagRow}>
                  <Text style={styles.flagDesc}>{fv.description}</Text>
                  <Text style={styles.flagMeta}>
                    ₹{fv.amount} — {fv.reason}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Text style={styles.content}>{explanation.content}</Text>

          {explanation.status === "DRAFT" && (
            <Text style={styles.pendingNote}>
              Our billing desk is reviewing this explanation. You'll get a notification when it's ready.
            </Text>
          )}
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
  messageBox: {
    margin: 16,
    padding: 14,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    backgroundColor: "#fef2f2",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#fecaca",
  },
  errorText: { flex: 1, color: "#991b1b", fontSize: 13 },
  emptyBox: {
    margin: 16,
    padding: 24,
    backgroundColor: "#fff",
    borderRadius: 16,
    alignItems: "center",
    gap: 10,
  },
  emptyTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  emptyBody: { fontSize: 13, color: "#6b7280", textAlign: "center", lineHeight: 20 },
  requestBtn: {
    marginTop: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: "#2563eb",
    borderRadius: 12,
  },
  requestBtnText: { color: "#fff", fontSize: 13, fontWeight: "600" },
  card: {
    margin: 16,
    padding: 16,
    backgroundColor: "#fff",
    borderRadius: 16,
    gap: 12,
  },
  statusRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statusChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statusDraft: { backgroundColor: "#fef3c7" },
  statusApproved: { backgroundColor: "#dbeafe" },
  statusSent: { backgroundColor: "#dcfce7" },
  statusText: { fontSize: 11, fontWeight: "700", color: "#111827" },
  dateText: { fontSize: 11, color: "#6b7280" },
  flagBox: {
    backgroundColor: "#fffbeb",
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#fde68a",
    gap: 6,
  },
  flagTitle: { fontSize: 12, fontWeight: "700", color: "#92400e" },
  flagRow: { gap: 2 },
  flagDesc: { fontSize: 13, color: "#111827", fontWeight: "600" },
  flagMeta: { fontSize: 11, color: "#6b7280" },
  content: { fontSize: 14, lineHeight: 21, color: "#111827" },
  pendingNote: {
    fontSize: 12,
    color: "#6b7280",
    fontStyle: "italic",
    marginTop: 4,
  },
});
