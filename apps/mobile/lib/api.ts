import * as SecureStore from "expo-secure-store";
import Constants from "expo-constants";

/**
 * Base URL resolution order:
 *   1. EXPO_PUBLIC_API_URL env var (build-time)
 *   2. expoConfig.extra.apiUrl (set in app.config.ts)
 *   3. Hardcoded production fallback
 */
const FALLBACK_URL = "https://medcore.globusdemos.com/api/v1";
const BASE_URL: string =
  (process.env.EXPO_PUBLIC_API_URL as string | undefined) ||
  (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl ||
  FALLBACK_URL;

export const API_BASE_URL = BASE_URL;

const ACCESS_TOKEN_KEY = "medcore_access_token";
const REFRESH_TOKEN_KEY = "medcore_refresh_token";

async function getAccessToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function getRefreshToken(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
}

async function setTokens(accessToken: string, refreshToken: string) {
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
}

async function clearTokens() {
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

// Optional logout hook called when refresh fails. The auth context registers it.
let onAuthFailure: (() => void) | null = null;
export function registerAuthFailureHandler(fn: (() => void) | null) {
  onAuthFailure = fn;
}

// Single in-flight refresh promise to prevent thundering-herd on parallel 401s.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const refreshToken = await getRefreshToken();
      if (!refreshToken) return null;
      const res = await fetch(`${BASE_URL}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const body = (await res.json().catch(() => null)) as
        | { data?: { tokens?: { accessToken: string; refreshToken: string } } }
        | null;
      const tokens = body?.data?.tokens;
      if (!tokens?.accessToken || !tokens?.refreshToken) return null;
      await setTokens(tokens.accessToken, tokens.refreshToken);
      return tokens.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function request<T = any>(
  endpoint: string,
  options: RequestInit = {},
  _retried = false
): Promise<T> {
  const token = await getAccessToken();

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (
    res.status === 401 &&
    !_retried &&
    endpoint !== "/auth/refresh" &&
    endpoint !== "/auth/login"
  ) {
    const newToken = await refreshAccessToken();
    if (newToken) {
      return request<T>(endpoint, options, true);
    }
    // Refresh failed -> wipe local state and notify auth context.
    await clearTokens();
    if (onAuthFailure) onAuthFailure();
    throw new ApiError(401, "Session expired", null);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.message || res.statusText, body);
  }

  return res.json();
}

export class ApiError extends Error {
  status: number;
  body: any;
  constructor(status: number, message: string, body: any) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// ── Auth ────────────────────────────────────────────────────────────────

export async function loginApi(email: string, password: string) {
  const res = await request<{
    data: {
      user: any;
      tokens: { accessToken: string; refreshToken: string };
    };
  }>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  await setTokens(res.data.tokens.accessToken, res.data.tokens.refreshToken);
  return res.data;
}

export async function registerApi(data: {
  name: string;
  email: string;
  phone: string;
  password: string;
  gender?: string;
  age?: number;
}) {
  const res = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ ...data, role: "PATIENT" }),
  });
  return res;
}

export async function fetchMe() {
  const res = await request<{ data: any }>("/auth/me");
  return res.data;
}

export async function logoutApi() {
  await clearTokens();
}

export async function hasStoredToken(): Promise<boolean> {
  const token = await getAccessToken();
  return !!token;
}

// ── Doctors ─────────────────────────────────────────────────────────────

export async function fetchDoctors() {
  const res = await request<{ data: any[] }>("/doctors");
  return res.data;
}

export async function fetchDoctorSlots(doctorId: string, date: string) {
  const res = await request<{ data: any[] }>(
    `/doctors/${doctorId}/slots?date=${date}`
  );
  return res.data;
}

// ── Appointments ────────────────────────────────────────────────────────

export async function fetchAppointments(params?: {
  date?: string;
  patientId?: string;
}) {
  const query = new URLSearchParams();
  if (params?.date) query.set("date", params.date);
  if (params?.patientId) query.set("patientId", params.patientId);
  const qs = query.toString();
  const res = await request<{ data: any[] }>(
    `/appointments${qs ? `?${qs}` : ""}`
  );
  return res.data;
}

export async function bookAppointment(data: {
  patientId: string;
  doctorId: string;
  date: string;
  slotId: string;
}) {
  const res = await request("/appointments/book", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res;
}

export async function updateAppointmentStatus(id: string, status: string) {
  const res = await request(`/appointments/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
  return res;
}

// ── Queue ───────────────────────────────────────────────────────────────

export async function fetchQueue(doctorId?: string) {
  if (doctorId) {
    const res = await request<{ data: any }>(`/queue/${doctorId}`);
    return res.data;
  }
  const res = await request<{ data: any[] }>("/queue");
  return res.data;
}

// ── Prescriptions ───────────────────────────────────────────────────────

export async function fetchPrescriptions(patientId?: string) {
  const qs = patientId ? `?patientId=${patientId}` : "";
  const res = await request<{ data: any[] }>(`/prescriptions${qs}`);
  return res.data;
}

export async function fetchPrescriptionDetail(id: string) {
  const res = await request<{ data: any }>(`/prescriptions/${id}`);
  return res.data;
}

// ── Billing ─────────────────────────────────────────────────────────────

export async function fetchInvoices(patientId?: string) {
  const qs = patientId ? `?patientId=${patientId}` : "";
  const res = await request<{ data: any[] }>(`/billing/invoices${qs}`);
  return res.data;
}

export async function fetchInvoiceDetail(id: string) {
  const res = await request<{ data: any }>(`/billing/invoices/${id}`);
  return res.data;
}

export async function createPaymentOrder(invoiceId: string) {
  const res = await request<{
    data: {
      orderId: string;
      amount: number;
      currency: string;
      keyId?: string;
      checkoutUrl?: string;
    };
  }>("/billing/pay-online", {
    method: "POST",
    body: JSON.stringify({ invoiceId }),
  });
  return res.data;
}

export async function verifyPayment(payload: {
  invoiceId: string;
  razorpayOrderId: string;
  razorpayPaymentId: string;
  razorpaySignature: string;
}) {
  const res = await request("/billing/verify-payment", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res;
}

// ── Patients ────────────────────────────────────────────────────────────

export async function fetchPatientDetail(id: string) {
  const res = await request<{ data: any }>(`/patients/${id}`);
  return res.data;
}

// ── Push notifications ──────────────────────────────────────────────────

export async function registerPushToken(token: string, platform: string) {
  const res = await request("/notifications/push-token/register", {
    method: "POST",
    body: JSON.stringify({ token, platform }),
  });
  return res;
}
