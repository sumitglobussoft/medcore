/**
 * Patient-voice sentiment analytics (LLM-powered upgrade of the existing
 * keyword-based `analyzeSentiment` helper in services/ops-helpers.ts).
 *
 * Two public entrypoints:
 *   - `analyzeFeedback(feedbackId)` — grades a single `PatientFeedback` row
 *     via Sarvam and persists the result to `FeedbackSentiment` (or returns
 *     the structured analysis if the model hasn't been migrated).
 *   - `summarizeNpsDrivers({ windowDays })` — aggregates all recent feedback
 *     and asks Sarvam to extract top positive themes, top negative themes
 *     and actionable insights. Persists a daily snapshot to `NpsDailyRollup`.
 */

import { tenantScopedPrisma as prisma } from "../tenant-prisma";
import { generateStructured } from "./sarvam";

// ─── Types ────────────────────────────────────────────────────────────────

export type SentimentBucket = "positive" | "neutral" | "negative";

export interface FeedbackSentimentResult {
  feedbackId: string;
  sentiment: SentimentBucket;
  emotions: string[];
  themes: string[];
  actionableItems: string[];
  analyzedAt: string;
}

export interface NpsDriverTheme {
  theme: string;
  count: number;
  sampleQuotes: string[];
}

export interface NpsDriversSummary {
  windowDays: number;
  totalFeedback: number;
  positiveThemes: NpsDriverTheme[];
  negativeThemes: NpsDriverTheme[];
  actionableInsights: string[];
  generatedAt: string;
}

// ─── Per-feedback analysis ────────────────────────────────────────────────

export async function analyzeFeedback(
  feedbackId: string
): Promise<FeedbackSentimentResult | null> {
  const feedback = await prisma.patientFeedback.findUnique({
    where: { id: feedbackId },
    select: { id: true, comment: true, rating: true, nps: true, category: true },
  });
  if (!feedback) return null;

  const text = (feedback.comment ?? "").trim();
  if (!text) {
    // Nothing to analyze — derive bucket from rating as a floor.
    const bucket: SentimentBucket =
      feedback.rating >= 4 ? "positive" : feedback.rating <= 2 ? "negative" : "neutral";
    const result: FeedbackSentimentResult = {
      feedbackId,
      sentiment: bucket,
      emotions: [],
      themes: [],
      actionableItems: [],
      analyzedAt: new Date().toISOString(),
    };
    await persistFeedbackSentiment(result);
    return result;
  }

  try {
    const { data } = await generateStructured<{
      sentiment: SentimentBucket;
      emotions: string[];
      themes: string[];
      actionableItems: string[];
    }>({
      systemPrompt:
        "You are a patient-experience analyst. Given a single patient feedback comment, classify its overall sentiment, extract up to 5 distinct emotions (e.g. 'frustration', 'gratitude'), up to 5 topical themes (e.g. 'wait time', 'nurse care', 'billing'), and up to 3 short actionable items a hospital manager could implement. Return strictly via the tool. Never invent details not implied by the text.",
      userPrompt: JSON.stringify({
        comment: text,
        rating: feedback.rating,
        category: feedback.category,
        nps: feedback.nps,
      }),
      toolName: "emit_feedback_sentiment",
      toolDescription: "Structured sentiment + theme extraction for one feedback entry",
      parameters: {
        type: "object",
        properties: {
          sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          emotions: { type: "array", items: { type: "string" } },
          themes: { type: "array", items: { type: "string" } },
          actionableItems: { type: "array", items: { type: "string" } },
        },
        required: ["sentiment", "emotions", "themes", "actionableItems"],
      },
      maxTokens: 512,
      temperature: 0.1,
    });
    if (data) {
      const result: FeedbackSentimentResult = {
        feedbackId,
        sentiment: data.sentiment,
        emotions: data.emotions ?? [],
        themes: data.themes ?? [],
        actionableItems: data.actionableItems ?? [],
        analyzedAt: new Date().toISOString(),
      };
      await persistFeedbackSentiment(result);
      return result;
    }
  } catch (err) {
    console.warn("[sentiment-ai] LLM analysis failed", (err as Error).message);
  }

  // Heuristic fallback — derive bucket from rating + simple keyword hits
  const lower = text.toLowerCase();
  const negWords = ["bad", "rude", "dirty", "wait", "late", "expensive", "worst", "terrible", "slow"];
  const posWords = ["great", "excellent", "thank", "kind", "friendly", "clean", "fast", "caring"];
  const negHits = negWords.filter((w) => lower.includes(w));
  const posHits = posWords.filter((w) => lower.includes(w));
  let bucket: SentimentBucket = "neutral";
  if (posHits.length > negHits.length && feedback.rating >= 3) bucket = "positive";
  else if (negHits.length > posHits.length || feedback.rating <= 2) bucket = "negative";

  const result: FeedbackSentimentResult = {
    feedbackId,
    sentiment: bucket,
    emotions: [],
    themes: [...new Set([...posHits, ...negHits])],
    actionableItems: negHits.length ? [`Investigate recurring complaint: ${negHits[0]}`] : [],
    analyzedAt: new Date().toISOString(),
  };
  await persistFeedbackSentiment(result);
  return result;
}

async function persistFeedbackSentiment(r: FeedbackSentimentResult): Promise<void> {
  const delegate = (prisma as unknown as { feedbackSentiment?: any }).feedbackSentiment;
  if (!delegate?.upsert) {
    console.warn("[sentiment-ai] FeedbackSentiment model not present; skipping persist");
    return;
  }
  try {
    await delegate.upsert({
      where: { feedbackId: r.feedbackId },
      create: {
        feedbackId: r.feedbackId,
        sentiment: r.sentiment,
        emotions: r.emotions,
        themes: r.themes,
        actionableItems: r.actionableItems,
      },
      update: {
        sentiment: r.sentiment,
        emotions: r.emotions,
        themes: r.themes,
        actionableItems: r.actionableItems,
        analyzedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[sentiment-ai] persist failed", (err as Error).message);
  }
}

// ─── Aggregated NPS drivers (daily rollup) ────────────────────────────────

export async function summarizeNpsDrivers(opts?: {
  windowDays?: number;
}): Promise<NpsDriversSummary> {
  const windowDays = Math.max(1, Math.min(365, opts?.windowDays ?? 30));
  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const feedback = await prisma.patientFeedback.findMany({
    where: { submittedAt: { gte: since }, comment: { not: null } },
    select: { id: true, comment: true, rating: true, nps: true, category: true },
    take: 2000,
  });

  const payload = feedback
    .map((f) => ({
      rating: f.rating,
      nps: f.nps ?? null,
      category: f.category,
      comment: (f.comment ?? "").slice(0, 500),
    }))
    .slice(0, 400); // keep prompt bounded

  // Empty case — skip LLM
  if (payload.length === 0) {
    const summary: NpsDriversSummary = {
      windowDays,
      totalFeedback: 0,
      positiveThemes: [],
      negativeThemes: [],
      actionableInsights: [],
      generatedAt: new Date().toISOString(),
    };
    await persistNpsRollup(summary);
    return summary;
  }

  try {
    const { data } = await generateStructured<{
      positiveThemes: NpsDriverTheme[];
      negativeThemes: NpsDriverTheme[];
      actionableInsights: string[];
    }>({
      systemPrompt:
        "You are a patient-experience analyst reading hospital feedback. Given a JSON array of recent patient feedback entries, extract the top 5 positive NPS drivers, top 5 negative NPS drivers, and up to 5 concrete actionable insights management should act on this week. For each theme include the approximate count (you may estimate) and 1-2 representative short sample quotes. Return strictly via the tool.",
      userPrompt: JSON.stringify(payload),
      toolName: "emit_nps_drivers",
      toolDescription: "Structured NPS driver aggregation",
      parameters: {
        type: "object",
        properties: {
          positiveThemes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                theme: { type: "string" },
                count: { type: "number" },
                sampleQuotes: { type: "array", items: { type: "string" } },
              },
              required: ["theme", "count", "sampleQuotes"],
            },
          },
          negativeThemes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                theme: { type: "string" },
                count: { type: "number" },
                sampleQuotes: { type: "array", items: { type: "string" } },
              },
              required: ["theme", "count", "sampleQuotes"],
            },
          },
          actionableInsights: { type: "array", items: { type: "string" } },
        },
        required: ["positiveThemes", "negativeThemes", "actionableInsights"],
      },
      maxTokens: 1500,
      temperature: 0.2,
    });
    if (data) {
      const summary: NpsDriversSummary = {
        windowDays,
        totalFeedback: feedback.length,
        positiveThemes: data.positiveThemes ?? [],
        negativeThemes: data.negativeThemes ?? [],
        actionableInsights: data.actionableInsights ?? [],
        generatedAt: new Date().toISOString(),
      };
      await persistNpsRollup(summary);
      return summary;
    }
  } catch (err) {
    console.warn("[sentiment-ai] LLM summarisation failed", (err as Error).message);
  }

  // Heuristic fallback — split by rating, surface category counts as themes
  const positives = feedback.filter((f) => f.rating >= 4);
  const negatives = feedback.filter((f) => f.rating <= 2);
  const catCount = (rows: typeof feedback): NpsDriverTheme[] => {
    const m = new Map<string, { count: number; samples: string[] }>();
    for (const r of rows) {
      const e = m.get(r.category) ?? { count: 0, samples: [] };
      e.count += 1;
      if (e.samples.length < 2 && r.comment) e.samples.push(r.comment.slice(0, 120));
      m.set(r.category, e);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([theme, v]) => ({ theme, count: v.count, sampleQuotes: v.samples }));
  };
  const summary: NpsDriversSummary = {
    windowDays,
    totalFeedback: feedback.length,
    positiveThemes: catCount(positives),
    negativeThemes: catCount(negatives),
    actionableInsights: negatives.length
      ? [`${negatives.length} low-rating feedback entries in the last ${windowDays} days — review top negative themes above.`]
      : [`No low-rating feedback in the last ${windowDays} days.`],
    generatedAt: new Date().toISOString(),
  };
  await persistNpsRollup(summary);
  return summary;
}

async function persistNpsRollup(s: NpsDriversSummary): Promise<void> {
  const delegate = (prisma as unknown as { npsDailyRollup?: any }).npsDailyRollup;
  if (!delegate?.upsert) {
    console.warn("[sentiment-ai] NpsDailyRollup model not present; skipping persist");
    return;
  }
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await delegate.upsert({
      where: { date: today },
      create: {
        date: today,
        windowDays: s.windowDays,
        positiveThemes: s.positiveThemes,
        negativeThemes: s.negativeThemes,
        actionableInsights: s.actionableInsights,
        totalFeedback: s.totalFeedback,
      },
      update: {
        windowDays: s.windowDays,
        positiveThemes: s.positiveThemes,
        negativeThemes: s.negativeThemes,
        actionableInsights: s.actionableInsights,
        totalFeedback: s.totalFeedback,
        generatedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[sentiment-ai] rollup persist failed", (err as Error).message);
  }
}

// ─── Fire-and-forget hook called on feedback create ───────────────────────

export function triggerFeedbackAnalysis(feedbackId: string): void {
  // Explicit fire-and-forget — never block the submitter's request.
  analyzeFeedback(feedbackId).catch((err) => {
    console.warn("[sentiment-ai] fire-and-forget analyze failed", (err as Error).message);
  });
}
