import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────
//
// Capture constructor args so the provider-selection tests can assert the
// base URL that was wired up for each provider.

const { openaiCtorArgs } = vi.hoisted(() => ({
  openaiCtorArgs: [] as Array<{ apiKey?: string; baseURL?: string }>,
}));

vi.mock("openai", () => {
  class OpenAI {
    chat = {
      completions: {
        create: vi.fn(),
      },
    };
    constructor(opts: any) {
      openaiCtorArgs.push({ apiKey: opts?.apiKey, baseURL: opts?.baseURL });
    }
  }
  return { default: OpenAI };
});

// Spy on logAICall so the failover test can assert a failover=true event
// was emitted. We capture calls on the shared logger module.
const logAICallSpy = vi.fn();
vi.mock("./sarvam-logging", () => ({
  logAICall: (opts: any) => logAICallSpy(opts),
}));

import {
  getChatClient,
  callWithFallback,
  type ModelProvider,
} from "./model-router";

beforeEach(() => {
  openaiCtorArgs.length = 0;
  logAICallSpy.mockReset();
  // Ensure no stale env var leaks between tests.
  delete process.env.AI_PROVIDER;
  delete process.env.OPENAI_BASE_URL;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── getChatClient ─────────────────────────────────────────────────────────────

describe("getChatClient", () => {
  it("defaults to sarvam when AI_PROVIDER is unset", () => {
    getChatClient();
    expect(openaiCtorArgs).toHaveLength(1);
    expect(openaiCtorArgs[0].baseURL).toBe("https://api.sarvam.ai/v1");
  });

  it("uses OpenAI base URL when AI_PROVIDER=openai", () => {
    process.env.AI_PROVIDER = "openai";
    getChatClient();
    expect(openaiCtorArgs).toHaveLength(1);
    expect(openaiCtorArgs[0].baseURL).toBe("https://api.openai.com/v1");
  });

  it("honours OPENAI_BASE_URL override (e.g. Azure) when provider is openai", () => {
    process.env.AI_PROVIDER = "openai";
    process.env.OPENAI_BASE_URL = "https://custom.azure.example.com/v1";
    getChatClient();
    expect(openaiCtorArgs[0].baseURL).toBe("https://custom.azure.example.com/v1");
  });

  it("throws a clear error when AI_PROVIDER is an unknown value", () => {
    // `as any` because the type excludes unknown values — we want to exercise
    // the runtime guard that catches misconfiguration at the env level.
    expect(() => getChatClient("claude" as any)).toThrow(/Unknown AI_PROVIDER/i);
  });

  it("throws the documented stub error for anthropic until the adapter lands", () => {
    expect(() => getChatClient("anthropic")).toThrow(/not yet implemented/i);
  });
});

// ── callWithFallback ──────────────────────────────────────────────────────────

describe("callWithFallback", () => {
  it("returns on first successful provider without trying later ones", async () => {
    const fn = vi.fn(async (_client: any, provider: ModelProvider) => ({
      ok: true,
      provider,
    }));
    const out = await callWithFallback(fn, {
      providers: ["sarvam", "openai"],
      feature: "triage",
    });
    expect(out).toEqual({ ok: true, provider: "sarvam" });
    expect(fn).toHaveBeenCalledTimes(1);
    // No failover event when primary succeeds.
    expect(
      logAICallSpy.mock.calls.some((c) => c[0]?.failover === true)
    ).toBe(false);
  });

  it("falls through to the next provider on failure and logs a failover event", async () => {
    const primaryErr = new Error("sarvam down");
    const fn = vi.fn(async (_client: any, provider: ModelProvider) => {
      if (provider === "sarvam") throw primaryErr;
      return { ok: true, provider };
    });

    const out = await callWithFallback(fn, {
      providers: ["sarvam", "openai"],
      feature: "triage",
    });
    expect(out).toEqual({ ok: true, provider: "openai" });
    expect(fn).toHaveBeenCalledTimes(2);

    // Exactly one failover event for the first (failed) provider.
    const failoverEvents = logAICallSpy.mock.calls
      .map((c) => c[0])
      .filter((e) => e.failover === true);
    expect(failoverEvents).toHaveLength(1);
    expect(failoverEvents[0].model).toBe("sarvam");
    expect(failoverEvents[0].feature).toBe("triage");
    expect(failoverEvents[0].error).toMatch(/sarvam down/);
  });

  it("re-throws the final error when every provider fails", async () => {
    const err1 = new Error("sarvam down");
    const err2 = new Error("openai down");
    const fn = vi.fn(async (_client: any, provider: ModelProvider) => {
      throw provider === "sarvam" ? err1 : err2;
    });

    await expect(
      callWithFallback(fn, {
        providers: ["sarvam", "openai"],
        feature: "scribe",
      })
    ).rejects.toBe(err2);

    // Both providers logged as failover events.
    const failoverEvents = logAICallSpy.mock.calls
      .map((c) => c[0])
      .filter((e) => e.failover === true);
    expect(failoverEvents).toHaveLength(2);
    expect(failoverEvents.map((e) => e.model)).toEqual(["sarvam", "openai"]);
  });

  it("rejects an empty providers array with a clear error", async () => {
    await expect(
      callWithFallback(async () => "nope", { providers: [], feature: "triage" })
    ).rejects.toThrow(/providers array must not be empty/i);
  });
});
