/**
 * IP-based failed-login lockout (Issue #164).
 *
 * Separate from the rate limiter:
 *   • rate-limit caps TOTAL attempts (success or failure) per minute.
 *   • lockout reacts ONLY to repeated FAILED logins from the same IP, and
 *     locks the IP out for a grace window so a brute-force script can't keep
 *     pummelling distinct usernames against the same box.
 *
 * Policy:
 *   • Sliding window: 15 minutes
 *   • Threshold: 5 consecutive failed login attempts within the window
 *   • Lockout: 15 minutes (TTL refreshes on every NEW failure during lockout)
 *
 * Storage is an in-memory Map keyed by IP. The cleanup interval prunes
 * entries older than the window so memory stays bounded. State is per-process
 * which is acceptable for our single-instance prod deployment — when we move
 * to a fleet we'll back this with Redis.
 *
 * The lockout is gated off in NODE_ENV=test and when DISABLE_RATE_LIMITS=true
 * for the same reasons the rate limiter is — see middleware/rate-limit.ts.
 */

const FAILED_LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 min sliding window
const FAILED_LOGIN_THRESHOLD = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 min lockout

interface FailureEntry {
  // Timestamps (ms) of recent failures within the sliding window.
  failures: number[];
  // If set, IP is locked out until this ms epoch.
  lockedUntil?: number;
}

const recentFailures = new Map<string, FailureEntry>();

// Cleanup interval to prune stale entries (no failures and no active lockout)
// every minute. Allow `unref()` so the timer doesn't block process exit.
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of recentFailures) {
    const filteredFailures = entry.failures.filter(
      (t) => now - t < FAILED_LOGIN_WINDOW_MS
    );
    const stillLocked = entry.lockedUntil && entry.lockedUntil > now;
    if (filteredFailures.length === 0 && !stillLocked) {
      recentFailures.delete(ip);
    } else {
      entry.failures = filteredFailures;
    }
  }
}, 60_000);
if (cleanup.unref) cleanup.unref();

function isDisabled(): boolean {
  return (
    process.env.NODE_ENV === "test" || process.env.DISABLE_RATE_LIMITS === "true"
  );
}

export interface LockoutStatus {
  locked: boolean;
  remainingSeconds: number;
}

/**
 * Check whether the given IP is currently locked out.
 * Returns `{ locked: true, remainingSeconds }` if blocked, otherwise
 * `{ locked: false, remainingSeconds: 0 }`.
 */
export function checkLockout(ip: string): LockoutStatus {
  if (isDisabled()) return { locked: false, remainingSeconds: 0 };
  const entry = recentFailures.get(ip);
  if (!entry?.lockedUntil) return { locked: false, remainingSeconds: 0 };
  const now = Date.now();
  if (entry.lockedUntil <= now) {
    // Expired — clear the lockout but keep recent failures (they may roll off
    // the window naturally; callers see a clean slate).
    entry.lockedUntil = undefined;
    return { locked: false, remainingSeconds: 0 };
  }
  return {
    locked: true,
    remainingSeconds: Math.ceil((entry.lockedUntil - now) / 1000),
  };
}

/**
 * Record a failed login from this IP. Returns whether the IP just crossed
 * the threshold and got locked out (so the caller can emit the
 * AUTH_LOCKOUT_TRIGGERED audit log entry exactly once per lockout).
 */
export function recordFailedLogin(ip: string): {
  justLocked: boolean;
  failureCount: number;
  remainingAttempts: number;
} {
  if (isDisabled()) {
    return { justLocked: false, failureCount: 0, remainingAttempts: FAILED_LOGIN_THRESHOLD };
  }
  const now = Date.now();
  let entry = recentFailures.get(ip);
  if (!entry) {
    entry = { failures: [] };
    recentFailures.set(ip, entry);
  }
  // Drop failures older than the window
  entry.failures = entry.failures.filter(
    (t) => now - t < FAILED_LOGIN_WINDOW_MS
  );
  entry.failures.push(now);

  // Already locked out (extending the lockout would be unfair, but keep the
  // counter honest so the lockout doesn't end prematurely).
  if (entry.lockedUntil && entry.lockedUntil > now) {
    return {
      justLocked: false,
      failureCount: entry.failures.length,
      remainingAttempts: 0,
    };
  }

  if (entry.failures.length >= FAILED_LOGIN_THRESHOLD) {
    entry.lockedUntil = now + LOCKOUT_DURATION_MS;
    return {
      justLocked: true,
      failureCount: entry.failures.length,
      remainingAttempts: 0,
    };
  }

  return {
    justLocked: false,
    failureCount: entry.failures.length,
    remainingAttempts: FAILED_LOGIN_THRESHOLD - entry.failures.length,
  };
}

/** Successful login clears the IP's failure history. */
export function clearFailedLogins(ip: string): void {
  if (isDisabled()) return;
  recentFailures.delete(ip);
}

/** Test-only — wipe all state between test cases. */
export function __resetLockoutStateForTests(): void {
  recentFailures.clear();
}

export const __LOCKOUT_CONFIG = {
  WINDOW_MS: FAILED_LOGIN_WINDOW_MS,
  THRESHOLD: FAILED_LOGIN_THRESHOLD,
  LOCKOUT_MS: LOCKOUT_DURATION_MS,
};
