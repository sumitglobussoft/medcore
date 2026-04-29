/**
 * Issues #248, #260, #265, #284, #292 (Apr 2026): the form-input XSS cluster.
 *
 * A user could paste raw HTML or `<script>` payloads into name fields on
 * Staff create/edit, the Profile sidebar, the Walk-in patient form, and the
 * Holiday calendar — and the strings persisted, then rendered into other
 * modules (Roster, Payroll, sidebar, etc). The "partial strip" attempt on
 * Holidays was even more dangerous because it left orphaned `alert(1)` text
 * in the DB that looked like a typo.
 *
 * The fix: a single canonical `sanitizeUserInput()` helper used everywhere a
 * user-typed display string is accepted. Strategy is *reject*, not silent
 * scrub — if the input contains `<` `>` or any of the well-known XSS
 * vectors, the caller should reject it with a field-level error rather than
 * mutating the user's typed string. We also expose `containsHtmlOrScript()`
 * for places that just want a guard.
 *
 * Issues #266 + #285 (Apr 2026): the password rule of "8 chars + 1 letter +
 * 1 digit" technically rejects `123456` but accepts `password1`, `admin123`
 * and other classic top-100 leaks. We add a denylist of the 100 most common
 * passwords (curated locally — no external network call) and reject
 * regardless of length/composition.
 */

/**
 * Strip leading/trailing whitespace and collapse runs of internal whitespace.
 * Always safe — used as the *first* normalization before anything else.
 */
export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/**
 * The XSS-vector regex. Matches:
 *   - any `<...>` HTML/SGML tag-like substring
 *   - `javascript:` / `data:` / `vbscript:` URL schemes
 *   - inline event handlers like `onclick=`, `onerror=`
 *   - common HTML entity escapes that decode back into `<` / `>` (`&lt;`,
 *     `&#60;`, `&#x3c;`)
 */
const XSS_PATTERNS: RegExp[] = [
  /<[^>]*>/i, // any tag-shaped substring
  /<\s*\/?\s*script\b/i, // <script>, </script>, < script >
  /javascript:/i,
  /vbscript:/i,
  /data:\s*text\/html/i,
  /\bon\w+\s*=/i, // onclick=, onerror=, etc
  /&(lt|gt|#0*60|#x0*3c|#x0*3e|#0*62);/i,
];

/** Quick predicate — true if the input looks like an XSS attempt. */
export function containsHtmlOrScript(input: string): boolean {
  if (typeof input !== "string") return false;
  return XSS_PATTERNS.some((rx) => rx.test(input));
}

export interface SanitizeOptions {
  /** Default 100 — names, holiday names, etc. */
  maxLength?: number;
  /** Field name to embed in the error message. */
  field?: string;
}

export interface SanitizeResult {
  ok: boolean;
  /** The cleaned string (only set when ok=true). */
  value?: string;
  /** Field-level error message (only set when ok=false). */
  error?: string;
}

/**
 * Canonical user-input sanitizer.
 *
 *   const r = sanitizeUserInput(form.name, { field: "Name" });
 *   if (!r.ok) return setError(r.error);
 *   payload.name = r.value;
 *
 * Returns `{ ok: false, error }` on:
 *   - empty after trim
 *   - longer than `maxLength` (default 100)
 *   - contains any XSS vector (rejects, does NOT scrub)
 *
 * Returns `{ ok: true, value }` with whitespace normalized otherwise.
 */
export function sanitizeUserInput(
  raw: unknown,
  opts: SanitizeOptions = {}
): SanitizeResult {
  const { maxLength = 100, field = "Field" } = opts;
  if (typeof raw !== "string") {
    return { ok: false, error: `${field} is required` };
  }
  const cleaned = normalizeWhitespace(raw);
  if (cleaned.length === 0) {
    return { ok: false, error: `${field} cannot be empty` };
  }
  if (cleaned.length > maxLength) {
    return {
      ok: false,
      error: `${field} must be at most ${maxLength} characters`,
    };
  }
  if (containsHtmlOrScript(cleaned)) {
    return {
      ok: false,
      error: `${field} contains characters that aren't allowed (e.g. < > or HTML tags)`,
    };
  }
  return { ok: true, value: cleaned };
}

/**
 * Issues #266 + #285: curated denylist of the 100 most common passwords
 * (kept in lower-case for O(1) lookup). Includes `password1`, `admin123`,
 * `qwerty`, every "12345…" run that fits in 8+, and the ironic ones.
 *
 * Curated — NOT fetched at runtime. Adding from external network on every
 * password change would be an availability dependency we don't want.
 */
export const COMMON_PASSWORD_DENYLIST: ReadonlySet<string> = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "11111111",
  "22222222",
  "00000000",
  "abcdefgh",
  "abcdefghi",
  "qwertyui",
  "qwertyuiop",
  "asdfghjk",
  "asdfghjkl",
  "zxcvbnm1",
  "password",
  "password1",
  "password12",
  "password123",
  "password1234",
  "passw0rd",
  "p@ssword",
  "p@ssw0rd",
  "letmein1",
  "letmein123",
  "welcome1",
  "welcome123",
  "iloveyou",
  "iloveyou1",
  "iloveyou2",
  "monkey123",
  "dragon123",
  "football",
  "football1",
  "baseball",
  "baseball1",
  "basketball",
  "superman1",
  "batman123",
  "spiderman1",
  "starwars",
  "starwars1",
  "trustno1",
  "abc12345",
  "abc123456",
  "qwerty123",
  "qwerty1234",
  "qwerty12",
  "qwertyqwerty",
  "qazwsx12",
  "qazwsxedc",
  "zaq12wsx",
  "1qaz2wsx",
  "1q2w3e4r",
  "1q2w3e4r5t",
  "1qazxsw2",
  "admin123",
  "admin1234",
  "admin12345",
  "administrator",
  "administrator1",
  "root1234",
  "root12345",
  "rootroot",
  "toor1234",
  "toortoor",
  "default1",
  "default123",
  "changeme",
  "changeme1",
  "changeme123",
  "secret123",
  "secret12",
  "master123",
  "master12",
  "michael1",
  "michael123",
  "jennifer1",
  "jordan123",
  "harley123",
  "ranger123",
  "hunter123",
  "buster12",
  "shadow12",
  "shadow123",
  "matrix123",
  "freedom1",
  "freedom123",
  "summer123",
  "winter123",
  "spring123",
  "autumn123",
  "sunshine1",
  "princess1",
  "princess123",
  "hospital1",
  "hospital123",
  "medcore12",
  "medcore123",
  "doctor123",
  "patient123",
  "nurse1234",
  "reception1",
  "clinic123",
  "clinic1234",
  "test1234",
  "test12345",
  "demo1234",
  "demo12345",
  "guest1234",
  "abcd1234",
  "abcd12345",
  "passw0rd1",
  "passw0rd123",
]);

/** True iff the password (case-insensitive) is in the common-leak list. */
export function isCommonPassword(pw: string): boolean {
  if (typeof pw !== "string") return false;
  return COMMON_PASSWORD_DENYLIST.has(pw.toLowerCase());
}

/**
 * The unified password-strength check used by:
 *   - /auth/register
 *   - /auth/change-password
 *   - admin "create user" / "reset password" flows
 *
 * Rule:
 *   1. ≥ 8 characters
 *   2. ≥ 1 letter AND ≥ 1 digit
 *   3. NOT in the common-password denylist
 */
export interface PasswordValidationResult {
  ok: boolean;
  error?: string;
}

export function validatePasswordStrength(pw: string): PasswordValidationResult {
  if (typeof pw !== "string" || pw.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters" };
  }
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    return {
      ok: false,
      error: "Password must contain at least one letter and one digit",
    };
  }
  if (isCommonPassword(pw)) {
    return {
      ok: false,
      error:
        "This password is too common — please choose a less predictable password",
    };
  }
  return { ok: true };
}
