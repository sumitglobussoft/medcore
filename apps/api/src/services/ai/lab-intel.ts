// Lab Result Intelligence (PRD §7.2 upgrade).
//
// Given a LabResult id, produce an AI-assisted contextual interpretation that
// goes beyond the existing panic-value + delta checks: it factors in the
// patient's last 5 results for the same parameter, chronic conditions, and
// current medications. Output is consumed by the clinician-facing lab review
// page and optionally persisted back onto the LabResult (once the schema
// columns proposed in services/.prisma-models-doctor-tools.md land).

import { tenantScopedPrisma as prisma } from "../tenant-prisma";
import { generateStructured, logAICall } from "./sarvam";
import { sanitizeUserInput } from "./prompt-safety";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LabTrend = "improving" | "stable" | "worsening" | "unknown";
export type LabUrgency = "routine" | "soon" | "urgent";

export interface LabIntelResult {
  interpretation: string;
  trend: LabTrend;
  baselineComparison: string;
  recommendedActions: string[];
  urgency: LabUrgency;
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a clinical lab-result interpretation assistant.
Given a lab parameter's current value, the patient's history for that same
parameter, chronic conditions, and current medications, produce:
- A concise interpretation (2-3 sentences).
- A trend label: "improving", "stable", "worsening", or "unknown".
- A baseline comparison against the patient's prior results.
- 2-5 recommended actions for the treating clinician.
- An urgency level: "routine", "soon", or "urgent".

Rules:
- Base trend on numeric trajectory when possible.
- Never invent prior values; say "unknown" if history is empty.
- Consider drug-lab interactions (e.g. statins with LFTs, ACE-i with K+).
- Output decisions as clinician suggestions, not diagnoses.`;

// ── analyzeLabResult ──────────────────────────────────────────────────────────

export async function analyzeLabResult(labResultId: string): Promise<LabIntelResult> {
  const result = await prisma.labResult.findUnique({
    where: { id: labResultId },
    include: {
      orderItem: {
        include: {
          order: {
            include: {
              patient: {
                include: {
                  chronicConditions: { select: { condition: true } },
                  prescriptions: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                    include: { items: { select: { medicineName: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!result) {
    throw Object.assign(new Error("LabResult not found"), { statusCode: 404 });
  }

  const patient = result.orderItem.order.patient;

  // Pull the last 5 results for the SAME parameter for this patient.
  const history = await prisma.labResult.findMany({
    where: {
      parameter: result.parameter,
      orderItem: {
        order: {
          patientId: patient.id,
        },
      },
      id: { not: labResultId },
    },
    orderBy: { reportedAt: "desc" },
    take: 5,
    select: {
      value: true,
      unit: true,
      flag: true,
      reportedAt: true,
    },
  });

  const chronicList = patient.chronicConditions.map((c: any) => c.condition);
  const medList = patient.prescriptions[0]?.items.map((i: any) => i.medicineName) ?? [];

  const historyText =
    history.length === 0
      ? "No prior results for this parameter."
      : history
          .map(
            (h: any, i: number) =>
              `${i + 1}. ${new Date(h.reportedAt).toISOString().slice(0, 10)}: ${h.value}${h.unit ? " " + h.unit : ""} [${h.flag}]`
          )
          .join("\n");

  const userPrompt = `
Parameter: ${sanitizeUserInput(result.parameter, { maxLen: 80 })}
Current Value: ${sanitizeUserInput(result.value, { maxLen: 80 })}${result.unit ? " " + result.unit : ""}
Normal Range: ${result.normalRange ?? "not provided"}
Flag: ${result.flag}
Reported: ${new Date(result.reportedAt).toISOString().slice(0, 10)}

Patient Chronic Conditions: ${chronicList.join(", ") || "none documented"}
Patient Current Medications: ${medList.join(", ") || "none documented"}

Prior Results (most recent first):
${historyText}

Produce the contextual interpretation.`;

  const t0 = Date.now();
  try {
    const { data, promptTokens, completionTokens } = await generateStructured<LabIntelResult>({
      systemPrompt: SYSTEM_PROMPT,
      userPrompt,
      toolName: "emit_lab_intel",
      toolDescription: "Emit a contextual lab-result interpretation with trend, baseline comparison, recommended actions, and urgency.",
      parameters: {
        type: "object",
        properties: {
          interpretation: { type: "string" },
          trend: { type: "string", enum: ["improving", "stable", "worsening", "unknown"] },
          baselineComparison: { type: "string" },
          recommendedActions: { type: "array", items: { type: "string" } },
          urgency: { type: "string", enum: ["routine", "soon", "urgent"] },
        },
        required: ["interpretation", "trend", "baselineComparison", "recommendedActions", "urgency"],
      },
      maxTokens: 1024,
      temperature: 0.1,
    });

    logAICall({
      feature: "scribe",
      model: "sarvam-105b",
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - t0,
      toolUsed: "emit_lab_intel",
    });

    if (!data) {
      return {
        interpretation: "AI interpretation unavailable.",
        trend: "unknown",
        baselineComparison: history.length ? "Prior results exist but no trajectory could be computed." : "No prior results.",
        recommendedActions: [],
        urgency: "routine",
      };
    }

    return {
      interpretation: data.interpretation ?? "",
      trend: (["improving", "stable", "worsening", "unknown"].includes(data.trend) ? data.trend : "unknown") as LabTrend,
      baselineComparison: data.baselineComparison ?? "",
      recommendedActions: Array.isArray(data.recommendedActions) ? data.recommendedActions : [],
      urgency: (["routine", "soon", "urgent"].includes(data.urgency) ? data.urgency : "routine") as LabUrgency,
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
