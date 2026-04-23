/**
 * AI QA on clinical documentation.
 *
 * `sampleConsultationsForQA` — randomly picks N% of recent consultations.
 * `auditConsultation` — asks Sarvam to grade completeness (SOAP sections
 * filled), ICD code accuracy, medication appropriateness, and clarity.
 *
 * Results are persisted to the `DocQAReport` model keyed by consultationId.
 * The service degrades gracefully when the model hasn't been migrated yet —
 * callers receive a structured report but persistence is skipped.
 */

import { tenantScopedPrisma as prisma } from "../tenant-prisma";
import { generateStructured } from "./sarvam";

// ─── Types ────────────────────────────────────────────────────────────────

export interface DocQAIssue {
  category: "COMPLETENESS" | "ICD" | "MEDICATION" | "CLARITY" | "OTHER";
  severity: "LOW" | "MEDIUM" | "HIGH";
  description: string;
}

export interface DocQAAuditResult {
  consultationId: string;
  score: number; // 0-100
  completenessScore: number;
  icdAccuracyScore: number;
  medicationScore: number;
  clarityScore: number;
  issues: DocQAIssue[];
  recommendations: string[];
  auditedAt: string;
}

export interface ConsultationSample {
  id: string;
  doctorId: string;
  createdAt: Date;
}

// ─── Sampling ─────────────────────────────────────────────────────────────

/**
 * Pick a random sample of consultations from the last `windowDays` days,
 * sized by `samplePct` (percent of available consultations). Returns an
 * empty array when no consultations are in scope.
 */
export async function sampleConsultationsForQA(opts?: {
  samplePct?: number;
  windowDays?: number;
  max?: number;
}): Promise<ConsultationSample[]> {
  const samplePct = Math.max(1, Math.min(100, opts?.samplePct ?? 10));
  const windowDays = Math.max(1, Math.min(90, opts?.windowDays ?? 7));
  const max = Math.max(1, Math.min(500, opts?.max ?? 200));

  const since = new Date();
  since.setDate(since.getDate() - windowDays);

  const rows = await prisma.consultation.findMany({
    where: { createdAt: { gte: since } },
    select: { id: true, doctorId: true, createdAt: true },
    take: 5000,
  });

  if (rows.length === 0) return [];

  const targetCount = Math.max(1, Math.ceil((rows.length * samplePct) / 100));
  const picks = new Set<number>();
  while (picks.size < Math.min(targetCount, rows.length, max)) {
    picks.add(Math.floor(Math.random() * rows.length));
  }
  return Array.from(picks).map((i) => rows[i]);
}

// ─── Audit ────────────────────────────────────────────────────────────────

/**
 * Run an AI-graded audit on a single consultation. Fetches the associated
 * prescription (for ICD / medication context) and asks Sarvam to emit a
 * structured QA report. Falls back to a deterministic heuristic report when
 * Sarvam is unreachable so the pipeline never leaves a sampled consultation
 * ungraded.
 */
export async function auditConsultation(consultationId: string): Promise<DocQAAuditResult | null> {
  const consultation = await prisma.consultation.findUnique({
    where: { id: consultationId },
    include: {
      appointment: {
        include: {
          prescription: { include: { items: true } },
        },
      },
    },
  });

  if (!consultation) return null;

  const prescription = consultation.appointment?.prescription;
  const notes = consultation.notes ?? "";
  const findings = consultation.findings ?? "";
  const diagnosis = prescription?.diagnosis ?? "";
  const advice = prescription?.advice ?? "";
  const meds = (prescription?.items ?? []).map(
    (i) => `${i.medicineName} ${i.dosage} ${i.frequency} x${i.duration}`
  );

  const payload = {
    notes,
    findings,
    diagnosis,
    advice,
    medications: meds,
  };

  // ── LLM grading ────────────────────────────────────────────────────────
  try {
    const { data } = await generateStructured<{
      score: number;
      completenessScore: number;
      icdAccuracyScore: number;
      medicationScore: number;
      clarityScore: number;
      issues: DocQAIssue[];
      recommendations: string[];
    }>({
      systemPrompt:
        "You are a senior physician auditor grading consultation notes for clinical documentation quality. Grade each consultation on four axes: COMPLETENESS (are SOAP sections present and populated?), ICD (is the working diagnosis specific and codeable?), MEDICATION (are prescriptions appropriate for the diagnosis?), CLARITY (is the note legible and actionable?). Scores are 0-100. Return strictly via the tool. Never invent facts not present in the input.",
      userPrompt: JSON.stringify(payload),
      toolName: "emit_doc_qa_report",
      toolDescription: "Emit structured QA report for one consultation",
      parameters: {
        type: "object",
        properties: {
          score: { type: "number", minimum: 0, maximum: 100 },
          completenessScore: { type: "number", minimum: 0, maximum: 100 },
          icdAccuracyScore: { type: "number", minimum: 0, maximum: 100 },
          medicationScore: { type: "number", minimum: 0, maximum: 100 },
          clarityScore: { type: "number", minimum: 0, maximum: 100 },
          issues: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: {
                  type: "string",
                  enum: ["COMPLETENESS", "ICD", "MEDICATION", "CLARITY", "OTHER"],
                },
                severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
                description: { type: "string" },
              },
              required: ["category", "severity", "description"],
            },
          },
          recommendations: { type: "array", items: { type: "string" } },
        },
        required: [
          "score",
          "completenessScore",
          "icdAccuracyScore",
          "medicationScore",
          "clarityScore",
          "issues",
          "recommendations",
        ],
      },
      maxTokens: 1024,
      temperature: 0.1,
    });
    if (data) {
      const report: DocQAAuditResult = {
        consultationId,
        score: Math.round(data.score),
        completenessScore: Math.round(data.completenessScore),
        icdAccuracyScore: Math.round(data.icdAccuracyScore),
        medicationScore: Math.round(data.medicationScore),
        clarityScore: Math.round(data.clarityScore),
        issues: data.issues ?? [],
        recommendations: data.recommendations ?? [],
        auditedAt: new Date().toISOString(),
      };
      await persistReport(report);
      return report;
    }
  } catch (err) {
    console.warn(
      "[doc-qa] LLM grading failed, falling back to heuristic",
      (err as Error).message
    );
  }

  // ── Heuristic fallback (when LLM unavailable) ─────────────────────────
  const heuristic = heuristicGrade(payload);
  const report: DocQAAuditResult = {
    consultationId,
    ...heuristic,
    auditedAt: new Date().toISOString(),
  };
  await persistReport(report);
  return report;
}

function heuristicGrade(p: {
  notes: string;
  findings: string;
  diagnosis: string;
  advice: string;
  medications: string[];
}): Omit<DocQAAuditResult, "consultationId" | "auditedAt"> {
  const completenessScore =
    (p.notes ? 25 : 0) + (p.findings ? 25 : 0) + (p.diagnosis ? 25 : 0) + (p.advice ? 25 : 0);
  const icdAccuracyScore = p.diagnosis && p.diagnosis.length > 5 ? 70 : 30;
  const medicationScore = p.medications.length > 0 ? 70 : 40;
  const clarityScore = p.notes.length > 40 ? 80 : 50;
  const score = Math.round(
    (completenessScore + icdAccuracyScore + medicationScore + clarityScore) / 4
  );
  const issues: DocQAIssue[] = [];
  if (!p.notes) issues.push({ category: "COMPLETENESS", severity: "HIGH", description: "Notes section is empty" });
  if (!p.diagnosis) issues.push({ category: "ICD", severity: "HIGH", description: "Diagnosis missing" });
  if (!p.medications.length && p.diagnosis)
    issues.push({
      category: "MEDICATION",
      severity: "MEDIUM",
      description: "No medications charted despite a diagnosis",
    });
  return {
    score,
    completenessScore,
    icdAccuracyScore,
    medicationScore,
    clarityScore,
    issues,
    recommendations: issues.length
      ? issues.map((i) => `Address ${i.category.toLowerCase()} gap: ${i.description}`)
      : ["Documentation meets baseline — no immediate action required."],
  };
}

async function persistReport(report: DocQAAuditResult): Promise<void> {
  const delegate = (prisma as unknown as { docQAReport?: any }).docQAReport;
  if (!delegate?.upsert) {
    console.warn("[doc-qa] DocQAReport model not present; skipping persist");
    return;
  }
  try {
    await delegate.upsert({
      where: { consultationId: report.consultationId },
      create: {
        consultationId: report.consultationId,
        score: report.score,
        issues: report.issues,
        recommendations: report.recommendations,
        completenessScore: report.completenessScore,
        icdAccuracyScore: report.icdAccuracyScore,
        medicationScore: report.medicationScore,
        clarityScore: report.clarityScore,
        auditedBy: "SYSTEM",
      },
      update: {
        score: report.score,
        issues: report.issues,
        recommendations: report.recommendations,
        completenessScore: report.completenessScore,
        icdAccuracyScore: report.icdAccuracyScore,
        medicationScore: report.medicationScore,
        clarityScore: report.clarityScore,
        auditedAt: new Date(),
      },
    });
  } catch (err) {
    console.error("[doc-qa] persist failed", (err as Error).message);
  }
}

// ─── Batch runner for the daily scheduler ─────────────────────────────────

export async function runDailyDocQASample(opts?: {
  samplePct?: number;
  windowDays?: number;
}): Promise<{ sampled: number; audited: number }> {
  const samples = await sampleConsultationsForQA({
    samplePct: opts?.samplePct ?? 10,
    windowDays: opts?.windowDays ?? 1,
  });
  let audited = 0;
  for (const s of samples) {
    const r = await auditConsultation(s.id).catch((e) => {
      console.error("[doc-qa] audit failed", s.id, e);
      return null;
    });
    if (r) audited += 1;
  }
  return { sampled: samples.length, audited };
}
