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

const ACCESS_TOKEN_KEY = "medcore_access_token";
const FALLBACK_URL = "https://medcore.globusdemos.com/api/v1";
const BASE_URL: string =
  API_BASE_URL ||
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  FALLBACK_URL;

interface ChecklistItem {
  label: string;
  category: "ID" | "REPORT" | "MEDICATION" | "INSURANCE" | "PAYMENT" | "OTHER";
  required: boolean;
  reason: string;
}

interface PrevisitChecklist {
  id: string;
  appointmentId: string;
  items: ChecklistItem[];
  generatedAt: string;
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

async function fetchChecklist(
  appointmentId: string,
  regenerate = false
): Promise<PrevisitChecklist> {
  const res = await request<{ success: boolean; data: PrevisitChecklist }>(
    `/ai/previsit/${appointmentId}${regenerate ? "?regenerate=1" : ""}`
  );
  return res.data;
}

const CATEGORY_ICONS: Record<ChecklistItem["category"], keyof typeof Ionicons.glyphMap> = {
  ID: "card-outline",
  REPORT: "document-text-outline",
  MEDICATION: "medkit-outline",
  INSURANCE: "shield-checkmark-outline",
  PAYMENT: "wallet-outline",
  OTHER: "information-circle-outline",
};

export default function PrevisitScreen() {
  const { appointmentId } = useLocalSearchParams<{ appointmentId?: string }>();
  const router = useRouter();

  const [checklist, setChecklist] = useState<PrevisitChecklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const load = useCallback(
    async (isRefresh = false, regen = false) => {
      if (!appointmentId) {
        setLoading(false);
        setError("No appointment specified.");
        return;
      }
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const data = await fetchChecklist(appointmentId, regen);
        setChecklist(data);
      } catch (err: any) {
        setError(err?.message || "Could not load checklist");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [appointmentId]
  );

  useEffect(() => {
    void load();
  }, [load]);

  const toggleCheck = (label: string) => {
    setChecked((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  const items = checklist?.items ?? [];
  const requiredCount = items.filter((i) => i.required).length;
  const doneCount = items.filter((i) => checked[i.label]).length;

  return (
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Visit Preparation</Text>
        <TouchableOpacity onPress={() => load(false, true)} style={styles.backBtn}>
          <Ionicons name="refresh" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#2563eb" />
          <Text style={styles.loadingText}>Preparing your checklist...</Text>
        </View>
      ) : error ? (
        <View style={styles.messageBox}>
          <Ionicons name="alert-circle" size={24} color="#dc2626" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.progressCard}>
            <Text style={styles.progressTitle}>
              {doneCount} of {items.length} ready
            </Text>
            <Text style={styles.progressSub}>
              {requiredCount} item{requiredCount === 1 ? "" : "s"} marked required.
              Tap each item once you've packed it.
            </Text>
          </View>

          {items.map((item) => {
            const isChecked = !!checked[item.label];
            return (
              <TouchableOpacity
                key={item.label}
                style={[styles.itemCard, isChecked && styles.itemCardChecked]}
                onPress={() => toggleCheck(item.label)}
                activeOpacity={0.8}
              >
                <View
                  style={[
                    styles.iconWrap,
                    item.required ? styles.iconWrapRequired : styles.iconWrapOptional,
                  ]}
                >
                  <Ionicons
                    name={CATEGORY_ICONS[item.category]}
                    size={18}
                    color={item.required ? "#b45309" : "#2563eb"}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.labelRow}>
                    <Text style={styles.itemLabel}>{item.label}</Text>
                    {item.required && (
                      <View style={styles.requiredChip}>
                        <Text style={styles.requiredChipText}>Required</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.itemReason}>{item.reason}</Text>
                </View>
                <Ionicons
                  name={isChecked ? "checkmark-circle" : "ellipse-outline"}
                  size={22}
                  color={isChecked ? "#16a34a" : "#d1d5db"}
                />
              </TouchableOpacity>
            );
          })}
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
  headerTitle: { color: "#fff", fontSize: 17, fontWeight: "bold", flex: 1 },
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
  body: { padding: 16, gap: 10 },
  progressCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 14,
    gap: 4,
  },
  progressTitle: { fontSize: 15, fontWeight: "700", color: "#111827" },
  progressSub: { fontSize: 12, color: "#6b7280" },
  itemCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  itemCardChecked: { backgroundColor: "#f0fdf4", borderColor: "#bbf7d0" },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrapRequired: { backgroundColor: "#fef3c7" },
  iconWrapOptional: { backgroundColor: "#e0e7ff" },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  itemLabel: { fontSize: 14, fontWeight: "600", color: "#111827", flexShrink: 1 },
  requiredChip: { backgroundColor: "#fde68a", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999 },
  requiredChipText: { fontSize: 10, fontWeight: "700", color: "#92400e" },
  itemReason: { fontSize: 12, color: "#6b7280", marginTop: 3 },
});
