export const DEFAULT_SLOT_DURATION_MINUTES = 15;
export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;
export const TOKEN_EXPIRY = "24h";
export const REFRESH_TOKEN_EXPIRY = "7d";
export const MR_NUMBER_PREFIX = "MR";
export const INVOICE_NUMBER_PREFIX = "INV";

export const CONSULTATION_CATEGORIES = [
  "Consultation Fee",
  "Procedure",
  "Medicine",
  "Lab Test",
  "Other",
] as const;

export const FREQUENCY_OPTIONS = [
  "1-0-0 (Morning)",
  "0-1-0 (Afternoon)",
  "0-0-1 (Night)",
  "1-1-0 (Morning-Afternoon)",
  "1-0-1 (Morning-Night)",
  "0-1-1 (Afternoon-Night)",
  "1-1-1 (Three times)",
  "SOS (As needed)",
] as const;
