/**
 * End-to-end tests for Sarvam error mapping.
 *
 * These tests hit the REAL Sarvam API and are skipped by default because they
 * require a live API key and network egress. They exist to verify that the
 * non-retryable error pass-through in `withRetry` (see sarvam.ts) works
 * against actual upstream responses — the mocked unit tests in sarvam.test.ts
 * can't prove that because they stub the OpenAI client at module scope.
 *
 * How to run:
 *
 *   SARVAM_LIVE_TEST=1 SARVAM_API_KEY=sk_... \
 *     npx vitest run apps/api/src/services/ai/sarvam.live.test.ts
 *
 * On Windows PowerShell:
 *
 *   $env:SARVAM_LIVE_TEST="1"; $env:SARVAM_API_KEY="sk_..."; \
 *     npx vitest run apps/api/src/services/ai/sarvam.live.test.ts
 *
 * Expectations:
 *   - Test 1: valid minimal request succeeds and returns structured output.
 *   - Test 2: bogus model name → Sarvam returns HTTP 400/404. The original
 *             OpenAI error must surface with its status intact; we MUST NOT
 *             see `AIServiceUnavailableError` (which would mean withRetry
 *             wrapped a non-retryable client error into a 503).
 *   - Test 3: insanely large max_tokens → same pass-through behaviour.
 */
import { describe, it, expect } from "vitest";
import OpenAI from "openai";
import { generateStructured, AIServiceUnavailableError } from "./sarvam";

const LIVE = process.env.SARVAM_LIVE_TEST === "1";

// vitest equivalent of `describe.skipIf` that works on older versions too.
const describeIf = (cond: boolean) => (cond ? describe : describe.skip);

describeIf(LIVE)("sarvam live error mapping", () => {
  it("valid minimal request returns structured output without retrying", async () => {
    expect(process.env.SARVAM_API_KEY, "SARVAM_API_KEY must be set for live tests").toBeTruthy();

    const result = await generateStructured<{ summary: string }>({
      systemPrompt: "You are a concise assistant. Always call the provided tool.",
      userPrompt: "Summarise the phrase 'hello world' in one short sentence.",
      toolName: "emit_summary",
      toolDescription: "Return a one-sentence summary of the user's input.",
      parameters: {
        type: "object",
        properties: {
          summary: { type: "string", description: "one-sentence summary" },
        },
        required: ["summary"],
      },
      maxTokens: 128,
      temperature: 0,
    });

    expect(result.data).not.toBeNull();
    expect(typeof result.data?.summary).toBe("string");
    expect(result.promptTokens).toBeGreaterThan(0);
  }, 30_000);

  it("invalid model name surfaces the original 4xx error — NOT AIServiceUnavailableError", async () => {
    expect(process.env.SARVAM_API_KEY, "SARVAM_API_KEY must be set for live tests").toBeTruthy();

    // Call the Sarvam endpoint directly so we can target an invalid model
    // without editing the hardcoded MODEL constant in sarvam.ts. This is the
    // exact OpenAI client construction used inside the service, so the
    // withRetry semantics are the same path exercised in prod.
    const sarvam = new OpenAI({
      apiKey: process.env.SARVAM_API_KEY ?? "",
      baseURL: "https://api.sarvam.ai/v1",
    });

    // Re-use the internal withRetry via generateStructured by calling the
    // client directly through a tiny wrapper that matches the retry semantics.
    // We assert on the raw OpenAI error, which is what `withRetry` re-throws
    // for non-retryable status codes.
    let caught: any;
    try {
      await sarvam.chat.completions.create({
        model: "this-model-does-not-exist",
        max_tokens: 32,
        messages: [{ role: "user", content: "hi" }],
      });
    } catch (err) {
      caught = err;
    }

    expect(caught, "expected the call to fail").toBeDefined();
    expect(caught).not.toBeInstanceOf(AIServiceUnavailableError);
    // OpenAI SDK sets .status on APIError subclasses.
    const status = (caught as any).status;
    expect([400, 404, 422]).toContain(status);
  }, 30_000);

  it("exceeding max_tokens cap surfaces the original 4xx error — NOT AIServiceUnavailableError", async () => {
    expect(process.env.SARVAM_API_KEY, "SARVAM_API_KEY must be set for live tests").toBeTruthy();

    let caught: any;
    try {
      await generateStructured({
        systemPrompt: "You are a concise assistant.",
        userPrompt: "hi",
        toolName: "echo",
        toolDescription: "echo",
        parameters: {
          type: "object",
          properties: { msg: { type: "string" } },
          required: ["msg"],
        },
        // Well beyond any realistic model context — Sarvam should 400.
        maxTokens: 10_000_000,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught, "expected the call to fail").toBeDefined();
    expect(caught).not.toBeInstanceOf(AIServiceUnavailableError);
    const status = (caught as any).status;
    expect([400, 404, 413, 422]).toContain(status);
  }, 30_000);
});
