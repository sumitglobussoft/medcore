// Shared observability helper for AI call paths.
//
// Split out of sarvam.ts so auxiliary modules (model-router, prompt-registry,
// provider adapters) can log without triggering a circular import back into
// sarvam.ts's wrappers.

export function logAICall(opts: {
  feature:
    | "triage"
    | "scribe"
    | "drug-safety"
    | "hallucination-check"
    | "chart-search-rerank"
    | "report-explainer"
    | "letter-generator"
    | "adherence-bot"
    | "er-triage"
    | "pharmacy-forecast"
    | "model-router";
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  toolUsed?: string;
  error?: string;
  batchIndex?: number;
  batchSize?: number;
  chunkCount?: number;
  /**
   * Set by the multi-provider router when the primary provider failed and we
   * fell through to a backup. Flagged in logs so an alerting rule can track
   * Sarvam outage minutes without grepping for stack traces.
   */
  failover?: boolean;
}): void {
  console.log(
    JSON.stringify({
      level: "info",
      event: "ai_call",
      ...opts,
      ts: new Date().toISOString(),
    })
  );
}
