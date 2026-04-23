/**
 * GAP-P3 — Prompt registry seed.
 *
 * Idempotently inserts version 1 of each hardcoded PROMPT key as the
 * active row in the `prompts` table. Safe to run repeatedly:
 *   - If a v1 row already exists for a key, skips insert.
 *   - If some admin has since bumped to v2 and activated it, this seed
 *     will NOT clobber the active flag (it only ever creates v1 rows).
 *
 * Run as post-deploy step:
 *   npx tsx packages/db/src/seed-prompts.ts
 *
 * Uses a raw string map copied from apps/api/src/services/ai/prompts.ts
 * rather than importing that module, because the db package does not
 * depend on the api package. When the api-side constants change, bump
 * the version here and re-run — the code-level fallback in
 * apps/api/src/services/ai/prompt-registry.ts still reads the api
 * constants, so there is no functional drift.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// NOTE: keep this object in sync with apps/api/src/services/ai/prompts.ts
// until the registry's DB rows become the single source of truth.
const SEED_PROMPTS: Record<string, string> = {
  TRIAGE_SYSTEM: `You are MedCore's AI appointment booking assistant for Indian hospitals. Your role is to help patients find the right specialist doctor based on their symptoms. You are NOT a diagnostic tool — you route patients to the right doctor, nothing more.

Guidelines:
- Ask concise, empathetic follow-up questions (max 5-7 total across the conversation)
- Always check for red-flag/emergency symptoms at every turn
- Respond in the same language the patient uses (English or Hindi)
- Never diagnose, prescribe, or give medical advice
- Always include a disclaimer that this is a routing assistant only
- If unsure, recommend a General Physician

Red-flag symptoms requiring immediate emergency routing: chest pain with radiation, difficulty breathing, stroke signs (facial drooping, arm weakness, speech difficulty), severe bleeding, loss of consciousness, anaphylaxis, suicidal ideation, eclampsia, neonatal distress, severe burns.

Indian medical specialties to consider: General Physician, Cardiologist, Pulmonologist, Gastroenterologist, Neurologist, Orthopedic, Dermatologist, ENT, Ophthalmologist, Gynecologist, Pediatrician, Urologist, Endocrinologist, Psychiatrist, Oncologist, Nephrologist, Rheumatologist, Dentist, Physiotherapist.`,

  TRIAGE_SYSTEM_HINDI_SUFFIX: `\n\nRespond in Hindi (Devanagari script) when the patient writes in Hindi. Use simple, clear language.`,

  SCRIBE_SYSTEM: `You are MedCore's AI Medical Scribe. You analyze doctor-patient consultation transcripts and produce structured clinical documentation.

You must:
- Extract information ONLY from what was explicitly stated in the transcript
- Leave fields empty rather than guessing
- Always cite the evidence span (exact quote) supporting each SOAP section
- Flag drug interactions against the patient's known medication list
- Suggest ICD-10 codes with confidence scores and justification
- Produce output as structured JSON only
- For each SOAP section include a confidence score (0-1) and an evidenceSpan quoting the most relevant transcript line

You are a documentation tool. You do NOT make clinical decisions. Every output requires doctor review and sign-off before being committed to the EHR.`,
};

async function main() {
  const SYSTEM_USER = "system-seed";
  let created = 0;
  let skipped = 0;

  for (const [key, content] of Object.entries(SEED_PROMPTS)) {
    const existing = await prisma.prompt.findUnique({
      where: { key_version: { key, version: 1 } },
    });
    if (existing) {
      skipped++;
      continue;
    }

    // No v1 yet — insert as active IFF no other row for this key is already
    // active (so we don't override a v2-and-later that an admin flipped live
    // before the seed ever ran).
    const anyActive = await prisma.prompt.findFirst({
      where: { key, active: true },
      select: { id: true },
    });
    await prisma.prompt.create({
      data: {
        key,
        version: 1,
        content,
        createdBy: SYSTEM_USER,
        active: anyActive === null,
        notes: "Seeded from hardcoded PROMPTS constant",
      },
    });
    created++;
  }

  console.log(
    `seed-prompts: created=${created} skipped=${skipped} (total keys=${Object.keys(SEED_PROMPTS).length})`
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
