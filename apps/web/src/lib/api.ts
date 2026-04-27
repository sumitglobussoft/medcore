import { toast } from "@/lib/toast";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

interface FetchOptions extends RequestInit {
  token?: string;
}

/**
 * Issues #101 + #132: centralised 401 handling.
 *
 * When ANY API call returns 401 (token expired, revoked, or never issued)
 * we:
 *   1. Clear the stored auth tokens so subsequent calls don't keep failing.
 *   2. Show a friendly toast instead of leaving the user staring at a blank
 *      page after a navigate.
 *   3. Redirect to /login (preserving the current path as ?next= so the
 *      user lands back where they were after re-authenticating).
 *
 * Idempotent — only fires once per page lifecycle so a burst of parallel
 * 401s doesn't spam the user with toasts.
 *
 * Routes that legitimately probe with possibly-bad tokens (loadSession,
 * /auth/me) can opt out by passing `{ skip401Redirect: true }`.
 */
let authExpiredHandled = false;
function handleAuthExpired(): void {
  if (authExpiredHandled) return;
  authExpiredHandled = true;
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem("medcore_token");
    localStorage.removeItem("medcore_refresh");
  } catch {
    // localStorage may be unavailable in private mode — best-effort.
  }
  toast.error("Your session has expired, please sign in again.", 6000);
  // Avoid redirecting if we're already on /login — prevents a loop when the
  // login form itself returns a 401 for bad credentials.
  const here = window.location.pathname;
  if (here.startsWith("/login") || here.startsWith("/register")) return;
  const next = encodeURIComponent(here + window.location.search);
  // Use replace() so the protected page isn't in history (back button
  // shouldn't take the user to a route that just bounced them).
  window.location.replace(`/login?next=${next}`);
}

/** Test-only — reset the once-per-pageload latch. */
export function __resetAuthExpiredLatchForTests(): void {
  authExpiredHandled = false;
}

interface RequestOptions extends FetchOptions {
  /**
   * Skip the 401 redirect-and-toast for endpoints that legitimately probe
   * with a possibly-stale token (e.g. /auth/me on app boot). The 401 is
   * still surfaced to the caller as a thrown Error so per-call handling
   * still works.
   */
  skip401Redirect?: boolean;
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { token, headers: customHeaders, skip401Redirect, ...rest } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((customHeaders as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  } else if (typeof window !== "undefined") {
    const stored = localStorage.getItem("medcore_token");
    if (stored) headers["Authorization"] = `Bearer ${stored}`;
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers,
    ...rest,
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    data = { error: res.statusText };
  }

  if (!res.ok) {
    // Issues #101 + #132: 401 → expired session. Redirect+toast unless
    // the caller opted out (e.g. /auth/me on app boot).
    if (res.status === 401 && !skip401Redirect && typeof window !== "undefined") {
      handleAuthExpired();
    }
    const err = new Error(data?.error || "Request failed") as Error & {
      status?: number;
      payload?: unknown;
    };
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

export const api = {
  get: <T>(endpoint: string, opts?: RequestOptions) =>
    request<T>(endpoint, { method: "GET", ...opts }),

  post: <T>(endpoint: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(endpoint, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
      ...opts,
    }),

  patch: <T>(endpoint: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(endpoint, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
      ...opts,
    }),

  put: <T>(endpoint: string, body?: unknown, opts?: RequestOptions) =>
    request<T>(endpoint, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
      ...opts,
    }),

  delete: <T>(endpoint: string, opts?: RequestOptions) =>
    request<T>(endpoint, { method: "DELETE", ...opts }),
};

/**
 * Open an authenticated HTML print endpoint in a new window.
 * Fetches with the user's JWT, then writes the HTML response to a blank popup
 * which auto-triggers the browser print dialog.
 */
export async function openPrintEndpoint(endpoint: string): Promise<void> {
  const token =
    typeof window !== "undefined"
      ? localStorage.getItem("medcore_token")
      : null;
  // Open early to avoid popup blockers
  const win = window.open("", "_blank");
  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const html = await res.text();
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
    }
  } catch (err) {
    if (win) win.close();
    toast.error(err instanceof Error ? err.message : "Failed to open document");
  }
}
