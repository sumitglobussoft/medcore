// Radiology Report Drafting (PRD §7.2).
//
// AI pre-reads imaging, drafts a report, highlights suspicious regions, and
// a radiologist approves/edits the final text. This is a strict HITL flow:
// the AI never produces a FINAL report on its own — `approveReport()` is the
// only way to move a report to FINAL status.
//
// DICOM metadata: when an image entry is a real `application/dicom` blob
// (or has a `.dcm` extension) we parse its header with `dicom-parser` and
// stash the extracted study/series UIDs, modality, window/level, pixel
// spacing, etc. on `images[i].dicomMeta`. JPEG/PNG previews are skipped
// gracefully. The raw pixel data is never loaded — we only read the DICOM
// metadata tags.

import fs from "fs";
import path from "path";
import type {
  RadiologyStudy,
  RadiologyReport,
  RadiologyModality as PrismaRadiologyModality,
} from "@prisma/client";
import { tenantScopedPrisma as prisma } from "../tenant-prisma";
import { generateStructured, logAICall } from "./sarvam";
import { sanitizeUserInput } from "./prompt-safety";

// ── Types ─────────────────────────────────────────────────────────────────────

export type RadiologyModality =
  | "XRAY"
  | "CT"
  | "MRI"
  | "ULTRASOUND"
  | "MAMMOGRAPHY"
  | "PET";

export type RadiologyReportStatus =
  | "DRAFT"
  | "RADIOLOGIST_REVIEW"
  | "FINAL"
  | "AMENDED";

/**
 * Metadata extracted from a real DICOM file header. All fields are optional —
 * different vendors / modalities expose different subsets. Patient ID is
 * masked (first 2 chars + ****) before storage so we never persist the
 * clear-text patient identifier to the RadiologyStudy.images JSON blob.
 */
export interface DicomMeta {
  studyInstanceUID?: string;
  seriesInstanceUID?: string;
  sopInstanceUID?: string;
  modality?: string;
  manufacturer?: string;
  bodyPartExamined?: string;
  windowCenter?: number;
  windowWidth?: number;
  pixelSpacing?: [number, number];
  studyDate?: string; // YYYYMMDD or ISO — preserved as given
  patientID?: string; // masked — NEVER raw
  /** Set when the declared modality ≠ DICOM-header modality. */
  modalityMismatch?: boolean;
}

export interface RadiologyImageRef {
  key: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  uploadedAt?: string;
  dicomMeta?: DicomMeta;
}

export interface RadiologyFinding {
  description: string;
  confidence: "low" | "medium" | "high";
  suggestedFollowUp?: string;
  /**
   * Optional bounding-box region on the image (x,y,w,h normalised 0..1) with
   * an optional label. Rendered as a canvas overlay in the Pending Review
   * detail view (see apps/web/src/app/dashboard/ai-radiology/page.tsx).
   */
  region?: { x: number; y: number; w: number; h: number; label?: string };
}

export interface RadiologyDraftResult {
  impression: string;
  findings: RadiologyFinding[];
  recommendations: string[];
}

/**
 * Optional prior-study context. When present, the Sarvam prompt is told to
 * call out interval changes (new, resolved, stable). Populated automatically
 * by `createReportDraft` from the patient's most recent same-modality +
 * same-bodyPart study that has a finalised report.
 */
export interface PriorStudyContext {
  studyId: string;
  studyDate?: Date;
  finalImpression?: string | null;
  finalReport?: string | null;
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI assistant helping a radiologist draft a
report. Based on modality, body part, clinical history, and free-text findings,
produce a structured draft.

Rules:
- Flag every finding with a confidence rating: "low", "medium", or "high".
- Never produce a definitive diagnosis — your output is a draft for radiologist
  review, not a final signed report.
- If a finding is suspicious for malignancy, infection, or acute process,
  include a specific suggestedFollowUp (e.g. "Correlate with tissue biopsy",
  "Repeat in 6 weeks", "Clinical correlation recommended").
- Always include a "Review with radiologist" footer sentence in the impression.
- Recommendations should be concrete next steps (e.g. "Compare with prior
  studies", "Consider contrast-enhanced study", "Refer to surgical
  consultation").
- If the provided free-text findings are empty / trivial, generate a generic
  "no abnormalities detected on the provided views — clinical correlation
  recommended" style draft rather than fabricating findings.
- If priorStudy is provided, explicitly note interval changes (new findings,
  resolved findings, stable findings). Otherwise say "No prior study
  available for comparison."`;

// ── Tool schema ───────────────────────────────────────────────────────────────

const TOOL_SCHEMA = {
  type: "object",
  properties: {
    impression: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
          suggestedFollowUp: { type: "string" },
          region: {
            type: "object",
            properties: {
              x: { type: "number" },
              y: { type: "number" },
              w: { type: "number" },
              h: { type: "number" },
              label: { type: "string" },
            },
          },
        },
        required: ["description", "confidence"],
      },
    },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: ["impression", "findings", "recommendations"],
};

// ── DICOM parsing ─────────────────────────────────────────────────────────────

/** Mask a DICOM PatientID: keep the first 2 chars, mask the rest. */
function maskPatientID(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = String(raw).trim();
  if (s.length <= 2) return "****";
  return `${s.slice(0, 2)}****`;
}

/** Heuristic — only parse bytes that look like DICOM (by content type or ext). */
export function isLikelyDicom(ref: RadiologyImageRef): boolean {
  const ct = (ref.contentType ?? "").toLowerCase();
  if (ct === "application/dicom" || ct === "application/x-dicom") return true;
  const key = (ref.key ?? "").toLowerCase();
  const fn = (ref.filename ?? "").toLowerCase();
  return key.endsWith(".dcm") || fn.endsWith(".dcm");
}

/**
 * Resolve an image key (as persisted in RadiologyStudy.images) to a local
 * filesystem path. S3-backed blobs are not parsed here — they'd require a
 * GetObject round-trip; we log-and-skip with a warning so the caller gets
 * a useful message instead of a silent miss.
 */
function resolveLocalPath(key: string): string | null {
  // Keys look like `uploads/ehr/<filename>` relative to the API cwd.
  const rel = key.startsWith("uploads/") ? key : `uploads/ehr/${path.basename(key)}`;
  const abs = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(abs)) return null;
  return abs;
}

/**
 * Parse the DICOM header of `bytes` and extract a compact metadata object.
 * Safe: never throws — returns `null` on any parse failure (corrupted file,
 * truncated preamble, non-DICOM bytes).
 */
export function parseDicomBytes(
  bytes: Uint8Array,
  declaredModality?: RadiologyModality
): DicomMeta | null {
  try {
    // Lazy-require so the main bundle doesn't pay the cost on startup.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const dicomParser = require("dicom-parser") as typeof import("dicom-parser");
    const dataSet = dicomParser.parseDicom(bytes);
    if (!dataSet) return null;

    // DICOM tag reference:
    //   (0020,000D) StudyInstanceUID        — x0020000d
    //   (0020,000E) SeriesInstanceUID       — x0020000e
    //   (0008,0018) SOPInstanceUID          — x00080018
    //   (0008,0060) Modality                — x00080060
    //   (0008,0070) Manufacturer            — x00080070
    //   (0018,0015) BodyPartExamined        — x00180015
    //   (0028,1050) WindowCenter            — x00281050
    //   (0028,1051) WindowWidth             — x00281051
    //   (0028,0030) PixelSpacing (DS, dual) — x00280030
    //   (0008,0020) StudyDate               — x00080020
    //   (0010,0020) PatientID               — x00100020
    const getStr = (tag: string) => {
      try {
        const v = dataSet.string(tag);
        return v ? String(v).trim() : undefined;
      } catch {
        return undefined;
      }
    };
    const getFloatStr = (tag: string, idx = 0) => {
      try {
        const v = dataSet.floatString(tag, idx);
        return typeof v === "number" && Number.isFinite(v) ? v : undefined;
      } catch {
        return undefined;
      }
    };

    const modality = getStr("x00080060");
    const meta: DicomMeta = {
      studyInstanceUID: getStr("x0020000d"),
      seriesInstanceUID: getStr("x0020000e"),
      sopInstanceUID: getStr("x00080018"),
      modality,
      manufacturer: getStr("x00080070"),
      bodyPartExamined: getStr("x00180015"),
      windowCenter: getFloatStr("x00281050"),
      windowWidth: getFloatStr("x00281051"),
      studyDate: getStr("x00080020"),
      patientID: maskPatientID(getStr("x00100020")),
    };

    const pxRow = getFloatStr("x00280030", 0);
    const pxCol = getFloatStr("x00280030", 1);
    if (typeof pxRow === "number" && typeof pxCol === "number") {
      meta.pixelSpacing = [pxRow, pxCol];
    }

    // Cross-check declared vs. DICOM-header modality. User choice wins —
    // we only flag the mismatch so the UI / audit log can surface it.
    if (declaredModality && modality) {
      if (modality.toUpperCase() !== declaredModality.toUpperCase()) {
        meta.modalityMismatch = true;
      }
    }

    return meta;
  } catch {
    // Corrupted / truncated / non-DICOM bytes — fall through as "not DICOM".
    return null;
  }
}

/**
 * For each image in `images`, if it looks like a DICOM blob, read the local
 * file, parse the header, and attach `dicomMeta`. Non-DICOM files are passed
 * through untouched. Errors are swallowed — a bad upload must not break
 * study creation (the user can still fill out findings by hand).
 */
export async function enrichImagesWithDicomMeta(
  images: RadiologyImageRef[],
  declaredModality?: RadiologyModality
): Promise<{ images: RadiologyImageRef[]; modalityMismatch: boolean }> {
  let mismatch = false;
  const out: RadiologyImageRef[] = [];
  for (const img of images) {
    if (!isLikelyDicom(img)) {
      out.push(img);
      continue;
    }
    try {
      const abs = resolveLocalPath(img.key);
      if (!abs) {
        out.push(img);
        continue;
      }
      const bytes = fs.readFileSync(abs);
      const meta = parseDicomBytes(
        bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
        declaredModality
      );
      if (meta) {
        if (meta.modalityMismatch) mismatch = true;
        out.push({ ...img, dicomMeta: meta });
      } else {
        out.push(img);
      }
    } catch {
      out.push(img);
    }
  }
  return { images: out, modalityMismatch: mismatch };
}

// ── generateDraftReport ───────────────────────────────────────────────────────

/**
 * Call Sarvam to produce a structured radiology-report draft. Returns the raw
 * structured response; persistence is the caller's job (see `createReportDraft`).
 *
 * Does NOT persist anything. Safe to call from preview endpoints.
 *
 * When `priorStudy` is provided, the prior study's final impression/report are
 * threaded into the prompt and the model is instructed to call out interval
 * changes. Otherwise the model is told to say "No prior study available for
 * comparison."
 */
export async function generateDraftReport(opts: {
  studyId: string;
  modality: RadiologyModality;
  bodyPart: string;
  clinicalHistory?: string;
  findings?: string;
  priorStudy?: PriorStudyContext;
}): Promise<RadiologyDraftResult> {
  // security(2026-04-24-low): F-INJ-1 — sanitize every free-text field
  // before concatenating into the prompt. `modality` comes from a closed
  // enum so no sanitisation needed; bodyPart is clinician-entered.
  const safeBodyPart = sanitizeUserInput(opts.bodyPart, { maxLen: 120 });
  const safeHistory = opts.clinicalHistory
    ? sanitizeUserInput(opts.clinicalHistory, { maxLen: 2000 })
    : "";
  const safeFindings = opts.findings
    ? sanitizeUserInput(opts.findings, { maxLen: 4000 })
    : "";

  // Prior-study block — sanitised + truncated so a malicious prior report
  // body can't blow the prompt budget.
  let priorBlock = "No prior study available for comparison.";
  if (opts.priorStudy) {
    const priorImpression = opts.priorStudy.finalImpression
      ? sanitizeUserInput(opts.priorStudy.finalImpression, { maxLen: 1500 })
      : "";
    const priorReport = opts.priorStudy.finalReport
      ? sanitizeUserInput(opts.priorStudy.finalReport, { maxLen: 3000 })
      : "";
    const whenStr = opts.priorStudy.studyDate
      ? new Date(opts.priorStudy.studyDate).toISOString().slice(0, 10)
      : "date unknown";
    priorBlock = `Prior study (${whenStr}):
- Prior impression: ${priorImpression || "none recorded"}
- Prior report: ${priorReport || "none recorded"}

Explicitly call out interval changes (new findings, resolved findings, stable findings) where relevant.`;
  }

  const userPrompt = `Study context:
- Modality: ${opts.modality}
- Body part: ${safeBodyPart}
- Clinical history: ${safeHistory || "none provided"}

Free-text findings from the technologist / referring clinician:
${safeFindings || "no pre-read provided"}

${priorBlock}

Produce a structured radiology-report draft. Flag confidence on every finding.
End the impression with "Review with radiologist".`;

  const t0 = Date.now();
  try {
    const { data, promptTokens, completionTokens } =
      await generateStructured<RadiologyDraftResult>({
        systemPrompt: SYSTEM_PROMPT,
        userPrompt,
        toolName: "emit_radiology_draft",
        toolDescription:
          "Emit a structured radiology-report draft with impression, findings (each with a confidence band), and recommendations.",
        parameters: TOOL_SCHEMA,
        maxTokens: 1500,
        temperature: 0.2,
      });

    logAICall({
      feature: "scribe",
      model: "sarvam-105b",
      promptTokens,
      completionTokens,
      latencyMs: Date.now() - t0,
      toolUsed: "emit_radiology_draft",
    });

    if (!data) {
      return {
        impression:
          "Unable to produce a draft from the available input. Review with radiologist.",
        findings: [],
        recommendations: [],
      };
    }

    const findings = Array.isArray(data.findings)
      ? data.findings.map((f) => ({
          description: String(f.description ?? ""),
          confidence: (["low", "medium", "high"].includes(f.confidence)
            ? f.confidence
            : "low") as RadiologyFinding["confidence"],
          suggestedFollowUp: f.suggestedFollowUp
            ? String(f.suggestedFollowUp)
            : undefined,
          region: f.region ?? undefined,
        }))
      : [];

    let impression = String(data.impression ?? "").trim();
    if (!/review with radiologist/i.test(impression)) {
      impression = `${impression}${impression ? " " : ""}Review with radiologist.`;
    }

    return {
      impression,
      findings,
      recommendations: Array.isArray(data.recommendations)
        ? data.recommendations.map((r) => String(r))
        : [],
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

// ── createStudy ───────────────────────────────────────────────────────────────

/**
 * Persist a new RadiologyStudy row. Image file keys must already be written
 * to storage (via the existing /uploads signed-URL flow) — we store only the
 * references, not the blobs. Any `.dcm` uploads are parsed synchronously
 * so their metadata lands in the `images[i].dicomMeta` JSON column.
 */
export async function createStudy(params: {
  patientId: string;
  modality: RadiologyModality;
  bodyPart: string;
  images: RadiologyImageRef[];
  studyDate?: Date;
  notes?: string;
  orderId?: string;
}): Promise<RadiologyStudy> {
  const { images: enriched } = await enrichImagesWithDicomMeta(
    params.images,
    params.modality
  );
  return prisma.radiologyStudy.create({
    data: {
      patientId: params.patientId,
      modality: params.modality as PrismaRadiologyModality,
      bodyPart: params.bodyPart,
      // RadiologyStudy.images is a Prisma Json column; cast narrows our
      // typed RadiologyImageRef[] down to Prisma's InputJsonValue.
      images: enriched as unknown as Parameters<
        typeof prisma.radiologyStudy.create
      >[0]["data"]["images"],
      studyDate: params.studyDate ?? new Date(),
      notes: params.notes ?? null,
      orderId: params.orderId ?? null,
    },
  });
}

// ── createReportDraft ─────────────────────────────────────────────────────────

/**
 * Generate the AI draft for an existing study and persist a RadiologyReport
 * row with status = DRAFT. If a report already exists for this study the
 * existing row is returned untouched (idempotent — no duplicate drafts).
 *
 * Auto-discovers the patient's most recent prior study with the SAME modality
 * AND bodyPart that has a finalised report, and threads its impression +
 * report into the Sarvam prompt so interval changes are surfaced.
 */
export async function createReportDraft(
  studyId: string
): Promise<RadiologyReport> {
  const study = await prisma.radiologyStudy.findUnique({
    where: { id: studyId },
    include: { report: true },
  });
  if (!study) {
    throw new Error(`RadiologyStudy ${studyId} not found`);
  }
  if (study.report) {
    return study.report;
  }

  // Prior-study lookup: most-recent same-modality + same-bodyPart study for
  // the same patient whose report is FINAL / AMENDED. Failure here is
  // non-fatal — we proceed without prior context.
  let priorStudy: PriorStudyContext | undefined;
  try {
    const prior = await prisma.radiologyStudy.findFirst({
      where: {
        patientId: study.patientId,
        modality: study.modality,
        bodyPart: study.bodyPart,
        id: { not: studyId },
        report: { status: { in: ["FINAL", "AMENDED"] } },
      },
      orderBy: { studyDate: "desc" },
      include: { report: true },
    });
    if (prior?.report) {
      priorStudy = {
        studyId: prior.id,
        studyDate: prior.studyDate,
        finalImpression: prior.report.finalImpression,
        finalReport: prior.report.finalReport,
      };
    }
  } catch (err) {
    console.warn(
      "[radiology] prior-study lookup failed (non-fatal):",
      (err as Error)?.message ?? err
    );
  }

  const draft = await generateDraftReport({
    studyId,
    modality: study.modality as RadiologyModality,
    bodyPart: study.bodyPart,
    clinicalHistory: study.notes ?? undefined,
    priorStudy,
  });

  return prisma.radiologyReport.create({
    data: {
      studyId,
      aiDraft: [
        draft.impression,
        "",
        "FINDINGS:",
        ...draft.findings.map(
          (f) =>
            `- [${f.confidence}] ${f.description}${f.suggestedFollowUp ? ` (follow-up: ${f.suggestedFollowUp})` : ""}`
        ),
        "",
        "RECOMMENDATIONS:",
        ...draft.recommendations.map((r) => `- ${r}`),
      ].join("\n"),
      aiFindings: draft.findings as unknown as Parameters<
        typeof prisma.radiologyReport.create
      >[0]["data"]["aiFindings"],
      aiImpression: draft.impression,
      status: "DRAFT",
    },
  });
}

// ── approveReport ─────────────────────────────────────────────────────────────

/**
 * HITL approval: promote a DRAFT / RADIOLOGIST_REVIEW report to FINAL. Writes
 * the radiologist-edited `finalReport` text and stamps `approvedAt` /
 * `approvedBy`. Refuses if the report is already FINAL or AMENDED.
 */
export async function approveReport(
  reportId: string,
  finalReport: string,
  radiologistId: string,
  finalImpression?: string
): Promise<RadiologyReport> {
  const existing = await prisma.radiologyReport.findUnique({
    where: { id: reportId },
  });
  if (!existing) {
    throw new Error(`RadiologyReport ${reportId} not found`);
  }
  if (existing.status === "FINAL" || existing.status === "AMENDED") {
    throw new Error(
      `Report is already ${existing.status}; use amendReport to make changes.`
    );
  }
  return prisma.radiologyReport.update({
    where: { id: reportId },
    data: {
      finalReport,
      finalImpression: finalImpression ?? null,
      radiologistId,
      status: "FINAL",
      approvedAt: new Date(),
      approvedBy: radiologistId,
    },
  });
}

// ── amendReport ───────────────────────────────────────────────────────────────

/**
 * Post-finalisation amendment. Only valid on FINAL / AMENDED reports. Writes
 * a new `finalReport` and flips status to AMENDED. `approvedAt` / `approvedBy`
 * from the original finalisation are preserved (this lets UIs show
 * "originally finalised 3 Apr, amended 5 Apr by Dr. X").
 */
export async function amendReport(
  reportId: string,
  newReport: string,
  userId: string,
  newImpression?: string
): Promise<RadiologyReport> {
  const existing = await prisma.radiologyReport.findUnique({
    where: { id: reportId },
  });
  if (!existing) {
    throw new Error(`RadiologyReport ${reportId} not found`);
  }
  if (existing.status !== "FINAL" && existing.status !== "AMENDED") {
    throw new Error(
      `Report must be FINAL or AMENDED to amend; current status is ${existing.status}.`
    );
  }
  return prisma.radiologyReport.update({
    where: { id: reportId },
    data: {
      finalReport: newReport,
      finalImpression: newImpression ?? existing.finalImpression,
      status: "AMENDED",
      // radiologistId kept, amendedBy implicitly = userId via audit log
      radiologistId: userId,
    },
  });
}
