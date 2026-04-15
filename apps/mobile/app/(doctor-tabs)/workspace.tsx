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
import { useAuth } from "../../lib/auth";
import {
  fetchAppointments,
  fetchQueue,
  updateAppointmentStatus,
} from "../../lib/api";
import { useQueueSocket } from "../../lib/socket";

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function DoctorWorkspaceScreen() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<any | null>(null);
  const [appointments, setAppointments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const doctorId = user?.doctor?.id || user?.doctorId;

  const load = useCallback(async () => {
    try {
      const [q, appts] = await Promise.all([
        doctorId ? fetchQueue(doctorId) : Promise.resolve(null),
        fetchAppointments({ date: todayISO() }),
      ]);
      setQueue(q);
      setAppointments(Array.isArray(appts) ? appts : []);
    } catch {
      setQueue(null);
      setAppointments([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [doctorId]);

  useEffect(() => {
    load();
  }, [load]);

  useQueueSocket(!!doctorId, (event) => {
    // Reload on any queue event for this doctor.
    if (!event || (event.doctorId && event.doctorId !== doctorId)) return;
    load();
  });

  const advanceToken = async (apptId: string) => {
    try {
      await updateAppointmentStatus(apptId, "IN_PROGRESS");
      load();
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <FlatList
      data={appointments}
      keyExtractor={(item, i) => item.id || String(i)}
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
      ListHeaderComponent={
        <View style={styles.queueCard}>
          <Text style={styles.queueLabel}>Today's Queue</Text>
          <View style={styles.queueRow}>
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Current</Text>
              <Text style={styles.statValue}>
                #{queue?.currentToken ?? "-"}
              </Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.stat}>
              <Text style={styles.statLabel}>Waiting</Text>
              <Text style={styles.statValue}>
                {queue?.waitingCount ?? appointments.length}
              </Text>
            </View>
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <View style={styles.apptCard}>
          <View style={styles.tokenCircle}>
            <Text style={styles.tokenText}>#{item.tokenNumber ?? "-"}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.patientName}>
              {item.patient?.user?.name || item.patientName || "Patient"}
            </Text>
            <Text style={styles.subText}>
              {item.slot?.startTime} {item.status ? `· ${item.status}` : ""}
            </Text>
          </View>
          {item.status !== "COMPLETED" && item.status !== "CANCELLED" && (
            <TouchableOpacity
              style={styles.callBtn}
              onPress={() => advanceToken(item.id)}
            >
              <Ionicons name="play" size={16} color="#fff" />
            </TouchableOpacity>
          )}
        </View>
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Ionicons name="calendar-outline" size={48} color="#d1d5db" />
          <Text style={styles.emptyText}>No appointments today</Text>
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  queueCard: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 14,
  },
  queueLabel: { fontSize: 12, color: "#6b7280", textTransform: "uppercase" },
  queueRow: { flexDirection: "row", marginTop: 10 },
  stat: { flex: 1, alignItems: "center" },
  statLabel: { fontSize: 12, color: "#6b7280" },
  statValue: { fontSize: 22, fontWeight: "bold", color: "#111827", marginTop: 2 },
  divider: { width: 1, backgroundColor: "#e5e7eb" },
  apptCard: {
    backgroundColor: "#fff",
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 12,
    marginBottom: 8,
    gap: 12,
  },
  tokenCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#eff6ff",
    justifyContent: "center",
    alignItems: "center",
  },
  tokenText: { color: "#2563eb", fontWeight: "bold" },
  patientName: { fontSize: 15, fontWeight: "600", color: "#111827" },
  subText: { fontSize: 13, color: "#6b7280", marginTop: 2 },
  callBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#2563eb",
    justifyContent: "center",
    alignItems: "center",
  },
  empty: { alignItems: "center", marginTop: 60 },
  emptyText: { color: "#9ca3af", fontSize: 14, marginTop: 8 },
});
