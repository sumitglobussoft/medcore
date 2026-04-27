// Issue #164 — IP-based failed-login lockout unit tests.
//
// The service is intentionally a pass-through when NODE_ENV=test (same gate
// the rate limiter uses) so the integration suite isn't punished by stale
// failure counters between test files. We flip NODE_ENV off for the lifetime
// of this suite to exercise the real logic, mirroring what the
// rate-limit.test.ts unit suite does.
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

let checkLockout: typeof import("./auth-lockout").checkLockout;
let recordFailedLogin: typeof import("./auth-lockout").recordFailedLogin;
let clearFailedLogins: typeof import("./auth-lockout").clearFailedLogins;
let __resetLockoutStateForTests: typeof import("./auth-lockout").__resetLockoutStateForTests;

beforeAll(async () => {
  process.env.NODE_ENV = "development";
  // Re-import after flipping the env so the module's top-level
  // disabled-check picks up the new value.
  const mod = await import("./auth-lockout");
  checkLockout = mod.checkLockout;
  recordFailedLogin = mod.recordFailedLogin;
  clearFailedLogins = mod.clearFailedLogins;
  __resetLockoutStateForTests = mod.__resetLockoutStateForTests;
});

afterAll(() => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
});

beforeEach(() => {
  __resetLockoutStateForTests();
});

describe("auth-lockout — IP-based failed-login throttle (Issue #164)", () => {
  it("does not lock the IP for the first 4 failures", () => {
    const ip = "10.10.10.1";
    for (let i = 0; i < 4; i++) {
      const result = recordFailedLogin(ip);
      expect(result.justLocked, `failure #${i + 1} should NOT lock`).toBe(false);
      expect(result.failureCount).toBe(i + 1);
      expect(result.remainingAttempts).toBe(5 - (i + 1));
    }
    expect(checkLockout(ip).locked).toBe(false);
  });

  it("locks the IP on the 5th consecutive failure", () => {
    const ip = "10.10.10.2";
    for (let i = 0; i < 4; i++) recordFailedLogin(ip);
    const fifth = recordFailedLogin(ip);
    expect(fifth.justLocked).toBe(true);
    expect(fifth.failureCount).toBe(5);
    expect(fifth.remainingAttempts).toBe(0);

    const status = checkLockout(ip);
    expect(status.locked).toBe(true);
    expect(status.remainingSeconds).toBeGreaterThan(0);
    expect(status.remainingSeconds).toBeLessThanOrEqual(15 * 60);
  });

  it("a 6th attempt while locked is rejected (lockout sticky)", () => {
    const ip = "10.10.10.3";
    for (let i = 0; i < 5; i++) recordFailedLogin(ip);

    // Sixth attempt — bumps counter but does NOT re-trigger the
    // justLocked alarm (already locked).
    const sixth = recordFailedLogin(ip);
    expect(sixth.justLocked).toBe(false);
    expect(checkLockout(ip).locked).toBe(true);
  });

  it("buckets are isolated per IP", () => {
    const ipA = "192.168.1.1";
    const ipB = "192.168.1.2";
    for (let i = 0; i < 5; i++) recordFailedLogin(ipA);
    expect(checkLockout(ipA).locked).toBe(true);
    // ipB never failed
    expect(checkLockout(ipB).locked).toBe(false);
    // First failure on ipB is still attempt #1
    expect(recordFailedLogin(ipB).failureCount).toBe(1);
  });

  it("clearFailedLogins removes the lockout and history", () => {
    const ip = "10.10.10.5";
    for (let i = 0; i < 5; i++) recordFailedLogin(ip);
    expect(checkLockout(ip).locked).toBe(true);
    clearFailedLogins(ip);
    expect(checkLockout(ip).locked).toBe(false);
    // Counter is fresh.
    expect(recordFailedLogin(ip).failureCount).toBe(1);
  });
});
