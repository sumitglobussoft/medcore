/**
 * Obtains a bearer token from POST /api/v1/auth/login for one of the
 * seeded test accounts. Caches the token in-memory for the process
 * lifetime so the load harness doesn't re-login per request.
 *
 * Zero dependencies — uses Node 18+ global `fetch`.
 */

export interface LoginCredentials {
  email: string;
  password: string;
}

export const DEFAULT_ADMIN: LoginCredentials = {
  email: "admin@medcore.local",
  password: "admin123",
};

interface TokenCacheEntry {
  accessToken: string;
  expiresAt: number; // epoch ms
}

const cache = new Map<string, TokenCacheEntry>();

/**
 * Returns a valid bearer token string (no "Bearer " prefix).
 * The token is cached in-process for ~50 minutes; refresh logic is
 * intentionally simple — if the API says 401 we re-login.
 */
export async function getAuthToken(
  baseUrl: string,
  creds: LoginCredentials = DEFAULT_ADMIN
): Promise<string> {
  const cacheKey = `${baseUrl}::${creds.email}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.accessToken;
  }

  const url = `${baseUrl.replace(/\/+$/, "")}/api/v1/auth/login`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(creds),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "<no body>");
    throw new Error(
      `Login failed: ${res.status} ${res.statusText} at ${url} — body: ${text.slice(0, 300)}`
    );
  }

  const payload = (await res.json()) as {
    success: boolean;
    data?: {
      accessToken?: string;
      twoFactorRequired?: boolean;
      tempToken?: string;
    };
    error?: string | null;
  };

  if (!payload.success || !payload.data) {
    throw new Error(`Login API returned error: ${payload.error ?? "unknown"}`);
  }
  if (payload.data.twoFactorRequired) {
    throw new Error(
      "Test account has 2FA enabled. Disable 2FA for load-test accounts or pass a non-2FA user."
    );
  }
  const accessToken = payload.data.accessToken;
  if (!accessToken) {
    throw new Error("Login payload did not include accessToken.");
  }

  cache.set(cacheKey, {
    accessToken,
    // Conservative: assume 50 min validity. Server default is 15m but we
    // don't need to be precise — if it expires we get a 401 and relogin.
    expiresAt: Date.now() + 50 * 60 * 1000,
  });

  return accessToken;
}

export function clearTokenCache(): void {
  cache.clear();
}

/**
 * Builds the Authorization header value. If `mock` is true, we return a
 * synthetic bearer so the mock server can be exercised without any real
 * auth flow.
 */
export async function authHeader(
  baseUrl: string,
  opts: { mock?: boolean; creds?: LoginCredentials } = {}
): Promise<string> {
  if (opts.mock) return "Bearer mock-load-test-token";
  const token = await getAuthToken(baseUrl, opts.creds ?? DEFAULT_ADMIN);
  return `Bearer ${token}`;
}
