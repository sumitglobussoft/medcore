/**
 * Helpers for surfacing per-field zod validation errors returned by the
 * MedCore API.
 *
 * The backend (apps/api/src/middleware/error.ts) maps `ZodError` to:
 *   { error: "Validation failed", details: [{ field, message }] }
 *
 * `extractFieldErrors` turns that flat list into a `{ field: message }` map
 * that pages can consume to render `<p data-testid="error-foo">…</p>` hints
 * below each input. If the error wasn't a validation error, returns null so
 * the caller can fall back to a generic toast.
 */
export interface ApiErrorLike {
  payload?: unknown;
  message?: string;
  status?: number;
}

export type FieldErrorMap = Record<string, string>;

export function extractFieldErrors(err: unknown): FieldErrorMap | null {
  if (!err || typeof err !== "object") return null;
  const payload = (err as ApiErrorLike).payload as
    | { details?: unknown }
    | undefined;
  const details = payload?.details;
  if (!Array.isArray(details)) return null;
  const out: FieldErrorMap = {};
  for (const d of details) {
    if (
      d &&
      typeof d === "object" &&
      "field" in d &&
      "message" in d &&
      typeof (d as { field: unknown }).field === "string" &&
      typeof (d as { message: unknown }).message === "string"
    ) {
      const f = (d as { field: string }).field;
      const m = (d as { message: string }).message;
      // Keep the first message per field — usually the most specific.
      if (!(f in out)) out[f] = m;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Picks a flat top-line error message suitable for a toast — uses the first
 * field-level message if present, otherwise the generic Error.message.
 */
export function topLineError(err: unknown, fallback = "Request failed"): string {
  const fields = extractFieldErrors(err);
  if (fields) {
    const [first] = Object.values(fields);
    if (first) return first;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
