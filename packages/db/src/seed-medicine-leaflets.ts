import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Apr 2026 — Patient education leaflets + renal-adjustment notes +
 * controlled-substance register flags. Updates existing medicines by
 * matching on `genericName` (case-insensitive).
 *
 * Run:
 *   npx tsx packages/db/src/seed-medicine-leaflets.ts
 */

interface LeafletSeed {
  genericName: string;
  patientInstructions: string;
}

const LEAFLETS: LeafletSeed[] = [
  {
    genericName: "Paracetamol",
    patientInstructions: `**What it's for:** Reducing fever and mild to moderate pain.

**How to take:** After food with a glass of water. Do not take more than 4g (8 tablets of 500 mg) in 24 hours.

**Common side effects:** Rare — nausea, skin rash.

**When to call your doctor:** If fever persists more than 3 days, or if you develop yellowing of eyes/skin.

**Avoid:** Alcohol, other paracetamol-containing products (cold & flu mixes).`,
  },
  {
    genericName: "Ibuprofen",
    patientInstructions: `**What it's for:** Pain, inflammation, and fever.

**How to take:** Always with food to protect your stomach.

**Common side effects:** Indigestion, dizziness.

**When to call your doctor:** Black stools, vomiting blood, persistent stomach pain.

**Avoid:** If you have asthma, kidney problems, peptic ulcer, or are in the last trimester of pregnancy.`,
  },
  {
    genericName: "Amoxicillin",
    patientInstructions: `**What it's for:** Bacterial infections (ear, throat, chest, urinary tract).

**How to take:** Every 8 hours with or without food. **Complete the full course** even if you feel better.

**Common side effects:** Diarrhea, mild rash, nausea.

**When to call your doctor:** Severe rash, swelling of face/throat, difficulty breathing, watery bloody diarrhea.

**Avoid:** If you are allergic to penicillins.`,
  },
  {
    genericName: "Azithromycin",
    patientInstructions: `**What it's for:** Respiratory, skin, and some sexually transmitted infections.

**How to take:** Once daily, typically for 3–5 days. Can be taken with or without food.

**Common side effects:** Diarrhea, abdominal pain, nausea.

**When to call your doctor:** Irregular heartbeat, severe diarrhea, yellowing of skin.

**Avoid:** Antacids within 2 hours of taking.`,
  },
  {
    genericName: "Metformin",
    patientInstructions: `**What it's for:** Controls blood sugar in type 2 diabetes.

**How to take:** With meals to reduce stomach upset. Start low and increase gradually.

**Common side effects:** Nausea, loose stools, metallic taste (usually improve in 1–2 weeks).

**When to call your doctor:** Muscle pain, trouble breathing, unusual tiredness (rare but serious — lactic acidosis).

**Avoid:** Excessive alcohol. Stop before any X-ray with iodine contrast and resume after kidney function check.`,
  },
  {
    genericName: "Amlodipine",
    patientInstructions: `**What it's for:** High blood pressure and angina.

**How to take:** Once daily at the same time each day. Can be taken with or without food.

**Common side effects:** Ankle swelling, flushing, mild headache (usually settles).

**When to call your doctor:** Fainting, very slow pulse, worsening chest pain.

**Avoid:** Grapefruit juice.`,
  },
  {
    genericName: "Atenolol",
    patientInstructions: `**What it's for:** High blood pressure, angina, irregular heartbeat.

**How to take:** Once daily, same time each day. Do not stop suddenly.

**Common side effects:** Tiredness, cold hands/feet, vivid dreams.

**When to call your doctor:** Very slow pulse, shortness of breath, severe dizziness.

**Avoid:** Stopping abruptly — taper under medical supervision.`,
  },
  {
    genericName: "Omeprazole",
    patientInstructions: `**What it's for:** Reduces stomach acid — ulcers, reflux (GERD).

**How to take:** 30 minutes **before** breakfast. Swallow whole; do not crush.

**Common side effects:** Headache, abdominal pain, constipation.

**When to call your doctor:** Severe persistent diarrhea, new bone pain.

**Avoid:** Prolonged use beyond the prescribed course unless directed.`,
  },
  {
    genericName: "Cetirizine",
    patientInstructions: `**What it's for:** Allergy symptoms — sneezing, runny nose, itching, hives.

**How to take:** Once daily, preferably evening. With or without food.

**Common side effects:** Drowsiness, dry mouth.

**When to call your doctor:** Difficulty urinating, rapid heartbeat.

**Avoid:** Alcohol and driving if you feel drowsy.`,
  },
  {
    genericName: "Losartan",
    patientInstructions: `**What it's for:** High blood pressure; protects kidneys in diabetes.

**How to take:** Once daily at the same time each day.

**Common side effects:** Dizziness (especially first dose), tiredness.

**When to call your doctor:** Swelling of face/lips, reduced urination, muscle weakness.

**Avoid:** Salt substitutes containing potassium; NSAIDs long-term.`,
  },
  {
    genericName: "Atorvastatin",
    patientInstructions: `**What it's for:** Lowers cholesterol; reduces risk of heart attack/stroke.

**How to take:** Once daily, usually at night.

**Common side effects:** Muscle aches, mild digestive upset.

**When to call your doctor:** Severe muscle pain/weakness, dark urine, yellow skin.

**Avoid:** Grapefruit juice; excessive alcohol.`,
  },
  {
    genericName: "Aspirin",
    patientInstructions: `**What it's for:** Prevents blood clots (low-dose), pain/fever (higher dose).

**How to take:** After food. Swallow whole with water.

**Common side effects:** Indigestion, easy bruising.

**When to call your doctor:** Black stools, vomiting blood, persistent ringing in ears.

**Avoid:** Children under 16 unless prescribed; other NSAIDs.`,
  },
  {
    genericName: "Salbutamol",
    patientInstructions: `**What it's for:** Opens airways in asthma and COPD.

**How to take:** Inhale 1–2 puffs when short of breath. Use a spacer if provided. Rinse mouth after use.

**Common side effects:** Tremor, fast heartbeat, headache.

**When to call your doctor:** Needing the inhaler more than 3 times a week, or no relief after several puffs.

**Avoid:** Exceeding prescribed frequency — this may indicate your asthma is poorly controlled.`,
  },
  {
    genericName: "Ciprofloxacin",
    patientInstructions: `**What it's for:** Bacterial infections — urinary, GI, respiratory.

**How to take:** With plenty of water. Avoid dairy or antacids within 2 hours.

**Common side effects:** Nausea, diarrhea, headache.

**When to call your doctor:** Tendon pain, pins and needles, severe diarrhea, rash.

**Avoid:** Sun exposure without protection; strenuous exercise during treatment.`,
  },
  {
    genericName: "Metronidazole",
    patientInstructions: `**What it's for:** Certain bacterial and parasitic infections.

**How to take:** With food to reduce stomach upset. Complete full course.

**Common side effects:** Metallic taste, nausea, dark urine.

**When to call your doctor:** Numbness/tingling, seizures.

**Avoid:** **Alcohol during and 48 hours after** — severe reaction (flushing, vomiting) can occur.`,
  },
  {
    genericName: "Prednisolone",
    patientInstructions: `**What it's for:** Reduces inflammation (asthma, allergies, autoimmune).

**How to take:** With food in the morning. Do not stop suddenly if taken for more than 2 weeks.

**Common side effects:** Increased appetite, mood changes, trouble sleeping.

**When to call your doctor:** Severe stomach pain, infection symptoms, rapid weight gain.

**Avoid:** Live vaccines; abrupt discontinuation.`,
  },
  {
    genericName: "Insulin Regular",
    patientInstructions: `**What it's for:** Controls blood sugar in diabetes.

**How to take:** Subcutaneous injection 30 minutes before meals (or as prescribed). Rotate injection sites.

**Common side effects:** Low blood sugar (hypoglycemia) — shaky, sweaty, dizzy.

**When to call your doctor:** Repeated low or very high readings.

**Avoid:** Skipping meals after insulin. Carry glucose/sugar for emergencies.`,
  },
  {
    genericName: "Warfarin",
    patientInstructions: `**What it's for:** Prevents/treats blood clots.

**How to take:** Same time each day. Keep regular INR (blood test) appointments.

**Common side effects:** Bruising, minor bleeding.

**When to call your doctor:** Blood in urine/stool, severe bleeding, major head injury.

**Avoid:** Large changes in diet (especially green leafy vegetables), alcohol excess, new medicines/supplements without checking.`,
  },
  {
    genericName: "Digoxin",
    patientInstructions: `**What it's for:** Heart failure and some irregular heart rhythms.

**How to take:** Once daily at the same time.

**Common side effects:** Nausea, loss of appetite, visual disturbance.

**When to call your doctor:** Yellow-green vision, confusion, very slow or irregular pulse.

**Avoid:** Missing doses; taking with antacids within 2 hours.`,
  },
  {
    genericName: "Furosemide",
    patientInstructions: `**What it's for:** Removes excess fluid (heart failure, kidney/liver disease).

**How to take:** Morning dose preferred (to avoid nighttime bathroom trips).

**Common side effects:** Frequent urination, thirst, low potassium.

**When to call your doctor:** Muscle cramps, irregular heartbeat, dizziness on standing.

**Avoid:** Standing up too quickly; excessive salt.`,
  },
];

interface RenalSeed {
  genericName: string;
  notes: string;
}

const RENAL_ADJUSTMENTS: RenalSeed[] = [
  { genericName: "Metformin", notes: "Avoid if eGFR < 30 mL/min. Reduce dose (max 1 g/day) if eGFR 30–45 mL/min." },
  { genericName: "Atenolol", notes: "Reduce dose: CrCl 15–35 mL/min max 50 mg/day; CrCl <15 mL/min max 25 mg/day." },
  { genericName: "Digoxin", notes: "Reduce maintenance dose by 25–75% based on CrCl; monitor levels closely." },
  { genericName: "Allopurinol", notes: "CrCl 20–40 mL/min: 100–200 mg/day. CrCl 10–20: 100 mg every 1–2 days. CrCl <10: 100 mg every 3 days." },
  { genericName: "Enoxaparin", notes: "CrCl <30 mL/min: reduce therapeutic dose to 1 mg/kg once daily (from 1 mg/kg twice daily)." },
  { genericName: "Vancomycin", notes: "Dose by levels. CrCl 20–49 mL/min: extend interval to q24h. CrCl <20: individualize with trough monitoring." },
  { genericName: "Gabapentin", notes: "CrCl 30–59: 400–1400 mg/day. CrCl 15–29: 200–700 mg/day. CrCl <15: 100–300 mg/day." },
  { genericName: "Ciprofloxacin", notes: "CrCl 30–50 mL/min: 250–500 mg q12h. CrCl 5–29 mL/min: 250–500 mg q18h." },
  { genericName: "Ranitidine", notes: "CrCl <50 mL/min: halve the dose or extend interval to q24h." },
  { genericName: "Tramadol", notes: "CrCl <30 mL/min: max 200 mg/day, extend interval to q12h. Avoid ER preparations." },
];

// Medicines that trigger controlled-substance register (Schedule H1 / X narcotics)
const CONTROLLED: Array<{ genericName: string; scheduleClass: string }> = [
  { genericName: "Morphine", scheduleClass: "X" },
  { genericName: "Fentanyl", scheduleClass: "X" },
  { genericName: "Tramadol", scheduleClass: "H1" },
  { genericName: "Alprazolam", scheduleClass: "H1" },
  { genericName: "Diazepam", scheduleClass: "H1" },
  { genericName: "Codeine", scheduleClass: "X" },
  { genericName: "Pentazocine", scheduleClass: "X" },
  { genericName: "Buprenorphine", scheduleClass: "X" },
];

async function main() {
  console.log("Seeding medicine leaflets + renal notes + controlled flags...");
  let updated = 0;

  for (const leaf of LEAFLETS) {
    const result = await prisma.medicine.updateMany({
      where: {
        genericName: { equals: leaf.genericName, mode: "insensitive" },
      },
      data: { patientInstructions: leaf.patientInstructions },
    });
    updated += result.count;
  }
  console.log(`Leaflets applied to ${updated} medicine records.`);

  let renalCount = 0;
  for (const r of RENAL_ADJUSTMENTS) {
    const result = await prisma.medicine.updateMany({
      where: { genericName: { equals: r.genericName, mode: "insensitive" } },
      data: { renalAdjustmentNotes: r.notes, requiresRenalAdjustment: true },
    });
    renalCount += result.count;
  }
  console.log(`Renal notes applied to ${renalCount} medicine records.`);

  let ctrlCount = 0;
  for (const c of CONTROLLED) {
    const result = await prisma.medicine.updateMany({
      where: { genericName: { equals: c.genericName, mode: "insensitive" } },
      data: {
        scheduleClass: c.scheduleClass,
        requiresRegister: true,
        isNarcotic: true,
      },
    });
    ctrlCount += result.count;
  }
  console.log(`Controlled-substance flags applied to ${ctrlCount} records.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
