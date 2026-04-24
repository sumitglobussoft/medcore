/**
 * Curated list of drug name substrings that REQUIRE a prescription under
 * Indian Schedule H / H1 / X conventions (and common Western equivalents).
 *
 * This list is intentionally stored as a flat array of lowercase substrings
 * (not a database table) because:
 *   1. It is a regulatory / clinical-safety invariant, not tenant data.
 *   2. It needs to be diffable in code review when a drug is added / removed.
 *   3. The remediation script (scripts/fix-rx-required-flags.ts) and the
 *      Add-Medicine form (apps/web) must read the exact same source of truth.
 *
 * Matching is case-insensitive substring (NOT exact), so "Amlodipine 5mg",
 * "AMLODIPINE 10MG", and "Amlodipine besylate" all match "amlodipine".
 *
 * Regression rule: any OTC drug (paracetamol, ibuprofen below a dose
 * threshold, cetirizine, folic acid, ORS, vitamins, calcium) MUST NOT appear
 * in this list. Those stay `prescriptionRequired = false`.
 */

export const RX_REQUIRED_SUBSTRINGS: readonly string[] = [
  // ─── Cardiovascular ────────────────────────────────────
  "amlodipine",
  "atenolol",
  "atorvastatin",
  "rosuvastatin",
  "simvastatin",
  "pravastatin",
  "losartan",
  "telmisartan",
  "olmesartan",
  "valsartan",
  "ramipril",
  "enalapril",
  "lisinopril",
  "perindopril",
  "metoprolol",
  "bisoprolol",
  "carvedilol",
  "propranolol",
  "nebivolol",
  "clopidogrel",
  "prasugrel",
  "ticagrelor",
  "warfarin",
  "rivaroxaban",
  "apixaban",
  "dabigatran",
  "heparin",
  "enoxaparin",
  "digoxin",
  "amiodarone",
  "nitroglycerin",
  "isosorbide",
  "spironolactone",
  "furosemide",
  "torsemide",
  "hydrochlorothiazide",
  // ─── Diabetes (all RX in India, even metformin) ───────
  "insulin",
  "metformin",
  "gliclazide",
  "glimepiride",
  "glipizide",
  "glibenclamide",
  "sitagliptin",
  "vildagliptin",
  "linagliptin",
  "empagliflozin",
  "dapagliflozin",
  "canagliflozin",
  "pioglitazone",
  "liraglutide",
  "semaglutide",
  // ─── CNS / psych ───────────────────────────────────────
  "sertraline",
  "escitalopram",
  "citalopram",
  "fluoxetine",
  "paroxetine",
  "venlafaxine",
  "duloxetine",
  "alprazolam",
  "clonazepam",
  "diazepam",
  "lorazepam",
  "midazolam",
  "zolpidem",
  "eszopiclone",
  "amitriptyline",
  "nortriptyline",
  "imipramine",
  "quetiapine",
  "olanzapine",
  "risperidone",
  "aripiprazole",
  "haloperidol",
  "clozapine",
  "lithium",
  "carbamazepine",
  "phenytoin",
  "lamotrigine",
  "valproate",
  "levetiracetam",
  "gabapentin",
  "pregabalin",
  // ─── Antibiotics (every systemic antibiotic is RX) ────
  "amoxicillin",
  "ampicillin",
  "azithromycin",
  "clarithromycin",
  "ciprofloxacin",
  "levofloxacin",
  "moxifloxacin",
  "norfloxacin",
  "ofloxacin",
  "metronidazole",
  "tinidazole",
  "ceftriaxone",
  "cefixime",
  "cefuroxime",
  "cefpodoxime",
  "cephalexin",
  "cefotaxime",
  "doxycycline",
  "minocycline",
  "tetracycline",
  "erythromycin",
  "clindamycin",
  "vancomycin",
  "linezolid",
  "meropenem",
  "imipenem",
  "piperacillin",
  "gentamicin",
  "amikacin",
  "tobramycin",
  "trimethoprim",
  "sulfamethoxazole",
  "nitrofurantoin",
  "rifampicin",
  "isoniazid",
  "pyrazinamide",
  "ethambutol",
  // ─── Antivirals / antifungals (systemic) ──────────────
  "acyclovir",
  "valacyclovir",
  "oseltamivir",
  "fluconazole",
  "itraconazole",
  "voriconazole",
  "ketoconazole",
  "terbinafine",
  // ─── Endocrine ────────────────────────────────────────
  "levothyroxine",
  "liothyronine",
  "carbimazole",
  "methimazole",
  "propylthiouracil",
  "hydrocortisone",
  "prednisolone",
  "prednisone",
  "methylprednisolone",
  "dexamethasone",
  "betamethasone",
  "fludrocortisone",
  // ─── Oncology / immunosuppression ─────────────────────
  "methotrexate",
  "azathioprine",
  "mycophenolate",
  "cyclosporine",
  "tacrolimus",
  "hydroxychloroquine",
  "chloroquine",
  // ─── Controlled analgesics ────────────────────────────
  "tramadol",
  "codeine",
  "morphine",
  "fentanyl",
  "oxycodone",
  "buprenorphine",
  "pethidine",
  // ─── Respiratory RX ───────────────────────────────────
  "montelukast",
  "salmeterol",
  "formoterol",
  "budesonide",
  "fluticasone",
  "tiotropium",
  "theophylline",
  // ─── GI / PPIs are technically OTC in some markets but ──
  //      most Schedule H in India; keep cautious.
  "pantoprazole",
  "omeprazole",
  "esomeprazole",
  "rabeprazole",
  "lansoprazole",
  // ─── Misc high-risk ───────────────────────────────────
  "sildenafil",
  "tadalafil",
  "finasteride",
  "dutasteride",
  "tamsulosin",
];

/**
 * Pure, synchronous classifier: does this medicine name / generic name
 * require a prescription according to our curated Schedule-H list?
 *
 * Accepts either a plain name string OR an object with `name` / `genericName`
 * to cover both seed rows and live Medicine DB rows.
 */
export function isRxRequired(
  input: string | { name?: string | null; genericName?: string | null }
): boolean {
  const haystack = (
    typeof input === "string"
      ? input
      : `${input.name ?? ""} ${input.genericName ?? ""}`
  )
    .toLowerCase()
    .trim();
  if (!haystack) return false;
  for (const needle of RX_REQUIRED_SUBSTRINGS) {
    if (haystack.includes(needle)) return true;
  }
  return false;
}

/**
 * Returns the list of substrings that matched the given medicine name.
 * Used by the remediation script to produce auditable dry-run output.
 */
export function matchingRxSubstrings(
  input: string | { name?: string | null; genericName?: string | null }
): string[] {
  const haystack = (
    typeof input === "string"
      ? input
      : `${input.name ?? ""} ${input.genericName ?? ""}`
  )
    .toLowerCase()
    .trim();
  if (!haystack) return [];
  return RX_REQUIRED_SUBSTRINGS.filter((s) => haystack.includes(s));
}
