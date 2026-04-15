import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fetchPrescriptions } from "../../lib/api";

export default function DoctorPrescriptionsScreen() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "DRAFT" | "SENT">("ALL");

  const load = useCallback(async () => {
    try {
      const data = await fetchPrescriptions();
      setItems(Array.isArray(data) ? data : []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = items.filter((rx) => {
    if (filter === "ALL") return true;
    const status = (rx.status || (rx.signedAt ? "SENT" : "DRAFT")).toUpperCase();
    return status === filter;
  });

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        {(["ALL", "DRAFT", "SENT"] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.tab, filter === f && styles.tabActive]}
            onPress={() => setFilter(f)}
          >
            <Text
              style={[styles.tabText, filter === f && styles.tabTextActive]}
            >
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item, i) => item.id || String(i)}
        contentContainerStyle={{ padding: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
          />
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <View style={styles.rxCircle}>
              <Text style={styles.rxText}>Rx</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {item.patient?.user?.name || item.patientName || "Patient"}
              </Text>
              <Text style={styles.sub}>
                {item.diagnosis || "No diagnosis"} ·{" "}
                {(item.medicines || item.items || []).length} meds
              </Text>
            </View>
            <View
              style={[
                styles.badge,
                {
                  backgroundColor:
                    item.status === "DRAFT" ? "#fef9c3" : "#dcfce7",
                },
              ]}
            >
              <Text
                style={[
                  styles.badgeText,
                  {
                    color: item.status === "DRAFT" ? "#854d0e" : "#166534",
                  },
                ]}
              >
                {item.status || (item.signedAt ? "SENT" : "DRAFT")}
              </Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="document-text-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>No prescriptions</Text>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  tabs: {
    flexDirection: "row",
    backgroundColor: "#fff",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#f3f4f6",
  },
  tabActive: { backgroundColor: "#2563eb" },
  tabText: { color: "#374151", fontWeight: "600", fontSize: 13 },
  tabTextActive: { color: "#fff" },
  card: {
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  rxCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#ecfdf5",
    justifyContent: "center",
    alignItems: "center",
  },
  rxText: { color: "#059669", fontWeight: "bold" },
  title: { fontSize: 15, fontWeight: "600", color: "#111827" },
  sub: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 11, fontWeight: "bold" },
  empty: { alignItems: "center", marginTop: 60 },
  emptyText: { color: "#9ca3af", fontSize: 14, marginTop: 8 },
});
