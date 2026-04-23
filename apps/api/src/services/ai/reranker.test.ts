// Unit tests for the LLM reranker. Sarvam's `generateStructured` is mocked so
// we don't hit the network; these tests verify ordering, batching, fallback,
// and option semantics.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { generateStructuredMock, logAICallMock } = vi.hoisted(() => ({
  generateStructuredMock: vi.fn(),
  logAICallMock: vi.fn(),
}));

vi.mock("./sarvam", () => ({
  generateStructured: generateStructuredMock,
  logAICall: logAICallMock,
}));

import { rerankChunks, type RerankableChunk } from "./reranker";

function chunk(id: string, fts: number, title = `t-${id}`, content = `c-${id}`): RerankableChunk {
  return { id, title, content, ftsScore: fts };
}

beforeEach(() => {
  generateStructuredMock.mockReset();
  logAICallMock.mockReset();
});

describe("rerankChunks", () => {
  it("reorders chunks by LLM score when the call succeeds (happy path)", async () => {
    // Three chunks: FTS prefers A>B>C, but LLM prefers C>A>B.
    const chunks = [chunk("A", 0.9), chunk("B", 0.8), chunk("C", 0.7)];
    generateStructuredMock.mockResolvedValueOnce({
      data: {
        scores: [
          { index: 0, score: 5 }, // A
          { index: 1, score: 2 }, // B
          { index: 2, score: 9 }, // C
        ],
      },
      promptTokens: 100,
      completionTokens: 20,
    });

    const out = await rerankChunks("test query", chunks);
    expect(out.map((c) => c.id)).toEqual(["C", "A", "B"]);
    expect(out[0].relevanceScore).toBe(9);
    expect(out[0].rerankedByLLM).toBe(true);
    expect(logAICallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "chart-search-rerank",
        batchIndex: 0,
        batchSize: 3,
        chunkCount: 3,
        toolUsed: "score_chunks",
      })
    );
  });

  it("falls back to FTS score for chunks the LLM didn't rate", async () => {
    const chunks = [chunk("A", 0.9), chunk("B", 0.5), chunk("C", 0.3)];
    // LLM only scores A (and low); B and C must fall back to FTS ordering.
    generateStructuredMock.mockResolvedValueOnce({
      data: { scores: [{ index: 0, score: 1 }] },
      promptTokens: 50,
      completionTokens: 5,
    });

    const out = await rerankChunks("q", chunks);
    // A was LLM-scored low; B and C fell back (rerankedByLLM=false).
    // Ordering rule: LLM-scored first (A), then fell-back by FTS (B, C).
    expect(out.map((c) => c.id)).toEqual(["A", "B", "C"]);
    const a = out.find((c) => c.id === "A")!;
    const b = out.find((c) => c.id === "B")!;
    expect(a.rerankedByLLM).toBe(true);
    expect(a.relevanceScore).toBe(1);
    expect(b.rerankedByLLM).toBe(false);
    expect(b.relevanceScore).toBe(0.5);
  });

  it("falls back to FTS order and logs a warning when the LLM throws", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const chunks = [chunk("A", 0.9), chunk("B", 0.5)];
    generateStructuredMock.mockRejectedValueOnce(new Error("boom"));

    const out = await rerankChunks("q", chunks);
    expect(out.map((c) => c.id)).toEqual(["A", "B"]);
    expect(out.every((c) => c.rerankedByLLM === false)).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    // Error batch is also logged as an ai_call with `error` set.
    expect(logAICallMock).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: "chart-search-rerank",
        error: "boom",
        batchIndex: 0,
      })
    );
    warnSpy.mockRestore();
  });

  it("returns an empty array when given no chunks (no LLM call)", async () => {
    const out = await rerankChunks("q", []);
    expect(out).toEqual([]);
    expect(generateStructuredMock).not.toHaveBeenCalled();
  });

  it("splits 50 chunks into 3 batches (batchSize=20) and scores all of them", async () => {
    const chunks: RerankableChunk[] = Array.from({ length: 50 }, (_, i) =>
      // Give distinct FTS scores so topK selection is deterministic.
      chunk(`id-${i}`, 1 - i * 0.01)
    );

    // Build mock responses: each batch returns index→score mapping.
    // Use batchSize=20 explicitly to match reranker default.
    // topK defaults to 20, so only top 20 chunks (id-0..id-19) would be
    // reranked. Bump topK to 50 to force all 50 through.
    generateStructuredMock.mockImplementation(async () => ({
      // We can't know the batch size deterministically here; return 20 indices
      // and let the reranker only take those that map to real chunks.
      data: {
        scores: Array.from({ length: 20 }, (_, i) => ({ index: i, score: 10 - i * 0.1 })),
      },
      promptTokens: 10,
      completionTokens: 5,
    }));

    const out = await rerankChunks("q", chunks, { topK: 50, batchSize: 20 });

    // 50 chunks / 20 per batch = 3 batches (20, 20, 10).
    expect(generateStructuredMock).toHaveBeenCalledTimes(3);
    // Every output chunk is still present.
    expect(out).toHaveLength(50);
    expect(new Set(out.map((c) => c.id)).size).toBe(50);
    // Observability: 3 batches logged.
    const rerankLogs = logAICallMock.mock.calls.filter(
      (c) => c[0].feature === "chart-search-rerank" && !c[0].error
    );
    expect(rerankLogs).toHaveLength(3);
    expect(rerankLogs.map((c) => c[0].batchIndex).sort()).toEqual([0, 1, 2]);
  });

  it("respects topK — chunks beyond topK pass through without an LLM score", async () => {
    // 10 chunks but topK=3 → only top-3 by FTS get reranked; remaining 7 pass through.
    const chunks: RerankableChunk[] = Array.from({ length: 10 }, (_, i) =>
      chunk(`id-${i}`, 1 - i * 0.05)
    );
    generateStructuredMock.mockResolvedValueOnce({
      data: {
        scores: [
          { index: 0, score: 2 }, // id-0 low
          { index: 1, score: 9 }, // id-1 high
          { index: 2, score: 5 }, // id-2 mid
        ],
      },
      promptTokens: 10,
      completionTokens: 5,
    });

    const out = await rerankChunks("q", chunks, { topK: 3 });
    // Reranked chunks first (sorted by LLM score desc: id-1, id-2, id-0),
    // then pass-through chunks in FTS order (id-3, id-4, …, id-9).
    expect(out.map((c) => c.id)).toEqual([
      "id-1",
      "id-2",
      "id-0",
      "id-3",
      "id-4",
      "id-5",
      "id-6",
      "id-7",
      "id-8",
      "id-9",
    ]);
    expect(out[0].rerankedByLLM).toBe(true);
    // Beyond topK: pass-through chunks must NOT be LLM-scored.
    expect(out[3].rerankedByLLM).toBe(false);
    expect(out[9].rerankedByLLM).toBe(false);
    // Only one batch was sent (topK=3 ≤ batchSize).
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
  });

  it("applies minFtsScore filter before rerank (low-score chunks pass through)", async () => {
    // 4 chunks with scores 0.9, 0.7, 0.2, 0.1. minFtsScore=0.5 means only
    // the top 2 are eligible for reranking.
    const chunks = [
      chunk("hi-1", 0.9),
      chunk("hi-2", 0.7),
      chunk("lo-1", 0.2),
      chunk("lo-2", 0.1),
    ];
    generateStructuredMock.mockResolvedValueOnce({
      data: {
        scores: [
          { index: 0, score: 3 }, // hi-1 → low
          { index: 1, score: 8 }, // hi-2 → high
        ],
      },
      promptTokens: 10,
      completionTokens: 5,
    });

    const out = await rerankChunks("q", chunks, { minFtsScore: 0.5 });
    // hi-2 wins (LLM 8), hi-1 next (LLM 3), then lo-1, lo-2 (FTS pass-through).
    expect(out.map((c) => c.id)).toEqual(["hi-2", "hi-1", "lo-1", "lo-2"]);
    expect(out[0].rerankedByLLM).toBe(true);
    expect(out[2].rerankedByLLM).toBe(false);
    expect(out[3].rerankedByLLM).toBe(false);
    // The LLM was called with just the 2 high-score chunks.
    expect(generateStructuredMock).toHaveBeenCalledTimes(1);
  });

  it("skips the LLM entirely when enabled=false (pass-through with FTS scores)", async () => {
    const chunks = [chunk("A", 0.9), chunk("B", 0.2)];
    const out = await rerankChunks("q", chunks, { enabled: false });
    expect(generateStructuredMock).not.toHaveBeenCalled();
    expect(out.map((c) => c.id)).toEqual(["A", "B"]);
    expect(out.every((c) => c.rerankedByLLM === false)).toBe(true);
    expect(out[0].relevanceScore).toBe(0.9);
  });
});
