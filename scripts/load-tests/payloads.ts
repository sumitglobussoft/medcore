/**
 * Realistic test fixtures for MedCore AI endpoint load tests.
 *
 * These are intentionally *diverse* so the load harness exercises
 * different prompt shapes (short/long, multi-lingual, red-flag,
 * pediatric, vague) rather than spamming the same token stream.
 */

// ── Triage prompts ──────────────────────────────────────────────────────────
// Each entry is the initial user message sent to POST /ai/triage/:id/message
// after a session has been started. `language` matches the session language.

export interface TriagePrompt {
  id: string;
  label: string;
  language: "en" | "hi";
  message: string;
  // Notes for the runner log — why this payload is interesting.
  expectBehaviour: string;
}

export const triagePrompts: TriagePrompt[] = [
  {
    id: "triage-simple-cough",
    label: "Simple cough (en)",
    language: "en",
    message:
      "I've had a dry cough for about three days. No fever, no chest pain. I'm 32. Mostly bothers me at night.",
    expectBehaviour: "Fast, low-token. Should route to GP.",
  },
  {
    id: "triage-chestpain-hi",
    label: "Red-flag chest pain (hi)",
    language: "hi",
    message:
      "मुझे सीने में बहुत तेज़ दर्द हो रहा है, बाएँ हाथ तक जा रहा है, पसीना आ रहा है। साँस भी फूल रही है।",
    expectBehaviour:
      "Must trigger red-flag / emergency response. Short-circuit path — should NOT hit Sarvam.",
  },
  {
    id: "triage-suicidal",
    label: "Suicidal ideation (en)",
    language: "en",
    message:
      "I don't want to be here anymore. I've been thinking about ending it. I have pills at home.",
    expectBehaviour:
      "Must trigger red-flag mental-health path with crisis helpline response.",
  },
  {
    id: "triage-pediatric-fever",
    label: "Pediatric fever (en)",
    language: "en",
    message:
      "My 4 year old has had a fever of 103F for two days, is refusing food, and has been very sleepy. No rash. Gave paracetamol syrup.",
    expectBehaviour:
      "Should recommend urgent pediatric care. Moderate token usage.",
  },
  {
    id: "triage-vague",
    label: "Vague symptoms (en)",
    language: "en",
    message:
      "I just don't feel right. Tired all the time for maybe a month. Sometimes dizzy when I stand up. Nothing specific really.",
    expectBehaviour:
      "Classic multi-turn case — model should ask clarifying questions, higher latency.",
  },
];

// ── Scribe transcripts ──────────────────────────────────────────────────────
// Each transcript is an ordered list of {speaker, text} exchanges fed
// one-at-a-time as addTranscriptChunk calls, OR concatenated as one big
// transcript for the SOAP-generation test.

export interface ScribeTranscript {
  id: string;
  label: string;
  exchanges: { speaker: "DOCTOR" | "PATIENT"; text: string }[];
  expectBehaviour: string;
}

const shortVisit: ScribeTranscript = {
  id: "scribe-short-3",
  label: "Short visit — 3 exchanges",
  expectBehaviour: "Minimum SOAP — p95 should be ~5-8s.",
  exchanges: [
    { speaker: "DOCTOR", text: "What brings you in today?" },
    {
      speaker: "PATIENT",
      text: "Sore throat for four days, bit of a fever yesterday.",
    },
    {
      speaker: "DOCTOR",
      text: "Any cough, difficulty swallowing, or ear pain?",
    },
  ],
};

const mediumVisit: ScribeTranscript = {
  id: "scribe-medium-10",
  label: "Medium visit — 10 exchanges",
  expectBehaviour: "Normal SOAP — representative workload.",
  exchanges: [
    { speaker: "DOCTOR", text: "Hi Mrs. Sharma, how have you been since the last visit?" },
    { speaker: "PATIENT", text: "Doctor, the headaches are still there. Almost every day now." },
    { speaker: "DOCTOR", text: "Same pattern — right side, throbbing?" },
    { speaker: "PATIENT", text: "Yes, and sometimes I see flashing lights before it starts." },
    { speaker: "DOCTOR", text: "Any nausea or sensitivity to light?" },
    { speaker: "PATIENT", text: "Both. I have to lie down in a dark room." },
    { speaker: "DOCTOR", text: "Are the propranolol tablets helping at all?" },
    { speaker: "PATIENT", text: "Maybe a little, but I'm still getting them 4-5 times a week." },
    { speaker: "DOCTOR", text: "Let's increase the dose and add a rescue med. Any chest pain or breathing issues on the current dose?" },
    { speaker: "PATIENT", text: "No, blood pressure has been fine. Pulse feels slower." },
  ],
};

function makeLongVisit(n: number, id: string, label: string): ScribeTranscript {
  const base = [
    ["DOCTOR", "Tell me about the diabetes management since we last met."],
    ["PATIENT", "Sugars have been higher, doctor. Fasting is 160-180."],
    ["DOCTOR", "Are you taking metformin 1000 twice a day still?"],
    ["PATIENT", "Yes, and the glimepiride in the morning."],
    ["DOCTOR", "Any episodes of low sugar — sweating, shakiness, confusion?"],
    ["PATIENT", "Twice last week, around 4pm. I ate a biscuit and it went away."],
    ["DOCTOR", "Diet — any recent changes? Festival season?"],
    ["PATIENT", "Yes, a lot of sweets at Diwali. I know, I know."],
    ["DOCTOR", "Activity level?"],
    ["PATIENT", "Walking 30 minutes most days."],
    ["DOCTOR", "Any numbness or tingling in feet? Vision changes?"],
    ["PATIENT", "A bit of tingling in the toes at night, yes."],
    ["DOCTOR", "How about wound healing — any cuts that took long?"],
    ["PATIENT", "A small cut on my leg took maybe three weeks to heal fully."],
    ["DOCTOR", "Let's check the HbA1c and foot examination today."],
  ] as const;
  const exchanges: ScribeTranscript["exchanges"] = [];
  for (let i = 0; i < n; i++) {
    const [speaker, text] = base[i % base.length];
    exchanges.push({ speaker: speaker as "DOCTOR" | "PATIENT", text });
  }
  return {
    id,
    label,
    exchanges,
    expectBehaviour:
      n >= 20
        ? "Large prompt — tests token ceiling & tool-calling. p95 may exceed 15s."
        : "Longer than medium — headroom check.",
  };
}

export const scribeTranscripts: ScribeTranscript[] = [
  shortVisit,
  mediumVisit,
  makeLongVisit(18, "scribe-long-18", "Long visit — 18 exchanges"),
  makeLongVisit(24, "scribe-long-24", "Long visit — 24 exchanges"),
  makeLongVisit(30, "scribe-long-30", "Very long visit — 30 exchanges"),
];

// ── Chart-search queries ────────────────────────────────────────────────────

export interface ChartSearchQuery {
  id: string;
  label: string;
  query: string;
  synthesize: boolean;
  expectBehaviour: string;
}

export const chartSearchQueries: ChartSearchQuery[] = [
  {
    id: "cs-last-hba1c",
    label: "Last HbA1c value",
    query: "What was the patient's most recent HbA1c and when was it measured?",
    synthesize: true,
    expectBehaviour: "Simple retrieval + short synthesis.",
  },
  {
    id: "cs-bp-trend",
    label: "BP trend over 6 months",
    query: "Summarise blood pressure readings over the past 6 months and note any trend.",
    synthesize: true,
    expectBehaviour: "Moderate synthesis. Multi-document.",
  },
  {
    id: "cs-allergy-check",
    label: "Allergy cross-check",
    query: "Does this patient have any documented drug allergies, specifically to penicillins or sulfa drugs?",
    synthesize: false,
    expectBehaviour: "No synthesis — pure retrieval. Should be fastest.",
  },
  {
    id: "cs-med-history",
    label: "Medication history summary",
    query: "List all medications the patient has been on in the last 12 months with start/stop dates.",
    synthesize: true,
    expectBehaviour: "Larger retrieval, structured synthesis.",
  },
  {
    id: "cs-ambiguous",
    label: "Ambiguous long query",
    query:
      "The patient mentioned something about kidney issues a while back — can you find any imaging, labs, or notes that reference renal function, proteinuria, eGFR, or nephrology consults?",
    synthesize: true,
    expectBehaviour: "Wide recall, heavier synthesis. Likely slowest case.",
  },
];

// ── Picker helpers ──────────────────────────────────────────────────────────

export function pickRoundRobin<T>(arr: T[], index: number): T {
  return arr[index % arr.length];
}
