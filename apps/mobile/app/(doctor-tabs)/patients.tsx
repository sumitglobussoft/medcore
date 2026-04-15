import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { fetchAppointments } from "../../lib/api";

function dateOnly(d?: string) {
  if (!d) return "";
  try {
    return new Date(d).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

export default function DoctorPatientsScreen() {
  const [appts, setAppts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchAppointments();
      setAppts(Array.isArray(data) ? data : []);
    } catch {
      setAppts([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // De-dupe by patient id, retaining most recent appointment per patient.
  const uniquePatients: any[] = Array.from(
    appts
      .reduce((map: Map<string, any>, a: any) => {
        const pid = a.patientId || a.patient?.id;
        if (!pid) return map;
        if (!map.has(pid)) map.set(pid, a);
        return map;
      }, new Map<string, any>())
      .values()
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <FlatList
      data={uniquePatients}
      keyExtractor={(item, i) =>
        item.patientId || item.patient?.id || String(i)
      }
      style={styles.container}
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
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {(
                item.patient?.user?.name ||
                item.patientName ||
                "P"
              )[0].toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.name}>
              {item.patient?.user?.name || item.patientName || "Patient"}
            </Text>
            <Text style={styles.sub}>
              Last visit: {dateOnly(item.date || item.createdAt)}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#9ca3af" />
        </View>
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyText}>No patients yet</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  card: {
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#eff6ff",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: { color: "#2563eb", fontWeight: "bold", fontSize: 16 },
  name: { fontSize: 15, fontWeight: "600", color: "#111827" },
  sub: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  empty: { alignItems: "center", marginTop: 60 },
  emptyText: { color: "#9ca3af", fontSize: 14, marginTop: 8 },
});
