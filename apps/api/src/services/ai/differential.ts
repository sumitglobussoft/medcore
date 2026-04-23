// AI-assisted Differential Diagnosis & Clinical Decision Support (PRD §7.2).
//
// Given a chief complaint (plus optional vitals, relevant history, allergies,
// chronic conditions, current meds), this service produces a ranked list of
// plausible differentials with ICD-10 codes, recommended investigations, and
// red flags that would upgrade urgency. It uses the shared Sarvam client via
// `generateStructured` to enforce a strict output shape via tool calling.
//
// Ephemeral — nothing is persisted by default. Callers can audit-log the
// invocation for PHI access tracking.

import { generateStructured, logAICall } from "./sarvam";
import { sanitizeUserInput } from "./prompt-safety";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DifferentialItem {
  diagnosis: string;
  icd10?: string;
  probability: "high" | "medium" | "low";
  reasoning: string;
  recommendedTests: string[];
  redFlags: string[];
}

export interface DifferentialResult {
  differentials: DifferentialItem[];
  guidelineReferences: string[];
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a clinical decision-support assistant for licensed
physicians. Given a chief complaint, vitals, and known patient context, produce a
differential diagnosis list ranked by likelihood.

Rules:
- Return 3 to 6 differentials, most likely first.
- For each, provide a short clinical reasoning (1-2 sentences), ICD-10 code when
  confident, recommended investigations to confirm/rule out, and red-flag
  findings that would raise urgency.
- Cite guideline references (e.g. "NICE CG95", "ICMR 2023", "ACEP 2024")
  when relevant; leave the list empty if uncertain rather than fabricating.
- Never diagnose — label your output as suggestions for the treating clinician.
- Factor in the patient's allergies and chronic conditions when suggesting
  investigations.`;

// ── analyzeDifferential ───────────────────────────────────────────────────────

/**
 * Produce a differential-diagnosis assessment for a physician to review.
 *
 * Returns a structured list of candidate diagnoses with probability bands,
 * recommended tests, and red flags. Does NOT persist anything.
 */
export async function analyzeDifferential(opts: {
  chiefComplaint: string;
  vitals?: Record<string, unknown>;
  relevantHistory?: string;
  allergies?: string[];
  chronicConditions?: string[];
  currentMedications?: string[];
  age?: number;
  gender?: string;
}): Promise<DifferentialResult> {
  const safeComplaint = sanitizeUserInput(opts.chiefComplaint, { maxLen: 1000 });
  const safeHistory = opts.relevantHistory
    ? sanitizeUserInput(opts.relevantHistory, { maxLen: 2000 })
    : "";

  const vitalsText = opts.vitals
    ? Object.entries(opts.vitals)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ")
    : "not provided";

  const userPrompt = `
Patient Context:
- Age: ${opts.age ?? "unknown"}
- Gender: ${opts.gender ?? "unknown"}
- Known Allergies: ${(opts.allergies ?? []).join(", ") || "none documented"}
- Chronic Conditions: ${(opts.chronicConditions ?? []).join(", ") || "none documented"}
- Current Medications: ${(opts.currentMedications ?? []).join(", ") || "none documented"}

Chief Complaint:
${safeComplaint}

Vitals: ${vitalsText}

Relevant History:
${safeHistory || "none provided"}

Produce a ranked differential diagnosis with recommended tests, red flags, and
ICD-10 codes where confident.`;

  const t0 = Date.now();
  try {
    const { data, promptTokens, completionTokens } =
      await generateStructured<DifferentialResult>({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        toolName: "emit_differentials",
        toolDescription:
          "Emit a ranked differential diagnosis list with reasoning, tests, red flags, and guideline references.",
        parameters: {
          type: "object",
          properties: {
            differentials: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  diagnosis: { type: "string" },
                  icd10: { type: "string" },
                  probability: { type: "string", enum: ["high", "medium", "low"] },
                  reasoning: { type: "string" },
                  recommendedTests: { type: "array", items: { type: "string" } },
                  redFlags: { type: "array", items: { type: "string" } },
                },
                required: ["diagnosis", "probability", "reasoning", "recommendedTests", "redFlags"],
              },
            },
            guidelineReferences: { type: "array", items: { type: "string" } },
          },
          required: ["differentials", "guidelineReferences"],
        },
        maxTokens: 2048,
        temperature: 0.2,
      });

    logAICall({
      feature: "scribe",
      model: "sarvam-105b",
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - t0,
      toolUsed: "emit_differentials",
    });

    if (!data) {
      return { differentials: [], guidelineReferences: [] };
    }
    // Normalise in case the model omits optional arrays
    const differentials = (data.differentials ?? []).map((d) => ({
      diagnosis: d.diagnosis,
      icd10: d.icd10,
      probability: (["high", "medium", "low"].includes(d.probability) ? d.probability : "low") as DifferentialItem["probability"],
      reasoning: d.reasoning ?? "",
      recommendedTests: Array.isArray(d.recommendedTests) ? d.recommendedTests : [],
      redFlags: Array.isArray(d.redFlags) ? d.redFlags : [],
    }));
    return {
      differentials,
      guidelineReferences: Array.isArray(data.guidelineReferences) ? data.guidelineReferences : [],
    };
  } catch (err) {
    logAICall({
      feature: "scribe",
      model: "sarvam-105b",
      promptTokens: 0,
      completionTokens: 0,
      latencyMs: Date.now() - t0,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
