import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../lib/auth";
import {
  fetchInvoices,
  createPaymentOrder,
  verifyPayment,
} from "../../lib/api";

type Invoice = {
  id: string;
  invoiceNumber?: string;
  paymentStatus: "PAID" | "PENDING" | "PARTIAL" | string;
  totalAmount?: number;
  amountPaid?: number;
  amountDue?: number;
  dueDate?: string;
  createdAt?: string;
  items?: any[];
};

function statusColor(s: string) {
  switch (s) {
    case "PAID":
      return { bg: "#dcfce7", text: "#166534" };
    case "PARTIAL":
      return { bg: "#fef9c3", text: "#854d0e" };
    case "PENDING":
    default:
      return { bg: "#fee2e2", text: "#991b1b" };
  }
}

function formatINR(amt?: number) {
  if (amt == null) return "—";
  return `₹${amt.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export default function BillingScreen() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchInvoices();
      setInvoices(Array.isArray(data) ? (data as Invoice[]) : []);
    } catch {
      setInvoices([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const handlePay = async (invoice: Invoice) => {
    setPaying(invoice.id);
    try {
      const order = await createPaymentOrder(invoice.id);

      // Try native Razorpay checkout first; fall back to WebView.
      let RazorpayCheckout: any = null;
      try {
        // Lazy require so the bundle doesn't break if the native module is absent.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        RazorpayCheckout = require("react-native-razorpay").default;
      } catch {
        RazorpayCheckout = null;
      }

      if (RazorpayCheckout && order.keyId) {
        const options = {
          description: `Invoice ${invoice.invoiceNumber || invoice.id}`,
          currency: order.currency || "INR",
          key: order.keyId,
          amount: order.amount,
          name: "MedCore Hospital",
          order_id: order.orderId,
          prefill: {
            email: user?.email,
            contact: user?.phone,
            name: user?.name,
          },
          theme: { color: "#2563eb" },
        };
        try {
          const result: any = await RazorpayCheckout.open(options);
          await verifyPayment({
            invoiceId: invoice.id,
            razorpayOrderId: result.razorpay_order_id || order.orderId,
            razorpayPaymentId: result.razorpay_payment_id,
            razorpaySignature: result.razorpay_signature,
          });
          Alert.alert("Success", "Payment received. Thank you!");
          load();
        } catch (err: any) {
          if (err?.code !== 0) {
            Alert.alert(
              "Payment failed",
              err?.description || err?.message || "Could not complete payment"
            );
          }
        }
      } else if (order.checkoutUrl) {
        // WebView fallback path. Caller can verify the payment when the
        // backend webhook lands; meanwhile show a hosted checkout page.
        setPendingInvoiceId(invoice.id);
        setCheckoutUrl(order.checkoutUrl);
      } else {
        Alert.alert(
          "Razorpay unavailable",
          "Native checkout module is not bundled and no fallback URL was returned by the API."
        );
      }
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Could not start payment");
    } finally {
      setPaying(null);
    }
  };

  const renderItem = ({ item }: { item: Invoice }) => {
    const sc = statusColor(item.paymentStatus);
    const due = item.amountDue ?? item.totalAmount;
    return (
      <View style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconCircle}>
            <Ionicons name="receipt-outline" size={22} color="#2563eb" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.invNumber}>
              {item.invoiceNumber || `Invoice ${item.id.slice(0, 8)}`}
            </Text>
            <Text style={styles.dateText}>
              {item.createdAt
                ? new Date(item.createdAt).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : ""}
            </Text>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: sc.bg }]}>
            <Text style={[styles.statusText, { color: sc.text }]}>
              {item.paymentStatus}
            </Text>
          </View>
        </View>

        <View style={styles.amountRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.amountLabel}>Total</Text>
            <Text style={styles.amountValue}>{formatINR(item.totalAmount)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.amountLabel}>
              {item.paymentStatus === "PAID" ? "Paid" : "Due"}
            </Text>
            <Text
              style={[
                styles.amountValue,
                item.paymentStatus !== "PAID" && { color: "#dc2626" },
              ]}
            >
              {formatINR(item.paymentStatus === "PAID" ? item.amountPaid : due)}
            </Text>
          </View>
        </View>

        {item.paymentStatus !== "PAID" && (
          <TouchableOpacity
            style={[styles.payBtn, paying === item.id && { opacity: 0.7 }]}
            onPress={() => handlePay(item)}
            disabled={paying === item.id}
          >
            {paying === item.id ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="card-outline" size={18} color="#fff" />
                <Text style={styles.payBtnText}>Pay Now</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
      </View>
    );
  }

  return (
    <>
      <FlatList
        data={invoices}
        keyExtractor={(item, i) => item.id || String(i)}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 16 }}
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Ionicons name="receipt-outline" size={48} color="#d1d5db" />
            <Text style={styles.emptyText}>No invoices yet</Text>
          </View>
        }
      />

      <Modal
        visible={!!checkoutUrl}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCheckoutUrl(null)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalHeaderTitle}>Razorpay Checkout</Text>
            <TouchableOpacity
              onPress={() => {
                setCheckoutUrl(null);
                setPendingInvoiceId(null);
                load();
              }}
            >
              <Ionicons name="close" size={24} color="#374151" />
            </TouchableOpacity>
          </View>
          <CheckoutWebView
            url={checkoutUrl || ""}
            onClose={() => {
              setCheckoutUrl(null);
              setPendingInvoiceId(null);
              load();
            }}
            invoiceId={pendingInvoiceId}
          />
        </View>
      </Modal>
    </>
  );
}

/**
 * Renders the Razorpay hosted checkout in a WebView when the native SDK is
 * not bundled. Lazy-loads `react-native-webview` so the app still builds
 * without it (in which case we fall back to a friendly message).
 */
function CheckoutWebView({
  url,
  onClose,
  invoiceId,
}: {
  url: string;
  onClose: () => void;
  invoiceId: string | null;
}) {
  const [WebViewComp, setWebViewComp] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("react-native-webview").catch(() => null);
        if (!cancelled && mod) setWebViewComp(() => (mod as any).WebView);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!WebViewComp) {
    return (
      <View style={styles.center}>
        <Ionicons name="open-outline" size={48} color="#9ca3af" />
        <Text style={styles.emptyText}>
          Open this URL in your browser to complete payment:
        </Text>
        <Text style={[styles.emptyText, { marginTop: 8, color: "#2563eb" }]}>
          {url}
        </Text>
        <TouchableOpacity
          style={[styles.payBtn, { marginTop: 24, paddingHorizontal: 32 }]}
          onPress={onClose}
        >
          <Text style={styles.payBtnText}>Done</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <WebViewComp
      source={{ uri: url }}
      style={{ flex: 1 }}
      onNavigationStateChange={(state: any) => {
        // If the hosted page redirects to a success/failure URL, close.
        if (
          state.url.includes("payment-success") ||
          state.url.includes("payment-cancelled")
        ) {
          onClose();
        }
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f3f4f6" },
  center: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24 },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#eff6ff",
    justifyContent: "center",
    alignItems: "center",
  },
  invNumber: { fontSize: 15, fontWeight: "600", color: "#111827" },
  dateText: { fontSize: 12, color: "#9ca3af", marginTop: 2 },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: { fontSize: 11, fontWeight: "bold" },
  amountRow: {
    flexDirection: "row",
    marginTop: 12,
    backgroundColor: "#f9fafb",
    borderRadius: 8,
    padding: 12,
  },
  amountLabel: { fontSize: 12, color: "#6b7280" },
  amountValue: { fontSize: 16, fontWeight: "bold", color: "#111827", marginTop: 2 },
  payBtn: {
    flexDirection: "row",
    backgroundColor: "#2563eb",
    borderRadius: 10,
    paddingVertical: 14,
    justifyContent: "center",
    alignItems: "center",
    marginTop: 12,
    gap: 6,
  },
  payBtnText: { color: "#fff", fontSize: 15, fontWeight: "bold" },
  emptyWrap: { alignItems: "center", marginTop: 60, gap: 8 },
  emptyText: { color: "#9ca3af", fontSize: 14, textAlign: "center" },
  modalContainer: { flex: 1, backgroundColor: "#fff" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  modalHeaderTitle: { fontSize: 17, fontWeight: "bold", color: "#111827" },
});
