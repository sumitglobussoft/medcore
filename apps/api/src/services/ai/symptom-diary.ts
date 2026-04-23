import { generateStructured } from "./sarvam";
import { sanitizeUserInput } from "./prompt-safety";

export interface DiaryEntry {
  symptom: string;
  severity: number;
  notes?: string;
}

export interface DayEntry {
  symptomDate: Date;
  entries: DiaryEntry[];
}

export interface SymptomTrendInsight {
  symptom: string;
  direction: "improving" | "worsening" | "stable" | "fluctuating";
  averageSeverity: number;
  peakSeverity: number;
}

export interface SymptomAnalysisResult {
  trends: SymptomTrendInsight[];
  followUpRecommended: boolean;
  reasoning: string;
}

const SYSTEM_PROMPT =
  "You are MedCore's symptom-diary analyzer. Given 30 days of patient-logged symptoms with severity scores (1-10), produce a concise trend summary. Identify worsening vs improving symptoms. Recommend a follow-up ONLY if the data genuinely warrants it — e.g. a symptom trending up over >5 days, severity >=8 logged twice, or new symptoms appearing in the last week. Never diagnose. Keep the reasoning under 240 characters.";

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    trends: {
      type: "array",
      items: {
        type: "object",
        properties: {
          symptom: { type: "string" },
          direction: {
            type: "string",
            enum: ["improving", "worsening", "stable", "fluctuating"],
          },
          averageSeverity: { type: "number", minimum: 0, maximum: 10 },
          peakSeverity: { type: "number", minimum: 0, maximum: 10 },
        },
        required: ["symptom", "direction", "averageSeverity", "peakSeverity"],
      },
    },
    followUpRecommended: { type: "boolean" },
    reasoning: { type: "string" },
  },
  required: ["trends", "followUpRecommended", "reasoning"],
};

/**
 * Deterministic fallback computed from the raw entries when Sarvam is offline.
 * Performs a simple group-by-symptom + linear trend detection.
 */
function deterministicTrends(days: DayEntry[]): SymptomAnalysisResult {
  const bySymptom = new Map<string, { severities: number[]; dates: Date[] }>();
  for (const d of days) {
    for (const e of d.entries || []) {
      const key = e.symptom.toLowerCase().trim();
      if (!bySymptom.has(key)) {
        bySymptom.set(key, { severities: [], dates: [] });
      }
      const bucket = bySymptom.get(key)!;
      bucket.severities.push(e.severity);
      bucket.dates.push(d.symptomDate);
    }
  }

  const trends: SymptomTrendInsight[] = [];
  let followUpRecommended = false;
  const followUpReasons: string[] = [];

  for (const [symptom, bucket] of bySymptom.entries()) {
    if (bucket.severities.length === 0) continue;
    const avg =
      bucket.severities.reduce((a, b) => a + b, 0) / bucket.severities.length;
    const peak = Math.max(...bucket.severities);

    // Simple linear trend: first-half avg vs second-half avg.
    let direction: SymptomTrendInsight["direction"] = "stable";
    if (bucket.severities.length >= 3) {
      const half = Math.floor(bucket.severities.length / 2);
      const firstAvg =
        bucket.severities.slice(0, half).reduce((a, b) => a + b, 0) / half;
      const secondAvg =
        bucket.severities.slice(half).reduce((a, b) => a + b, 0) /
        (bucket.severities.length - half);
      if (secondAvg - firstAvg >= 1.5) direction = "worsening";
      else if (firstAvg - secondAvg >= 1.5) direction = "improving";
      else if (peak - Math.min(...bucket.severities) >= 4)
        direction = "fluctuating";
    }

    trends.push({
      symptom,
      direction,
      averageSeverity: Number(avg.toFixed(1)),
      peakSeverity: peak,
    });

    if (direction === "worsening" && bucket.severities.length >= 3) {
      followUpRecommended = true;
      followUpReasons.push(`${symptom} trending up`);
    }
    if (bucket.severities.filter((s) => s >= 8).length >= 2) {
      followUpRecommended = true;
      followUpReasons.push(`${symptom} severe on multiple days`);
    }
  }

  return {
    trends,
    followUpRecommended,
    reasoning:
      followUpReasons.length > 0
        ? `Follow-up suggested: ${followUpReasons.join("; ")}.`
        : "Symptoms appear stable based on the logged entries.",
  };
}

/**
 * Analyse the last 30 days of symptom-diary entries for a patient. Uses
 * Sarvam for nuanced trend narration with a deterministic fallback so the
 * mobile UI always gets a usable response.
 */
export async function analyzeSymptomTrends(
  days: DayEntry[]
): Promise<SymptomAnalysisResult> {
  if (days.length === 0) {
    return {
      trends: [],
      followUpRecommended: false,
      reasoning: "No diary entries yet — log symptoms daily to see trends.",
    };
  }

  const compact = days
    .map((d) => {
      const date = d.symptomDate instanceof Date
        ? d.symptomDate.toISOString().slice(0, 10)
        : String(d.symptomDate).slice(0, 10);
      const entries = (d.entries || [])
        .map(
          (e) =>
            `${sanitizeUserInput(e.symptom, { maxLen: 60 })}@${Math.max(1, Math.min(10, Math.round(e.severity)))}${e.notes ? ` (${sanitizeUserInput(e.notes, { maxLen: 80 })})` : ""}`
        )
        .join(", ");
      return `${date}: ${entries || "no symptoms"}`;
    })
    .join("\n");

  const userPrompt = `30-day symptom diary for one patient (symptom@severity):\n${compact}\n\nAnalyse for trends and decide whether a doctor follow-up is recommended.`;

  try {
    const { data } = await generateStructured<SymptomAnalysisResult>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      toolName: "summarize_symptom_trends",
      toolDescription:
        "Return structured trend insights and a follow-up recommendation for the provided diary.",
      parameters: TOOL_SCHEMA,
      maxTokens: 700,
      temperature: 0.2,
    });

    if (data && Array.isArray(data.trends)) {
      return {
        trends: data.trends,
        followUpRecommended: !!data.followUpRecommended,
        reasoning:
          typeof data.reasoning === "string"
            ? data.reasoning.slice(0, 240)
            : "",
      };
    }
  } catch {
    // fall through
  }

  return deterministicTrends(days);
}

// exported for unit testing
export { deterministicTrends };
