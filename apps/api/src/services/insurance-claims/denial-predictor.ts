// Revenue-cycle AI — denial-risk pre-check (PRD §7.3).
//
// Runs a deterministic rule engine against a claim row plus an optional
// Sarvam-backed qualitative risk layer. The rule engine is the source of
// truth — the LLM only ever upgrades (never downgrades) risk so a model
// outage cannot silently pass a claim that the rules would have flagged.
//
// Output is shaped for both the REST endpoint (`GET /:claimId/denial-risk`)
// and the inline pre-submission guard (the existing `POST /claims` handler
// calls `predictDenialRisk` and short-circuits with 422 on "high" risk).

import { prisma } from "@medcore/db";
import type { InsuranceClaimRow } from "./store";
import { getClaim, updateClaim } from "./store";
import { generateStructured } from "../ai/sarvam";

export type DenialRiskLevel = "low" | "medium" | "high";

/** Individual fix the auto-fix endpoint can apply. */
export type SuggestedFixOp =
  | { type: "ADD_ICD_FROM_SOAP"; codes: string[] }
  | { type: "ROUND_AMOUNT_TO_INR"; from: number; to: number }
  | { type: "ADD_PROCEDURE_FROM_SOAP"; procedureName: string }
  | { type: "TRIM_DIAGNOSIS_WHITESPACE" };

export interface DenialRiskReport {
  risk: DenialRiskLevel;
  reasons: string[];
  suggestedFixes: string[];
  /** Machine-readable ops the auto-fix endpoint can replay. */
  fixOps: SuggestedFixOp[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** ICD-10 loose pattern: a letter + 2 digits, optional . + 1-2 chars. */
function looksLikeIcd10(code: string): boolean {
  return /^[A-Z]\d{2}(\.[A-Z0-9]{1,4})?$/i.test(code.trim());
}

/** Round 2-decimal INR. Banks/TPAs reject claims with 3+ decimals. */
function roundInr(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Rule engine ──────────────────────────────────────────────────────────────

interface RuleContext {
  claim: InsuranceClaimRow;
  // Optional: latest SOAP ICD codes + procedures fetched from the scribe so
  // auto-fix can propose additions straight from the source of truth.
  scribeIcdCodes?: string[];
  scribeProcedures?: string[];
  invoiceTotal?: number;
}

function runRules(ctx: RuleContext): DenialRiskReport {
  const { claim, scribeIcdCodes = [], invoiceTotal } = ctx;
  const reasons: string[] = [];
  const suggestedFixes: string[] = [];
  const fixOps: SuggestedFixOp[] = [];
  let level: DenialRiskLevel = "low";

  // ── Rule 1: ICD-10 missing or invalid ──────────────────────────────────────
  // Missing ICD is a strong TPA rejection signal, but many hospitals still
  // submit claims with ICD on the attached discharge summary rather than the
  // claim header — so we start at medium and only escalate to high when we
  // ALSO have scribe ICD codes available (meaning the data was right there
  // and the caller forgot to attach it).
  const icds = claim.icd10Codes ?? [];
  if (icds.length === 0) {
    if (scribeIcdCodes.length > 0) {
      level = "high";
      reasons.push(
        "No ICD-10 codes on the claim even though the AI Scribe session has them — TPA will reject."
      );
      suggestedFixes.push(
        `Add ICD-10 codes from the AI Scribe session: ${scribeIcdCodes.join(", ")}`
      );
      fixOps.push({ type: "ADD_ICD_FROM_SOAP", codes: scribeIcdCodes });
    } else {
      level = worse(level, "medium");
      reasons.push("No ICD-10 codes on the claim — TPA may query.");
      suggestedFixes.push("Manually enter at least one ICD-10 code matching the diagnosis.");
    }
  } else {
    const invalid = icds.filter((c) => !looksLikeIcd10(c));
    if (invalid.length > 0) {
      level = worse(level, "medium");
      reasons.push(
        `ICD-10 codes fail the format check: ${invalid.join(", ")}. Expected e.g. "J06.9".`
      );
      suggestedFixes.push(
        "Replace or remove the malformed ICD-10 codes before submission."
      );
    }
  }

  // ── Rule 2: amount vs. invoice total (rounding / mismatch) ────────────────
  if (typeof invoiceTotal === "number" && invoiceTotal > 0) {
    const rounded = roundInr(claim.amountClaimed);
    if (rounded !== claim.amountClaimed) {
      level = worse(level, "medium");
      reasons.push(
        `amountClaimed=${claim.amountClaimed} has more than 2 decimals — TPA portals reject this.`
      );
      suggestedFixes.push(`Round amountClaimed to ${rounded}.`);
      fixOps.push({
        type: "ROUND_AMOUNT_TO_INR",
        from: claim.amountClaimed,
        to: rounded,
      });
    }

    // Heuristic sum-insured check — flag if the hospital is claiming an
    // amount WILDLY out of line with the underlying invoice (e.g. extra
    // zero from a data-entry mistake). We tolerate up to 3x the invoice
    // total because IPD pre-authorization + add-on services legitimately
    // push claim totals above the OPD invoice; only a 3x+ gap is almost
    // always a clerical error or policy-limit breach.
    if (claim.amountClaimed > invoiceTotal * 3) {
      level = worse(level, "high");
      reasons.push(
        `amountClaimed (${claim.amountClaimed}) is more than 3x the invoice total (${invoiceTotal}) — likely a data-entry error or policy-limit breach.`
      );
      suggestedFixes.push(
        `Cap amountClaimed to the invoice total (${invoiceTotal}) or the applicable sum-insured.`
      );
    } else if (claim.amountClaimed > invoiceTotal * 1.25) {
      // Softer heuristic — flag for manual review but don't block.
      level = worse(level, "medium");
      reasons.push(
        `amountClaimed (${claim.amountClaimed}) exceeds invoice total (${invoiceTotal}) by more than 25% — verify applicable package/add-on before submission.`
      );
    }
  }

  // ── Rule 3: diagnosis vs. procedure mismatch ──────────────────────────────
  if (claim.procedureName && claim.diagnosis) {
    const dxLower = claim.diagnosis.toLowerCase();
    const procLower = claim.procedureName.toLowerCase();
    // Very shallow overlap check: surface mismatch only when diagnosis and
    // procedure share zero keyword tokens above 4 chars. TPAs reject
    // "Appendicitis → Coronary bypass" style mismatches hard.
    const dxTokens = dxLower.split(/\W+/).filter((t) => t.length >= 4);
    const procTokens = new Set(procLower.split(/\W+/).filter((t) => t.length >= 4));
    const overlap = dxTokens.some((t) => procTokens.has(t));
    if (!overlap && dxTokens.length > 0 && procTokens.size > 0) {
      level = worse(level, "medium");
      reasons.push(
        `Diagnosis "${claim.diagnosis}" shares no keywords with procedure "${claim.procedureName}" — TPA may query for clinical justification.`
      );
      suggestedFixes.push(
        "Confirm the procedure is clinically indicated for the diagnosis; attach physician notes."
      );
    }
  }

  // ── Rule 4: missing documents for IPD claims ──────────────────────────────
  // IPD heuristic: both admission and discharge dates set.
  if (claim.admissionDate && claim.dischargeDate) {
    suggestedFixes.push(
      "IPD claim detected — attach DISCHARGE_SUMMARY and INVESTIGATION_REPORT before submission."
    );
    // Don't raise to "medium" on this alone; docs arrive via a separate call.
  }

  // ── Rule 5: TPA-specific edge cases (documented TODOs) ─────────────────────
  switch (claim.tpaProvider) {
    case "MEDI_ASSIST":
      // TODO(ai-claims): Medi Assist rejects claims where the policyNumber
      // contains whitespace or mixed case. Enforce `trim().toUpperCase()` at
      // the adapter layer once the regression test from #1284 is in.
      if (claim.policyNumber && /\s/.test(claim.policyNumber)) {
        level = worse(level, "medium");
        reasons.push("Medi Assist: policyNumber contains whitespace.");
        suggestedFixes.push("Strip whitespace from policyNumber.");
      }
      break;
    case "PARAMOUNT":
      // TODO(ai-claims): Paramount requires memberId on every claim; a
      // missing value surfaces as NOT_FOUND from their adapter.
      if (!claim.memberId) {
        level = worse(level, "medium");
        reasons.push("Paramount: memberId is required but missing.");
        suggestedFixes.push("Add the TPA-issued memberId to the claim.");
      }
      break;
    default:
      break;
  }

  // ── Rule 6: diagnosis text sanity ─────────────────────────────────────────
  if (!claim.diagnosis || !claim.diagnosis.trim()) {
    level = "high";
    reasons.push("Diagnosis field is empty.");
    suggestedFixes.push("Populate the diagnosis from the consultation assessment.");
  } else if (claim.diagnosis !== claim.diagnosis.trim()) {
    level = worse(level, "low");
    suggestedFixes.push("Trim leading/trailing whitespace from diagnosis.");
    fixOps.push({ type: "TRIM_DIAGNOSIS_WHITESPACE" });
  }

  return { risk: level, reasons, suggestedFixes, fixOps };
}

function worse(a: DenialRiskLevel, b: DenialRiskLevel): DenialRiskLevel {
  const order: DenialRiskLevel[] = ["low", "medium", "high"];
  return order.indexOf(a) >= order.indexOf(b) ? a : b;
}

// ── LLM layer (optional) ─────────────────────────────────────────────────────

/**
 * Optional Sarvam-backed qualitative layer. Feeds the structured claim plus
 * a summary of recent denials for this hospital/TPA combo and asks the model
 * to upgrade risk if it spots a non-rule-based concern. We NEVER downgrade
 * the rule engine's output — the LLM is purely additive.
 */
async function runLlmLayer(
  ctx: RuleContext,
  base: DenialRiskReport
): Promise<DenialRiskReport> {
  try {
    const denialHistory = await summariseDenialHistory(ctx.claim.tpaProvider);
    const payload = {
      tpaProvider: ctx.claim.tpaProvider,
      diagnosis: ctx.claim.diagnosis,
      icd10Codes: ctx.claim.icd10Codes,
      procedureName: ctx.claim.procedureName,
      amountClaimed: ctx.claim.amountClaimed,
      invoiceTotal: ctx.invoiceTotal,
      ruleRisk: base.risk,
      ruleReasons: base.reasons,
      recentDenialPatterns: denialHistory,
    };

    const { data } = await generateStructured<{
      risk: DenialRiskLevel;
      reasons: string[];
    }>({
      systemPrompt:
        "You are an Indian insurance TPA claims reviewer. Given a structured claim and the hospital's recent denial patterns, score qualitative denial risk as low|medium|high. NEVER downgrade below the rule-engine output. Your job is to catch subtle issues (off-protocol diagnoses, documentation red flags) the rules miss.",
      userPrompt: JSON.stringify(payload),
      toolName: "score_denial_risk",
      toolDescription: "Return the qualitative denial risk for this claim.",
      parameters: {
        type: "object",
        properties: {
          risk: { type: "string", enum: ["low", "medium", "high"] },
          reasons: { type: "array", items: { type: "string" } },
        },
        required: ["risk", "reasons"],
      },
      maxTokens: 512,
    });

    if (!data) return base;

    const merged: DenialRiskReport = {
      risk: worse(base.risk, data.risk),
      reasons: [...base.reasons, ...(data.reasons ?? []).map((r) => `[AI] ${r}`)],
      suggestedFixes: base.suggestedFixes,
      fixOps: base.fixOps,
    };
    return merged;
  } catch {
    // LLM is optional — any failure falls back to rule output.
    return base;
  }
}

/** Summarise recent denials for this TPA so the LLM has grounded context. */
async function summariseDenialHistory(
  tpaProvider: string
): Promise<Array<{ reason: string; count: number }>> {
  try {
    const recent = await prisma.insuranceClaim2.findMany({
      where: { tpaProvider: tpaProvider as any, status: "DENIED" },
      select: { deniedReason: true },
      take: 50,
      orderBy: { updatedAt: "desc" },
    });
    const counts = new Map<string, number>();
    for (const r of recent) {
      const k = (r.deniedReason ?? "Unknown").slice(0, 140);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  } catch {
    return [];
  }
}

// ── Public entry points ──────────────────────────────────────────────────────

export async function predictDenialRisk(
  claimId: string,
  opts: { skipLlm?: boolean } = {}
): Promise<DenialRiskReport> {
  const claim = await getClaim(claimId);
  if (!claim) throw new Error("Claim not found");
  return predictDenialRiskForClaim(claim, opts);
}

/**
 * Variant for callers that already hold a claim row (e.g. the inline
 * pre-submission guard in `POST /claims`) — saves a round-trip.
 */
export async function predictDenialRiskForClaim(
  claim: InsuranceClaimRow,
  opts: { skipLlm?: boolean } = {}
): Promise<DenialRiskReport> {
  // Enrich context: pull invoice total + scribe's ICD list so the auto-fix
  // engine can propose real values instead of placeholders.
  const invoice = await prisma.invoice.findUnique({ where: { id: claim.billId } });
  const appointmentId = invoice?.appointmentId;
  let scribeIcdCodes: string[] = [];
  if (appointmentId) {
    const scribe = await prisma.aIScribeSession.findUnique({
      where: { appointmentId },
      select: { icd10Codes: true },
    });
    if (scribe?.icd10Codes && Array.isArray(scribe.icd10Codes)) {
      for (const e of scribe.icd10Codes as any[]) {
        if (typeof e === "string" && e.trim()) scribeIcdCodes.push(e.trim());
        else if (e?.code && typeof e.code === "string") scribeIcdCodes.push(e.code.trim());
      }
    }
  }

  const ctx: RuleContext = {
    claim,
    scribeIcdCodes,
    invoiceTotal: invoice ? Number(invoice.totalAmount) : undefined,
  };

  const base = runRules(ctx);
  if (opts.skipLlm) return base;
  // LLM layer is async + optional — gated off in tests via env var so
  // integration tests don't hit the network.
  if (process.env.NODE_ENV === "test" || process.env.AI_DENIAL_LLM === "off") {
    return base;
  }
  return runLlmLayer(ctx, base);
}

/**
 * Apply every machine-replayable `SuggestedFixOp` the predictor emitted and
 * persist the patched claim. Returns the updated claim plus the list of
 * operations that were actually applied.
 */
export async function applyAutoFixes(
  claimId: string
): Promise<{
  claim: InsuranceClaimRow;
  applied: SuggestedFixOp[];
  remaining: string[];
}> {
  const claim = await getClaim(claimId);
  if (!claim) throw new Error("Claim not found");
  const report = await predictDenialRiskForClaim(claim, { skipLlm: true });

  const patch: Partial<InsuranceClaimRow> = {};
  const applied: SuggestedFixOp[] = [];
  const remaining: string[] = [];

  for (const op of report.fixOps) {
    switch (op.type) {
      case "ADD_ICD_FROM_SOAP": {
        const merged = Array.from(new Set([...(claim.icd10Codes ?? []), ...op.codes]));
        patch.icd10Codes = merged;
        applied.push(op);
        break;
      }
      case "ROUND_AMOUNT_TO_INR":
        patch.amountClaimed = op.to;
        applied.push(op);
        break;
      case "TRIM_DIAGNOSIS_WHITESPACE":
        if (claim.diagnosis) patch.diagnosis = claim.diagnosis.trim();
        applied.push(op);
        break;
      case "ADD_PROCEDURE_FROM_SOAP":
        patch.procedureName = op.procedureName;
        applied.push(op);
        break;
      default:
        remaining.push(`Unhandled op: ${JSON.stringify(op)}`);
    }
  }

  // Everything left in suggestedFixes that wasn't a fixOp is a manual
  // intervention the operator still needs to do.
  for (const fix of report.suggestedFixes) {
    const handledByOp = applied.some((op) => {
      if (op.type === "ADD_ICD_FROM_SOAP") return fix.includes("ICD-10 codes from the AI Scribe");
      if (op.type === "ROUND_AMOUNT_TO_INR") return fix.includes("Round amountClaimed");
      if (op.type === "TRIM_DIAGNOSIS_WHITESPACE") return fix.includes("Trim leading/trailing");
      if (op.type === "ADD_PROCEDURE_FROM_SOAP") return fix.includes("procedure");
      return false;
    });
    if (!handledByOp) remaining.push(fix);
  }

  const updated =
    Object.keys(patch).length > 0 ? await updateClaim(claimId, patch) : claim;

  return { claim: updated ?? claim, applied, remaining };
}
