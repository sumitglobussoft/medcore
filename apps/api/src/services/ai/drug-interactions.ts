// Drug safety checking — two-layer approach:
// Layer 1: deterministic rules (fast, no LLM cost, high precision on known pairs)
// Layer 2: LLM comprehensive check for interactions not in the curated list

import Anthropic from "@anthropic-ai/sdk";
import type { DrugInteractionAlert } from "@medcore/shared";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Allergy cross-reactivity map ────────────────────────────────────────────
// Maps allergen keywords → drug families with documented cross-reactivity

const ALLERGY_CROSS_REACTIVITY: Record<string, { drugs: RegExp[]; description: string }> = {
  penicillin: {
    drugs: [/amoxicillin/i, /amoxyclav/i, /co.amoxiclav/i, /augmentin/i, /ampicillin/i, /flucloxacillin/i, /cloxacillin/i, /piperacillin/i, /tazobactam/i],
    description: "Cross-reactivity risk with documented penicillin allergy. Consider a cephalosporin with low cross-reactivity or a non-beta-lactam alternative.",
  },
  sulfa: {
    drugs: [/sulfamethoxazole/i, /co.trimoxazole/i, /septran/i, /bactrim/i, /sulfasalazine/i, /furosemide/i, /hydrochlorothiazide/i, /acetazolamide/i],
    description: "Sulfonamide cross-reactivity possible. Verify sulfa allergy history — furosemide and thiazides carry low but non-zero risk.",
  },
  aspirin: {
    drugs: [/ibuprofen/i, /diclofenac/i, /naproxen/i, /indomethacin/i, /ketorolac/i, /celecoxib/i, /etoricoxib/i, /mefenamic/i, /piroxicam/i],
    description: "NSAID cross-reactivity in aspirin-sensitive patients — may trigger aspirin-exacerbated respiratory disease or urticaria.",
  },
  codeine: {
    drugs: [/tramadol/i, /pethidine/i, /morphine/i, /oxycodone/i, /hydrocodone/i, /fentanyl/i, /tapentadol/i],
    description: "Opioid cross-sensitivity possible in codeine-allergic patients. Monitor closely and have naloxone available.",
  },
  cephalosporin: {
    drugs: [/cefalexin/i, /cephalexin/i, /cefixime/i, /cefuroxime/i, /ceftriaxone/i, /cefpodoxime/i, /cefdinir/i, /cefadroxil/i],
    description: "Cephalosporin allergy — cross-reactivity exists within the class. Use an alternative antibiotic class.",
  },
};

// ─── Known dangerous drug-drug interaction pairs ──────────────────────────────

const KNOWN_INTERACTIONS: {
  drugs: [RegExp, RegExp];
  severity: DrugInteractionAlert["severity"];
  description: string;
}[] = [
  // Anticoagulant interactions
  {
    drugs: [/warfarin/i, /aspirin|ibuprofen|diclofenac|naproxen|indomethacin|ketorolac|mefenamic/i],
    severity: "SEVERE",
    description: "Anticoagulant + NSAID: significantly increased bleeding risk (GI haemorrhage, intracranial bleed). Monitor INR closely; add gastroprotection (PPI).",
  },
  {
    drugs: [/warfarin/i, /fluconazole|metronidazole|clarithromycin|erythromycin|azithromycin|ciprofloxacin|levofloxacin/i],
    severity: "SEVERE",
    description: "These agents inhibit warfarin metabolism (CYP2C9/CYP3A4) — INR may rise sharply. Reduce warfarin dose and monitor INR every 2–3 days.",
  },
  // Serotonin syndrome combinations
  {
    drugs: [/ssri|fluoxetine|sertraline|paroxetine|escitalopram|citalopram|fluvoxamine/i, /maoi|phenelzine|tranylcypromine|selegiline|isocarboxazid/i],
    severity: "CONTRAINDICATED",
    description: "SSRI + MAOI: potentially fatal serotonin syndrome. Do not co-prescribe; allow 14-day washout (5 weeks for fluoxetine) when switching.",
  },
  {
    drugs: [/tramadol/i, /ssri|fluoxetine|sertraline|paroxetine|escitalopram|venlafaxine|duloxetine/i],
    severity: "SEVERE",
    description: "Tramadol + SSRI/SNRI: serotonin syndrome risk (hyperthermia, agitation, clonus). Choose alternative analgesic if possible.",
  },
  {
    drugs: [/tramadol/i, /maoi|phenelzine|tranylcypromine|selegiline/i],
    severity: "CONTRAINDICATED",
    description: "Tramadol + MAOI: contraindicated — high risk of fatal serotonin syndrome and seizures.",
  },
  {
    drugs: [/linezolid/i, /ssri|snri|tramadol|triptan|sumatriptan|rizatriptan/i],
    severity: "CONTRAINDICATED",
    description: "Linezolid is a weak MAOI — co-prescribing with serotonergic drugs risks serotonin syndrome.",
  },
  // Cardiac interactions
  {
    drugs: [/digoxin/i, /amiodarone/i],
    severity: "SEVERE",
    description: "Amiodarone inhibits digoxin clearance — digoxin toxicity risk (bradycardia, heart block, nausea). Reduce digoxin dose by ~50% and monitor levels.",
  },
  {
    drugs: [/sildenafil|tadalafil|vardenafil|avanafil/i, /nitrate|nitroglycerin|isosorbide|glyceryl trinitrate/i],
    severity: "CONTRAINDICATED",
    description: "PDE5 inhibitor + nitrate: severe, potentially fatal hypotension. Absolutely contraindicated.",
  },
  {
    drugs: [/qt.prolonging|amiodarone|sotalol|haloperidol|domperidone|erythromycin|azithromycin|ciprofloxacin|ondansetron/i, /qt.prolonging|amiodarone|sotalol|haloperidol|domperidone|erythromycin|azithromycin|ciprofloxacin|ondansetron/i],
    severity: "MODERATE",
    description: "Multiple QT-prolonging drugs: additive risk of Torsades de Pointes. Review list and monitor ECG.",
  },
  // ACE/ARB + potassium
  {
    drugs: [/enalapril|lisinopril|ramipril|captopril|perindopril|telmisartan|losartan|valsartan|irbesartan|olmesartan|candesartan/i, /spironolactone|eplerenone|amiloride|triamterene/i],
    severity: "MODERATE",
    description: "ACE inhibitor/ARB + potassium-sparing diuretic: hyperkalaemia risk. Monitor serum potassium and renal function, especially at initiation.",
  },
  // Statin interactions
  {
    drugs: [/simvastatin|lovastatin/i, /clarithromycin|erythromycin|itraconazole|fluconazole|verapamil|diltiazem|amiodarone/i],
    severity: "SEVERE",
    description: "Strong CYP3A4 inhibitor significantly raises simvastatin/lovastatin levels — rhabdomyolysis risk. Use rosuvastatin or pravastatin instead.",
  },
  {
    drugs: [/statin|atorvastatin|rosuvastatin|simvastatin|pravastatin|lovastatin/i, /gemfibrozil/i],
    severity: "SEVERE",
    description: "Statin + Gemfibrozil: greatly increased myopathy and rhabdomyolysis risk. Avoid; use fenofibrate if a fibrate is required.",
  },
  // Quinolone interactions
  {
    drugs: [/ciprofloxacin|levofloxacin|ofloxacin|norfloxacin|moxifloxacin/i, /antacid|aluminum|magnesium hydroxide|calcium carbonate|sucralfate/i],
    severity: "MODERATE",
    description: "Quinolone absorption is markedly reduced by polyvalent cation antacids. Separate doses by at least 2 hours (quinolone before antacid).",
  },
  {
    drugs: [/theophylline|aminophylline/i, /ciprofloxacin|enoxacin/i],
    severity: "SEVERE",
    description: "Ciprofloxacin/Enoxacin inhibits theophylline metabolism — theophylline toxicity risk (seizures, cardiac arrhythmias). Monitor theophylline levels.",
  },
  // Other important pairs
  {
    drugs: [/clopidogrel/i, /omeprazole|esomeprazole/i],
    severity: "MODERATE",
    description: "Omeprazole/Esomeprazole inhibit CYP2C19 and reduce clopidogrel activation. Consider pantoprazole or rabeprazole instead.",
  },
  {
    drugs: [/methotrexate/i, /nsaid|ibuprofen|diclofenac|naproxen|indomethacin|aspirin/i],
    severity: "SEVERE",
    description: "NSAIDs reduce methotrexate renal clearance — methotrexate toxicity risk (myelosuppression, mucositis). Avoid combination; if unavoidable, monitor FBC closely.",
  },
  {
    drugs: [/lithium/i, /nsaid|ibuprofen|diclofenac|naproxen|indomethacin/i],
    severity: "SEVERE",
    description: "NSAIDs reduce renal lithium clearance — lithium toxicity risk. Monitor lithium levels; use paracetamol for analgesia.",
  },
];

// ─── Condition-specific contraindications ────────────────────────────────────

const CONDITION_CONTRAINDICATIONS: {
  conditionPattern: RegExp;
  drugPattern: RegExp;
  severity: DrugInteractionAlert["severity"];
  description: string;
}[] = [
  {
    conditionPattern: /asthma|copd|reactive airway/i,
    drugPattern: /propranolol|atenolol|metoprolol|bisoprolol|carvedilol|labetalol|nadolol|timolol/i,
    severity: "SEVERE",
    description: "Beta-blockers (especially non-selective) can precipitate severe bronchospasm in asthma/COPD. Avoid or use highly cardioselective agent (bisoprolol) with extreme caution.",
  },
  {
    conditionPattern: /asthma/i,
    drugPattern: /aspirin|ibuprofen|diclofenac|naproxen|indomethacin|ketorolac/i,
    severity: "MODERATE",
    description: "NSAIDs can trigger aspirin-exacerbated respiratory disease (Samter's triad) in susceptible asthmatics. Use paracetamol instead.",
  },
  {
    conditionPattern: /renal|kidney|ckd|chronic kidney|nephropathy/i,
    drugPattern: /nsaid|ibuprofen|diclofenac|naproxen|ketorolac|indomethacin/i,
    severity: "SEVERE",
    description: "NSAIDs can worsen renal function and precipitate AKI in CKD patients. Use paracetamol; if NSAID essential, use lowest dose for shortest time with renal monitoring.",
  },
  {
    conditionPattern: /renal|kidney|ckd|chronic kidney|nephropathy/i,
    drugPattern: /metformin/i,
    severity: "MODERATE",
    description: "Metformin risk of lactic acidosis increases with renal impairment. Contraindicated if eGFR < 30 mL/min; reduce dose if eGFR 30–45.",
  },
  {
    conditionPattern: /diabetes|diabetic|type 2 dm|type 1 dm/i,
    drugPattern: /prednisolone|prednisone|dexamethasone|betamethasone|methylprednisolone|hydrocortisone/i,
    severity: "MODERATE",
    description: "Corticosteroids raise blood glucose and can destabilize glycaemic control in diabetic patients. Monitor blood sugar; may need insulin dose adjustment.",
  },
  {
    conditionPattern: /pregnancy|pregnant|gravid/i,
    drugPattern: /nsaid|ibuprofen|diclofenac|naproxen|indomethacin/i,
    severity: "SEVERE",
    description: "NSAIDs are contraindicated from 28 weeks gestation (premature closure of ductus arteriosus, oligohydramnios). Use paracetamol for analgesia.",
  },
  {
    conditionPattern: /pregnancy|pregnant|gravid/i,
    drugPattern: /warfarin/i,
    severity: "CONTRAINDICATED",
    description: "Warfarin crosses the placenta and is teratogenic/fetotoxic throughout pregnancy. Use LMWH (e.g., enoxaparin) instead.",
  },
  {
    conditionPattern: /pregnancy|pregnant|gravid/i,
    drugPattern: /tetracycline|doxycycline|minocycline/i,
    severity: "CONTRAINDICATED",
    description: "Tetracyclines are contraindicated in pregnancy — cause permanent tooth discolouration and impaired bone development in the fetus.",
  },
  {
    conditionPattern: /peptic ulcer|gastric ulcer|duodenal ulcer|gi bleed|gastrointestinal bleed/i,
    drugPattern: /nsaid|ibuprofen|aspirin|diclofenac|naproxen|indomethacin|ketorolac/i,
    severity: "SEVERE",
    description: "NSAIDs/aspirin contraindicated in active peptic ulcer disease — high risk of GI haemorrhage. Use paracetamol; add PPI cover if NSAID is unavoidable.",
  },
  {
    conditionPattern: /liver|hepatic|cirrhosis|hepatitis/i,
    drugPattern: /paracetamol|acetaminophen/i,
    severity: "MODERATE",
    description: "Paracetamol hepatotoxicity risk is increased in severe hepatic impairment or chronic alcohol use. Use lowest effective dose; max 2 g/day in hepatic disease.",
  },
];

// ─── Public deterministic functions ──────────────────────────────────────────

export function checkAllergyContraindications(
  proposedMeds: string[],
  allergies: string[]
): DrugInteractionAlert[] {
  const alerts: DrugInteractionAlert[] = [];
  for (const allergen of allergies) {
    const lowerAllergen = allergen.toLowerCase().trim();

    // Cross-reactivity families
    for (const [key, { drugs, description }] of Object.entries(ALLERGY_CROSS_REACTIVITY)) {
      if (lowerAllergen.includes(key)) {
        for (const med of proposedMeds) {
          if (drugs.some((p) => p.test(med))) {
            alerts.push({ drug1: med, drug2: `[ALLERGY: ${allergen}]`, severity: "SEVERE", description });
          }
        }
      }
    }

    // Direct name match (e.g. allergy "penicillin" vs drug "penicillin V")
    for (const med of proposedMeds) {
      const lowerMed = med.toLowerCase();
      if (lowerMed.includes(lowerAllergen) || lowerAllergen.includes(lowerMed.split(" ")[0])) {
        const alreadyFlagged = alerts.some((a) => a.drug1 === med && a.drug2.includes(allergen));
        if (!alreadyFlagged) {
          alerts.push({
            drug1: med,
            drug2: `[ALLERGY: ${allergen}]`,
            severity: "CONTRAINDICATED",
            description: `Patient has a documented allergy to ${allergen}. Prescribing ${med} is contraindicated — use an alternative.`,
          });
        }
      }
    }
  }
  return alerts;
}

export function checkKnownDrugInteractions(
  proposedMeds: string[],
  currentMeds: string[]
): DrugInteractionAlert[] {
  const allMeds = [...proposedMeds, ...currentMeds];
  const alerts: DrugInteractionAlert[] = [];
  const seen = new Set<string>();

  for (const { drugs: [patA, patB], severity, description } of KNOWN_INTERACTIONS) {
    const matchA = allMeds.filter((m) => patA.test(m));
    const matchB = allMeds.filter((m) => patB.test(m));

    for (const drugA of matchA) {
      for (const drugB of matchB) {
        if (drugA === drugB) continue;
        const key = [drugA, drugB].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        // Only alert if at least one drug is newly proposed (not both already existing)
        const aProposed = proposedMeds.some((m) => patA.test(m));
        const bProposed = proposedMeds.some((m) => patB.test(m));
        if (aProposed || bProposed) {
          alerts.push({ drug1: drugA, drug2: drugB, severity, description });
        }
      }
    }
  }
  return alerts;
}

export function checkConditionContraindications(
  proposedMeds: string[],
  chronicConditions: string[]
): DrugInteractionAlert[] {
  const alerts: DrugInteractionAlert[] = [];
  for (const condition of chronicConditions) {
    for (const { conditionPattern, drugPattern, severity, description } of CONDITION_CONTRAINDICATIONS) {
      if (conditionPattern.test(condition)) {
        for (const med of proposedMeds) {
          if (drugPattern.test(med)) {
            alerts.push({ drug1: med, drug2: `[CONDITION: ${condition}]`, severity, description });
          }
        }
      }
    }
  }
  return alerts;
}

// ─── LLM comprehensive check ──────────────────────────────────────────────────

async function checkWithAI(
  proposedMeds: { name: string; dose: string; frequency: string }[],
  currentMeds: string[],
  allergies: string[],
  chronicConditions: string[],
  patientMeta: { age?: number; gender?: string }
): Promise<DrugInteractionAlert[]> {
  const prompt = `Patient context:
- Age: ${patientMeta.age ?? "unknown"}, Gender: ${patientMeta.gender ?? "unknown"}
- Known allergies: ${allergies.join(", ") || "none"}
- Chronic conditions: ${chronicConditions.join(", ") || "none"}
- Current medications: ${currentMeds.join(", ") || "none"}

Newly proposed medications:
${proposedMeds.map((m) => `- ${m.name} ${m.dose} ${m.frequency}`).join("\n")}

Identify any MODERATE, SEVERE, or CONTRAINDICATED drug-drug interactions, allergy contraindications, or condition-specific contraindications. Only report interactions you are confident about with clear clinical evidence. Do not report MILD interactions.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    tools: [
      {
        name: "report_drug_interactions",
        description: "Report clinically significant interactions",
        input_schema: {
          type: "object" as const,
          properties: {
            interactions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  drug1: { type: "string" },
                  drug2: { type: "string" },
                  severity: { type: "string", enum: ["MILD", "MODERATE", "SEVERE", "CONTRAINDICATED"] },
                  description: { type: "string" },
                },
                required: ["drug1", "drug2", "severity", "description"],
              },
            },
          },
          required: ["interactions"],
        },
      },
    ],
    tool_choice: { type: "tool", name: "report_drug_interactions" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return [];
  return ((toolUse.input as any).interactions as DrugInteractionAlert[]) || [];
}

// ─── Combined public API ──────────────────────────────────────────────────────

export interface DrugSafetyReport {
  alerts: DrugInteractionAlert[];
  hasContraindicated: boolean;
  hasSevere: boolean;
  checkedAt: string;
  checkedMeds: string[];
}

export async function checkDrugSafety(
  proposedMeds: { name: string; dose: string; frequency: string; duration: string }[],
  currentMeds: string[],
  allergies: string[],
  chronicConditions: string[],
  patientMeta: { age?: number; gender?: string } = {}
): Promise<DrugSafetyReport> {
  const medNames = proposedMeds.map((m) => m.name);

  // Layer 1 — fast deterministic (always runs, no API key needed)
  const deterministicAlerts = [
    ...checkAllergyContraindications(medNames, allergies),
    ...checkKnownDrugInteractions(medNames, currentMeds),
    ...checkConditionContraindications(medNames, chronicConditions),
  ];

  // Layer 2 — LLM (only if API key is present; non-fatal if it fails)
  let llmAlerts: DrugInteractionAlert[] = [];
  if (process.env.ANTHROPIC_API_KEY && proposedMeds.length > 0) {
    try {
      const raw = await checkWithAI(proposedMeds, currentMeds, allergies, chronicConditions, patientMeta);
      // Deduplicate against deterministic results
      const detKeys = new Set(
        deterministicAlerts.map((a) => `${a.drug1}|${a.drug2}`.toLowerCase())
      );
      llmAlerts = raw.filter((a) => !detKeys.has(`${a.drug1}|${a.drug2}`.toLowerCase()));
    } catch {
      // non-fatal — deterministic results are still valid
    }
  }

  const alerts = [...deterministicAlerts, ...llmAlerts];

  return {
    alerts,
    hasContraindicated: alerts.some((a) => a.severity === "CONTRAINDICATED"),
    hasSevere: alerts.some((a) => a.severity === "SEVERE"),
    checkedAt: new Date().toISOString(),
    checkedMeds: medNames,
  };
}
