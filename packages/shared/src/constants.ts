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

/**
 * Top Indian health insurers for the Insurance Claims dropdown (Issue #82).
 * Source: IRDAI list of standalone + general insurers offering health cover.
 * Free-text was a UX hazard (typos, "MOCK TPA" appearing as the insurer). The
 * Insurer DB table is not yet populated everywhere, so we hardcode this list
 * and expose it from `@medcore/shared`. If/when the `Insurer` table is filled
 * we can switch the bind to `GET /api/v1/insurers?q=`.
 */
export const INDIAN_INSURERS = [
  "Star Health and Allied Insurance",
  "HDFC ERGO General Insurance",
  "ICICI Lombard General Insurance",
  "Bajaj Allianz General Insurance",
  "New India Assurance",
  "Oriental Insurance Company",
  "United India Insurance",
  "National Insurance Company",
  "Niva Bupa Health Insurance",
  "Care Health Insurance",
  "ManipalCigna Health Insurance",
  "Aditya Birla Health Insurance",
  "SBI General Insurance",
  "Tata AIG General Insurance",
  "Reliance General Insurance",
] as const;
