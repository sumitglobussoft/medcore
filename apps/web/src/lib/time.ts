/**
 * Shared time-arithmetic helpers for user-facing displays.
 *
 * Born from issues #92 / #162 / #163 — multiple pages were independently
 * calculating "elapsed minutes since X" with the naive
 * `(Date.now() - new Date(x).getTime()) / 60000` formula. That blows up on
 * legacy data:
 *
 *   - Year-2000 sentinel timestamps → ~25,000+ minute readings ("17 days")
 *   - Future timestamps (clock skew) → negative minutes
 *   - `null` / `undefined` / "" / "Invalid Date" → NaN propagated to the UI
 *
 * The helpers below clamp every reading into a sane window and return 0 for
 * any garbage input. UI call sites should still skip rendering when the
 * source row has no real start time, but defence-in-depth is cheap.
 */
import { formatDate as _formatDate, formatDateTime as _formatDateTime } from "./format";

/** Smallest reasonable timestamp — anything before this is treated as a sentinel. */
const SENTINEL_CUTOFF_MS = new Date("2010-01-01T00:00:00Z").getTime();

/**
 * Compute completed minutes between `startAt` and `endAt`, clamped to
 * `[0, now - startAt]` so legacy year-2000 sentinel rows can never produce
 * absurd "19,500 minutes" elapsed readings.
 *
 * Behaviour:
 *  - `startAt` null/invalid/future-of-now → returns 0
 *  - `startAt` predates the sentinel cutoff (1970/2000) → returns 0
 *  - `endAt` null → uses `Date.now()` (live "elapsed since arrival")
 *  - `endAt` invalid or earlier than `startAt` → falls back to `Date.now()`
 *  - Result is rounded to the nearest minute and never negative.
 */
export function elapsedMinutes(
  startAt: string | number | Date | null | undefined,
  endAt: string | number | Date | null | undefined = null
): number {
  if (startAt === null || startAt === undefined || startAt === "") return 0;
  const startMs =
    startAt instanceof Date ? startAt.getTime() : new Date(startAt).getTime();
  if (!Number.isFinite(startMs)) return 0;
  if (startMs < SENTINEL_CUTOFF_MS) return 0;

  const now = Date.now();
  if (startMs > now) return 0; // future timestamp — clock skew

  let endMs: number;
  if (endAt === null || endAt === undefined || endAt === "") {
    endMs = now;
  } else {
    const parsed =
      endAt instanceof Date ? endAt.getTime() : new Date(endAt).getTime();
    if (!Number.isFinite(parsed) || parsed < startMs || parsed < SENTINEL_CUTOFF_MS) {
      endMs = now;
    } else {
      endMs = parsed;
    }
  }
  const span = Math.max(0, Math.min(endMs - startMs, now - startMs));
  return Math.round(span / 60000);
}

/**
 * Render minutes-elapsed in a human form: "12m", "2h 5m", "3d 4h".
 * Bounds the rendered string at 7 days (anything older shows "7d+") so a
 * stale row still renders sanely.
 */
export function formatElapsed(min: number): string {
  if (!Number.isFinite(min) || min < 0) return "0m";
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  const rem = min % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days >= 7) return "7d+";
  const remH = hours % 24;
  return remH ? `${days}d ${remH}h` : `${days}d`;
}

/**
 * Defensive, never-throws date renderer. Alias of {@link _formatDate} but
 * exported under the name many components used pre-consolidation. New code
 * should prefer {@link _formatDate} from `./format`.
 */
export function safeDate(
  value: string | number | Date | null | undefined,
  locale?: string
): string {
  return _formatDate(value, locale);
}

export { _formatDate as formatDate, _formatDateTime as formatDateTime };
