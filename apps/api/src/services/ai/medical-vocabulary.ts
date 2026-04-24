// PRD §4.5.2 — Medical-vocabulary tuned language model.
//
// Off-the-shelf ASR engines (AssemblyAI, Deepgram, Sarvam) ship general-purpose
// acoustic models that mis-hear drug names (e.g. "amlodipine" → "I'm not a pain"
// on a thick Indian-English accent) and Indian brand names they've never seen.
// Both AssemblyAI (`word_boost` + `boost_param`) and Deepgram (`keywords`) let
// us lean the LM toward a caller-supplied vocabulary without retraining.
//
// This module centralises the vocabulary so both providers consume the same
// word list — the PRD requirement is a single "medical-vocabulary tuned" model,
// not per-vendor ad-hoc lists that drift apart.
//
// Scope:
//   - English-only entries. ASR engines match on English phonetics; a Hindi
//     speaker still says "amoxicillin" and "echocardiogram" in English during a
//     consult (clinician-side vocabulary is almost exclusively English even in
//     code-switched Hindi/Hinglish speech). PRD Phase 2 "regional languages" is
//     about conversational speech capture, NOT translating drug names.
//   - ~300 entries across four categories. Keeping the list bounded matters:
//     AssemblyAI caps `word_boost` at 1000 words and word_boost with too many
//     common words can regress accuracy on the rest of the transcript.
//   - Indian brand names are the differentiator. A generic-only list would
//     work for US transcription but misses "Crocin", "Dolo 650", "Meftal Spas",
//     which are what Indian clinicians actually dictate.
//
// Adding a new term: append to the relevant array below. Duplicates across
// arrays are removed in MEDICAL_WORD_BOOST_LIST, but keep each source array
// deduplicated to make diffs reviewable.

/**
 * ~100 common generic (INN) drug names. Covers the top cardiovascular,
 * antibiotic, analgesic, antidiabetic, and GI drug classes seen in Indian
 * outpatient practice. Capitalised title-case so the list matches both the
 * pharmacy database formatting and the boosted transcript casing.
 */
export const DRUGS_GENERIC: readonly string[] = [
  // Cardiovascular
  "Amlodipine",
  "Atenolol",
  "Atorvastatin",
  "Bisoprolol",
  "Candesartan",
  "Captopril",
  "Carvedilol",
  "Cilnidipine",
  "Clopidogrel",
  "Digoxin",
  "Diltiazem",
  "Enalapril",
  "Felodipine",
  "Furosemide",
  "Hydrochlorothiazide",
  "Irbesartan",
  "Lisinopril",
  "Losartan",
  "Metoprolol",
  "Nebivolol",
  "Nifedipine",
  "Olmesartan",
  "Perindopril",
  "Propranolol",
  "Ramipril",
  "Rosuvastatin",
  "Spironolactone",
  "Telmisartan",
  "Torsemide",
  "Valsartan",
  "Verapamil",
  "Warfarin",
  // Antibiotics
  "Amoxicillin",
  "Azithromycin",
  "Cefixime",
  "Cefpodoxime",
  "Cefuroxime",
  "Ceftriaxone",
  "Ciprofloxacin",
  "Clarithromycin",
  "Clindamycin",
  "Doxycycline",
  "Erythromycin",
  "Levofloxacin",
  "Linezolid",
  "Metronidazole",
  "Nitrofurantoin",
  "Norfloxacin",
  "Ofloxacin",
  "Piperacillin",
  "Tazobactam",
  "Vancomycin",
  // Analgesics / NSAIDs / antipyretics
  "Paracetamol",
  "Ibuprofen",
  "Diclofenac",
  "Aceclofenac",
  "Naproxen",
  "Mefenamic",
  "Ketorolac",
  "Tramadol",
  "Nimesulide",
  "Etoricoxib",
  // Antidiabetics
  "Metformin",
  "Glimepiride",
  "Gliclazide",
  "Glipizide",
  "Pioglitazone",
  "Sitagliptin",
  "Vildagliptin",
  "Teneligliptin",
  "Linagliptin",
  "Empagliflozin",
  "Dapagliflozin",
  "Insulin",
  // GI / PPIs / antiemetics
  "Omeprazole",
  "Pantoprazole",
  "Rabeprazole",
  "Esomeprazole",
  "Ranitidine",
  "Famotidine",
  "Ondansetron",
  "Domperidone",
  "Metoclopramide",
  "Loperamide",
  "Sucralfate",
  // Respiratory / antihistamines
  "Salbutamol",
  "Levosalbutamol",
  "Budesonide",
  "Formoterol",
  "Montelukast",
  "Cetirizine",
  "Levocetirizine",
  "Fexofenadine",
  "Chlorpheniramine",
  // CNS / psychiatry / neuro
  "Amitriptyline",
  "Sertraline",
  "Escitalopram",
  "Fluoxetine",
  "Olanzapine",
  "Risperidone",
  "Clonazepam",
  "Alprazolam",
  "Gabapentin",
  "Pregabalin",
  "Phenytoin",
  "Levetiracetam",
  // Endocrine / other
  "Levothyroxine",
  "Prednisolone",
  "Dexamethasone",
  "Hydrocortisone",
] as const;

/**
 * ~80 Indian brand names. These are the SKUs clinicians actually dictate — a
 * generic-only list misses the "Crocin" vs "Calpol" vs "Dolo 650" distinction
 * that matters for the prescription output. Casing matches the manufacturer's
 * registered trademark (e.g. "Dolo 650" with space + number).
 */
export const DRUGS_BRAND_IN: readonly string[] = [
  // Paracetamol brands
  "Crocin",
  "Calpol",
  "Dolo 650",
  "Dolo",
  "Metacin",
  "Pyrigesic",
  "Fepanil",
  // NSAID combos / analgesic brands
  "Combiflam",
  "Brufen",
  "Voveran",
  "Zerodol",
  "Meftal",
  "Meftal Spas",
  "Spasmo Proxyvon",
  "Ultracet",
  "Dynapar",
  "Nise",
  // Cardiovascular brands
  "Telmikind",
  "Telma",
  "Cilacar",
  "Atorva",
  "Rosuvas",
  "Stamlo",
  "Amlopres",
  "Amlong",
  "Losar",
  "Losacar",
  "Concor",
  "Ecosprin",
  "Clopilet",
  "Deplatt",
  "Storvas",
  "Metpure",
  "Metolar",
  // PPI / GI brands
  "Pan-40",
  "Pan-D",
  "Pantocid",
  "Razo",
  "Rantac",
  "Aciloc",
  "Nexpro",
  "Omez",
  "Vomikind",
  "Emeset",
  "Domstal",
  // Antibiotic brands
  "Augmentin",
  "Moxikind",
  "Moxikind CV",
  "Clavam",
  "Azithral",
  "Azee",
  "Taxim",
  "Taxim-O",
  "Ciplox",
  "Zifi",
  "Monocef",
  "Cifran",
  // Antidiabetic brands
  "Glycomet",
  "Glyciphage",
  "Janumet",
  "Zita Met",
  "Istamet",
  "Amaryl",
  "Diamicron",
  // Respiratory / allergy brands
  "Asthalin",
  "Seroflo",
  "Foracort",
  "Budecort",
  "Levolin",
  "Montair",
  "Montek",
  "Allegra",
  "Cetzine",
  "Okacet",
  "Avil",
  // Vitamins / supplements brands commonly prescribed
  "Becosules",
  "Neurobion",
  "Shelcal",
  "Calcimax",
  "Limcee",
  // Thyroid brands
  "Eltroxin",
  "Thyronorm",
] as const;

/**
 * ~60 anatomical terms. Skews toward internal organs and musculoskeletal
 * landmarks dictated during physical exams and procedure notes. Excludes
 * trivial terms ("arm", "leg") that ASR already transcribes correctly.
 */
export const ANATOMY: readonly string[] = [
  // Cardiothoracic
  "myocardium",
  "endocardium",
  "pericardium",
  "atrium",
  "ventricle",
  "aorta",
  "pulmonary artery",
  "vena cava",
  "bronchus",
  "bronchioles",
  "alveoli",
  "pleura",
  "diaphragm",
  "mediastinum",
  // Abdominal / GI
  "esophagus",
  "duodenum",
  "jejunum",
  "ileum",
  "caecum",
  "sigmoid",
  "rectum",
  "pancreas",
  "gallbladder",
  "spleen",
  "peritoneum",
  "mesentery",
  // Genitourinary
  "ureter",
  "urethra",
  "prostate",
  "seminal vesicle",
  "fallopian tube",
  "endometrium",
  "myometrium",
  "cervix",
  // Endocrine
  "thyroid",
  "parathyroid",
  "adrenal",
  "hypothalamus",
  "pituitary",
  // Neuro
  "cerebellum",
  "cerebrum",
  "brainstem",
  "medulla",
  "pons",
  "thalamus",
  "hippocampus",
  "meninges",
  // Musculoskeletal
  "femur",
  "tibia",
  "fibula",
  "humerus",
  "radius",
  "ulna",
  "clavicle",
  "scapula",
  "patella",
  "calcaneus",
  "metacarpal",
  "metatarsal",
  "phalanx",
  "vertebra",
  "sternocleidomastoid",
  "trapezius",
] as const;

/**
 * ~60 common procedures — diagnostic and therapeutic. These are the terms
 * that show up in discharge summaries and referral letters where
 * mis-transcription ("cholecystectomy" → "holy cyst ectomy") causes real harm.
 */
export const PROCEDURES: readonly string[] = [
  // Imaging
  "echocardiogram",
  "electrocardiogram",
  "electroencephalogram",
  "electromyography",
  "mammography",
  "ultrasonography",
  "angiography",
  "venography",
  "cystography",
  "myelography",
  "colonography",
  "sialography",
  // Endoscopy
  "endoscopy",
  "colonoscopy",
  "sigmoidoscopy",
  "bronchoscopy",
  "laryngoscopy",
  "cystoscopy",
  "hysteroscopy",
  "arthroscopy",
  "laparoscopy",
  "thoracoscopy",
  // Cardiac / vascular
  "angioplasty",
  "cardioversion",
  "pacemaker implantation",
  "coronary bypass",
  "pericardiocentesis",
  // Surgical -ectomies and -ostomies
  "appendectomy",
  "cholecystectomy",
  "hysterectomy",
  "mastectomy",
  "thyroidectomy",
  "tonsillectomy",
  "splenectomy",
  "nephrectomy",
  "prostatectomy",
  "colectomy",
  "gastrectomy",
  "oophorectomy",
  "colostomy",
  "ileostomy",
  "tracheostomy",
  "gastrostomy",
  // Thoracic / emergency
  "thoracentesis",
  "paracentesis",
  "intubation",
  "extubation",
  "cricothyroidotomy",
  "lumbar puncture",
  "bone marrow biopsy",
  // OB/Gyn
  "cesarean",
  "episiotomy",
  "dilation and curettage",
  // Orthopaedic
  "arthroplasty",
  "arthrodesis",
  "osteotomy",
  "laminectomy",
  "discectomy",
  // Renal / urology / other
  "dialysis",
  "lithotripsy",
  "vasectomy",
  "circumcision",
] as const;

/**
 * Deduplicated union of all four categories. This is what gets shipped to
 * AssemblyAI as `word_boost` and Deepgram as `keywords`. Dedup happens at
 * module load (once), not per request, so the cost is paid once per process.
 *
 * Dedup is case-insensitive so "Omeprazole" (generic) doesn't collide with
 * "Omez" (brand) but "Amoxicillin" (generic) wouldn't be accidentally listed
 * twice if someone added it to a brand list.
 */
export const MEDICAL_WORD_BOOST_LIST: readonly string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of [...DRUGS_GENERIC, ...DRUGS_BRAND_IN, ...ANATOMY, ...PROCEDURES]) {
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
  }
  return Object.freeze(out);
})();

/**
 * Subset of drugs that clinicians dictate most often. We assign these the
 * maximum boost weight (10 on AssemblyAI's 0-10 scale) because a miss on any
 * of these corrupts the prescription output. Everything else gets a moderate
 * weight so we don't overfit the LM to rare vocabulary at the expense of
 * common English.
 *
 * Source for "most common": top 25 outpatient drugs by volume in Indian
 * pharmacies (paracetamol, amoxicillin, metformin, etc.), cross-referenced
 * against the PRD's example list.
 */
const HIGH_PRIORITY_DRUGS: ReadonlySet<string> = new Set(
  [
    "Paracetamol",
    "Amoxicillin",
    "Azithromycin",
    "Metformin",
    "Atorvastatin",
    "Amlodipine",
    "Telmisartan",
    "Losartan",
    "Omeprazole",
    "Pantoprazole",
    "Ibuprofen",
    "Diclofenac",
    "Ceftriaxone",
    "Ciprofloxacin",
    "Levothyroxine",
    // Popular brands dictated daily
    "Crocin",
    "Dolo 650",
    "Dolo",
    "Combiflam",
    "Pan-40",
    "Augmentin",
    "Azithral",
    "Telma",
    "Stamlo",
    "Glycomet",
  ].map((w) => w.toLowerCase())
);

/**
 * Per-word boost weight. Returns a value in AssemblyAI's 0–10 range; Deepgram's
 * `keywords` parameter accepts a colon-suffixed intensity (`word:2`) that maps
 * naturally onto the same scale after a divide-by-some-constant — callers that
 * target Deepgram can re-scale as needed.
 *
 * Weighting rationale:
 *   - 10 (max) for HIGH_PRIORITY_DRUGS — mis-hears here corrupt prescriptions
 *   - 7 for all other drugs (generic + brand) — still important clinically
 *   - 4 for procedures — moderate; many are long compound words that the
 *     acoustic model handles okay once warmed
 *   - 3 for anatomy — lowest priority; most anatomical terms only affect exam
 *     notes, not medication orders
 *
 * Unknown words return 5 (the midpoint) so calling getBoostWeight on an
 * arbitrary string is always safe and never throws.
 */
export function getBoostWeight(word: string): number {
  if (typeof word !== "string" || word.length === 0) return 5;
  const key = word.toLowerCase();
  if (HIGH_PRIORITY_DRUGS.has(key)) return 10;

  // Build reverse lookup sets once per module load.
  if (!weightCache) {
    weightCache = {
      drugs: new Set(
        [...DRUGS_GENERIC, ...DRUGS_BRAND_IN].map((w) => w.toLowerCase())
      ),
      procedures: new Set(PROCEDURES.map((w) => w.toLowerCase())),
      anatomy: new Set(ANATOMY.map((w) => w.toLowerCase())),
    };
  }

  if (weightCache.drugs.has(key)) return 7;
  if (weightCache.procedures.has(key)) return 4;
  if (weightCache.anatomy.has(key)) return 3;
  return 5;
}

// Lazy-built to avoid paying the allocation cost when the module is imported
// but getBoostWeight is never called (e.g. in code paths that only consume
// MEDICAL_WORD_BOOST_LIST).
let weightCache:
  | { drugs: Set<string>; procedures: Set<string>; anatomy: Set<string> }
  | null = null;
