import Anthropic from "@anthropic-ai/sdk";
import type { SOAPNote, SpecialtySuggestion, SymptomCapture, TranscriptEntry } from "@medcore/shared";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";

// Cached medical system context — reused across requests to hit Anthropic prompt cache
const TRIAGE_SYSTEM = `You are MedCore's AI appointment booking assistant for Indian hospitals. Your role is to help patients find the right specialist doctor based on their symptoms. You are NOT a diagnostic tool — you route patients to the right doctor, nothing more.

Guidelines:
- Ask concise, empathetic follow-up questions (max 5-7 total across the conversation)
- Always check for red-flag/emergency symptoms at every turn
- Respond in the same language the patient uses (English or Hindi)
- Never diagnose, prescribe, or give medical advice
- Always include a disclaimer that this is a routing assistant only
- If unsure, recommend a General Physician

Red-flag symptoms requiring immediate emergency routing: chest pain with radiation, difficulty breathing, stroke signs (facial drooping, arm weakness, speech difficulty), severe bleeding, loss of consciousness, anaphylaxis, suicidal ideation, eclampsia, neonatal distress, severe burns.

Indian medical specialties to consider: General Physician, Cardiologist, Pulmonologist, Gastroenterologist, Neurologist, Orthopedic, Dermatologist, ENT, Ophthalmologist, Gynecologist, Pediatrician, Urologist, Endocrinologist, Psychiatrist, Oncologist, Nephrologist, Rheumatologist, Dentist, Physiotherapist.`;

const SCRIBE_SYSTEM = `You are MedCore's AI Medical Scribe. You analyze doctor-patient consultation transcripts and produce structured clinical documentation.

You must:
- Extract information ONLY from what was explicitly stated in the transcript
- Leave fields empty rather than guessing
- Always cite the evidence span (exact quote) supporting each SOAP section
- Flag drug interactions against the patient's known medication list
- Suggest ICD-10 codes with confidence scores and justification
- Produce output as structured JSON only

You are a documentation tool. You do NOT make clinical decisions. Every output requires doctor review and sign-off before being committed to the EHR.`;

export async function runTriageTurn(
  messages: { role: "user" | "assistant"; content: string }[],
  language: string
): Promise<{ reply: string; isEmergency: boolean; emergencyReason?: string }> {
  const systemPrompt = language === "hi"
    ? TRIAGE_SYSTEM + "\n\nRespond in Hindi (Devanagari script) when the patient writes in Hindi. Use simple, clear language."
    : TRIAGE_SYSTEM;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "flag_emergency",
        description: "Call this tool IMMEDIATELY if the patient describes any emergency/red-flag symptom. Do not continue the conversation — use this tool.",
        input_schema: {
          type: "object" as const,
          properties: {
            reason: { type: "string", description: "The specific emergency symptom detected" },
            urgency: { type: "string", enum: ["CALL_EMERGENCY", "GO_TO_ER_NOW"] },
          },
          required: ["reason", "urgency"],
        },
      },
    ],
    messages,
  });

  // Check if Claude flagged an emergency via tool use
  for (const block of response.content) {
    if (block.type === "tool_use" && block.name === "flag_emergency") {
      const input = block.input as { reason: string; urgency: string };
      return { reply: "", isEmergency: true, emergencyReason: input.reason };
    }
  }

  const textBlock = response.content.find((b) => b.type === "text");
  return { reply: textBlock?.type === "text" ? textBlock.text : "", isEmergency: false };
}

export async function extractSymptomSummary(
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<SymptomCapture & { specialties: SpecialtySuggestion[]; confidence: number }> {
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: TRIAGE_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "structured_symptom_summary",
        description: "Extract a structured symptom summary and specialty recommendations from the conversation",
        input_schema: {
          type: "object" as const,
          properties: {
            chiefComplaint: { type: "string" },
            onset: { type: "string" },
            duration: { type: "string" },
            severity: { type: "number", minimum: 1, maximum: 10 },
            location: { type: "string" },
            associatedSymptoms: { type: "array", items: { type: "string" } },
            relevantHistory: { type: "string" },
            currentMedications: { type: "array", items: { type: "string" } },
            knownAllergies: { type: "array", items: { type: "string" } },
            age: { type: "number" },
            gender: { type: "string" },
            specialties: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  specialty: { type: "string" },
                  subSpecialty: { type: "string" },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  reasoning: { type: "string" },
                },
                required: ["specialty", "confidence", "reasoning"],
              },
            },
            overallConfidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["chiefComplaint", "specialties", "overallConfidence"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "structured_symptom_summary" },
    messages: [
      ...messages,
      { role: "user", content: "Now produce a structured summary of the symptoms and recommend the top 3 specialties." },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Failed to extract symptom summary");
  }

  const input = toolUse.input as any;
  return {
    chiefComplaint: input.chiefComplaint,
    onset: input.onset,
    duration: input.duration,
    severity: input.severity,
    location: input.location,
    associatedSymptoms: input.associatedSymptoms,
    relevantHistory: input.relevantHistory,
    currentMedications: input.currentMedications,
    knownAllergies: input.knownAllergies,
    age: input.age,
    gender: input.gender,
    specialties: input.specialties,
    confidence: input.overallConfidence,
  };
}

export async function generateSOAPNote(
  transcript: TranscriptEntry[],
  patientContext: {
    allergies: string[];
    currentMedications: string[];
    chronicConditions: string[];
    age?: number;
    gender?: string;
  }
): Promise<SOAPNote> {
  const transcriptText = transcript
    .map((e) => `[${e.speaker}]: ${e.text}`)
    .join("\n");

  const contextText = `
Patient Context:
- Age: ${patientContext.age ?? "unknown"}
- Gender: ${patientContext.gender ?? "unknown"}
- Known Allergies: ${patientContext.allergies.join(", ") || "none"}
- Current Medications: ${patientContext.currentMedications.join(", ") || "none"}
- Chronic Conditions: ${patientContext.chronicConditions.join(", ") || "none"}
`;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: SCRIBE_SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools: [
      {
        name: "generate_soap_note",
        description: "Generate a structured SOAP note from the consultation transcript",
        input_schema: {
          type: "object" as const,
          properties: {
            subjective: {
              type: "object",
              properties: {
                chiefComplaint: { type: "string" },
                hpi: { type: "string" },
                pastMedicalHistory: { type: "string" },
                medications: { type: "array", items: { type: "string" } },
                allergies: { type: "array", items: { type: "string" } },
                socialHistory: { type: "string" },
                familyHistory: { type: "string" },
              },
              required: ["chiefComplaint", "hpi"],
            },
            objective: {
              type: "object",
              properties: {
                vitals: { type: "string" },
                examinationFindings: { type: "string" },
              },
            },
            assessment: {
              type: "object",
              properties: {
                impression: { type: "string" },
                icd10Codes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      code: { type: "string" },
                      description: { type: "string" },
                      confidence: { type: "number" },
                      evidenceSpan: { type: "string" },
                    },
                    required: ["code", "description", "confidence"],
                  },
                },
              },
              required: ["impression"],
            },
            plan: {
              type: "object",
              properties: {
                medications: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      dose: { type: "string" },
                      frequency: { type: "string" },
                      duration: { type: "string" },
                      notes: { type: "string" },
                    },
                    required: ["name", "dose", "frequency", "duration"],
                  },
                },
                investigations: { type: "array", items: { type: "string" } },
                procedures: { type: "array", items: { type: "string" } },
                referrals: { type: "array", items: { type: "string" } },
                followUpTimeline: { type: "string" },
                patientInstructions: { type: "string" },
              },
            },
          },
          required: ["subjective", "objective", "assessment", "plan"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "generate_soap_note" },
    messages: [
      {
        role: "user",
        content: `${contextText}\n\nConsultation Transcript:\n${transcriptText}\n\nGenerate the SOAP note. Only include information explicitly stated in the transcript.`,
      },
    ],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("Failed to generate SOAP note");
  }

  return toolUse.input as SOAPNote;
}
