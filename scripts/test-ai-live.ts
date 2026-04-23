// Live AI smoke test — hits real Sarvam API with the key from apps/api/.env.
// Run: npx tsx scripts/test-ai-live.ts
import { config as loadEnv } from "dotenv";
import path from "path";

loadEnv({ path: path.resolve(process.cwd(), "apps/api/.env") });
if (!process.env.SARVAM_API_KEY) {
  console.error("SARVAM_API_KEY missing from apps/api/.env");
  process.exit(1);
}

async function main() {
  const { runTriageTurn, generateSOAPNote } = await import(
    "../apps/api/src/services/ai/sarvam.ts"
  );

  console.log("\n════ TEST 1: AI Triage (first turn) ════");
  const triage1 = await runTriageTurn(
    [{ role: "user", content: "I've had chest tightness and shortness of breath for 2 hours" }],
    { language: "en" }
  );
  console.log(JSON.stringify(triage1, null, 2));

  console.log("\n════ TEST 2: AI Triage (Hindi turn) ════");
  const triage2 = await runTriageTurn(
    [{ role: "user", content: "pet mein dard ho raha hai kal se" }],
    { language: "hi" }
  );
  console.log(JSON.stringify(triage2, null, 2));

  console.log("\n════ TEST 3: AI Scribe (SOAP generation) ════");
  const transcript = [
    { speaker: "doctor" as const, text: "What brings you in today?" },
    { speaker: "patient" as const, text: "I've had a dry cough for 3 weeks, worse at night" },
    { speaker: "doctor" as const, text: "Any fever or chest pain?" },
    { speaker: "patient" as const, text: "Low grade fever for the last week, mostly in the evenings. No chest pain." },
    { speaker: "doctor" as const, text: "On examination, lungs are clear. No wheeze. Throat slightly erythematous." },
    { speaker: "doctor" as const, text: "I'll prescribe azithromycin 500mg once daily for 3 days. Let's also get a chest X-ray to rule out anything." },
  ];
  const patientContext = {
    allergies: [],
    currentMedications: [],
    chronicConditions: [],
    age: 42,
    gender: "female" as const,
  };
  const soap = await generateSOAPNote(transcript, patientContext);
  console.log(JSON.stringify(soap, null, 2));

  console.log("\n════ All tests passed ════");
}

main().catch((err) => {
  console.error("\nFAILED:", err.message || err);
  if (err.status) console.error("HTTP status:", err.status);
  if (err.response?.data) console.error("Response:", err.response.data);
  process.exit(1);
});
