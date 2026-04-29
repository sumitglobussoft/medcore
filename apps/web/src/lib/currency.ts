/**
 * Canonical INR (Indian Rupee) currency formatter.
 *
 * Born from issue #298 — currency was rendered three different ways across
 * the app: "Rs. 12345", "₹12,345.00", and "₹12345" (no commas at all). The
 * canonical form is the Indian-locale grouping with the ₹ symbol:
 *
 *     formatINR(123456)      => "₹1,23,456.00"
 *     formatINR(0)           => "₹0.00"
 *     formatINR(99.5)        => "₹99.50"
 *     formatINR(null)        => "—"
 *     formatINR(NaN)         => "—"
 *     formatINR(-12345.6)    => "-₹12,345.60"
 *
 * Defensive (never throws): returns the placeholder em-dash for any
 * unparseable / NaN / null / undefined input so a single bad row can never
 * break a whole page.
 */

const PLACEHOLDER = "—";

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a number as an INR currency string in the canonical Indian-locale
 * grouping ("₹1,23,456.00"). Returns "—" for any input we cannot confidently
 * format.
 *
 * NB: `Intl.NumberFormat("en-IN", { currency: "INR" })` emits the ₹ glyph
 * directly; we don't fall back to "Rs." or "INR" prefixes anywhere.
 */
export function formatINR(value: number | null | undefined): string {
  if (value === null || value === undefined) return PLACEHOLDER;
  if (typeof value !== "number") return PLACEHOLDER;
  if (!Number.isFinite(value)) return PLACEHOLDER;
  return inrFormatter.format(value);
}

/**
 * Variant for places that want to render "₹0" / "—" depending on whether the
 * caller considers zero meaningful. Use sparingly — most surfaces should
 * render "₹0.00" so the column lines up.
 */
export function formatINRorDash(
  value: number | null | undefined,
  treatZeroAsEmpty = false
): string {
  if (value === null || value === undefined) return PLACEHOLDER;
  if (typeof value !== "number" || !Number.isFinite(value)) return PLACEHOLDER;
  if (treatZeroAsEmpty && value === 0) return PLACEHOLDER;
  return inrFormatter.format(value);
}
