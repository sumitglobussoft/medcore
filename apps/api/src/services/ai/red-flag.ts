// Deterministic red-flag detection — runs BEFORE and independent of the LLM
// High-recall bias: better to have a false positive than miss an emergency.

const RED_FLAG_PATTERNS: { pattern: RegExp; reason: string }[] = [
  // Cardiac
  { pattern: /\b(chest pain|chest tightness|heart attack|cardiac arrest|crushing chest)\b/i, reason: "Possible acute cardiac event" },
  { pattern: /\b(pain.*radiating.*arm|arm.*pain.*chest|jaw.*pain)\b/i, reason: "Possible acute MI — radiating chest pain" },
  // Neurological
  { pattern: /\b(stroke|face.*droop|facial droop|arm.*weak|sudden.*speech|can't speak|slurred speech)\b/i, reason: "Possible stroke (FAST signs)" },
  { pattern: /\b(sudden.*headache|worst headache|thunderclap headache)\b/i, reason: "Possible subarachnoid haemorrhage" },
  { pattern: /\b(seizures?|convulsions?|fitting|fits)\b/i, reason: "Active seizure" },
  { pattern: /\b(unconscious|unresponsive|fainted|passed out|loss of consciousness)\b/i, reason: "Loss of consciousness" },
  // Respiratory
  { pattern: /\b(can't breathe|cannot breathe|difficulty breathing|not breathing|breathless|severe breathlessness)\b/i, reason: "Severe respiratory distress" },
  { pattern: /\b(choking|foreign body|airway)\b/i, reason: "Possible airway obstruction" },
  // Bleeding
  { pattern: /\b(heavy bleeding|severe bleeding|bleeding.*stop|won't stop bleeding|blood.*gushing)\b/i, reason: "Severe haemorrhage" },
  { pattern: /\b(vomiting blood|coughing blood|blood in stool)\b/i, reason: "Haematemesis / haematochezia" },
  // Allergic
  { pattern: /\b(anaphylaxis|anaphylactic|severe allergy.*reaction|throat.*swelling|lips.*swelling)\b/i, reason: "Possible anaphylaxis" },
  // Mental health
  { pattern: /\b(suicid\w*|want to die|kill myself|self.?harm|end my life)\b/i, reason: "Suicidal ideation — immediate support needed" },
  // Obstetric
  { pattern: /\b(pregnancy.*bleed|bleed.*pregnancy|eclampsia|fitting.*pregnant|water.*broken.*pain)\b/i, reason: "Obstetric emergency" },
  // Neonatal
  { pattern: /\b(newborn.*not breathing|baby.*not breathing|infant.*blue|neonatal.*distress)\b/i, reason: "Neonatal emergency" },
  // Hindi patterns
  { pattern: /\b(seene mein dard|dil ka dora|sans nahi|behoshi|khoon aa raha)\b/i, reason: "Emergency symptom detected (Hindi)" },
];

export interface RedFlagResult {
  detected: boolean;
  reason?: string;
}

export function checkRedFlags(text: string): RedFlagResult {
  for (const { pattern, reason } of RED_FLAG_PATTERNS) {
    if (pattern.test(text)) {
      return { detected: true, reason };
    }
  }
  return { detected: false };
}

export function buildEmergencyResponse(reason: string, hospitalPhone?: string): string {
  const phone = hospitalPhone || "112";
  return `🚨 **EMERGENCY ALERT**

Based on what you've described, this may be a medical emergency that requires IMMEDIATE attention.

**Please do one of the following RIGHT NOW:**
- Call emergency services: **${phone}**
- Go to the nearest Emergency Department immediately
- Have someone take you to the hospital now

**Do not wait for an appointment.**

${reason ? `Reason: ${reason}` : ""}

---
*This AI booking assistant cannot help with emergencies. Please seek immediate medical care.*`;
}
