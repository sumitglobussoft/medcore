export type AITriageStatus = "ACTIVE" | "COMPLETED" | "ABANDONED" | "EMERGENCY_DETECTED";
export type AIScribeStatus = "ACTIVE" | "PAUSED" | "COMPLETED" | "CONSENT_WITHDRAWN";

export interface TriageMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface SymptomCapture {
  chiefComplaint: string;
  onset?: string;
  duration?: string;
  severity?: number; // 1-10
  location?: string;
  aggravatingFactors?: string[];
  relievingFactors?: string[];
  associatedSymptoms?: string[];
  relevantHistory?: string;
  currentMedications?: string[];
  knownAllergies?: string[];
  age?: number;
  gender?: string;
  isForDependent?: boolean;
  dependentRelationship?: string;
}

export interface SpecialtySuggestion {
  specialty: string;
  subSpecialty?: string;
  confidence: number; // 0-1
  reasoning: string;
}

export interface DoctorSuggestion {
  doctorId: string;
  name: string;
  specialty: string;
  qualification?: string;
  photoUrl?: string;
  yearsOfExperience?: number;
  languages?: string[];
  rating?: number;
  nextSlots: { date: string; startTime: string; endTime: string }[];
  consultationFee?: number;
  consultationMode: "IN_PERSON" | "VIDEO" | "BOTH";
  reasoning: string;
}

export interface PreVisitSummary {
  chiefComplaint: string;
  hpi: string;
  redFlagsNoted: string[];
  confidence: number;
  language: string;
  transcriptSummary: string;
  capturedAt: string;
}

export interface SOAPNote {
  subjective: {
    chiefComplaint: string;
    hpi: string;
    pastMedicalHistory?: string;
    medications?: string[];
    allergies?: string[];
    socialHistory?: string;
    familyHistory?: string;
  };
  objective: {
    vitals?: string;
    examinationFindings?: string;
  };
  assessment: {
    impression: string;
    icd10Codes?: { code: string; description: string; confidence: number; evidenceSpan?: string }[];
  };
  plan: {
    medications?: { name: string; dose: string; frequency: string; duration: string; notes?: string }[];
    investigations?: string[];
    procedures?: string[];
    referrals?: string[];
    followUpTimeline?: string;
    patientInstructions?: string;
  };
}

export interface TranscriptEntry {
  speaker: "DOCTOR" | "PATIENT" | "ATTENDANT" | "UNKNOWN";
  text: string;
  timestamp: string;
  confidence?: number;
}

export interface DrugInteractionAlert {
  drug1: string;
  drug2: string;
  severity: "MILD" | "MODERATE" | "SEVERE" | "CONTRAINDICATED";
  description: string;
}
