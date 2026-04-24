"use client";

import { forwardRef, useCallback, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";

/**
 * Shared password input with a built-in show/hide eye-icon toggle.
 *
 * Issue #2: every `<input type="password">` in the app was missing a
 * reveal-password affordance, which meant users on mobile keyboards or with
 * long/complex passwords had no way to verify what they'd typed. This
 * component wraps the input + toggle so every password field in MedCore
 * gets the same behaviour, a11y semantics, and `data-testid` hook.
 *
 * Behaviour contract:
 *  - Renders `<input type="password">` by default; click the eye icon to
 *    swap to `type="text"`, click again to mask.
 *  - The toggle button is `type="button"` so it NEVER submits the
 *    surrounding form (a common regression on password fields).
 *  - `aria-label` on the toggle updates between "Show password" and
 *    "Hide password" (EN + Hindi via i18n) so screen readers announce
 *    the current state correctly.
 *  - `aria-pressed` mirrors the revealed state for AT that prefer it.
 *  - If a `hint` string is provided we render it as a `<p>` below the
 *    input and wire `aria-describedby` on the input itself.
 *  - Passes through every other `<input>` prop (value, onChange, name,
 *    required, autoComplete, placeholder, minLength, maxLength, …) so
 *    callers can drop this in as a direct replacement for their old
 *    `<input type="password">` without losing functionality.
 *
 * Uses `lucide-react` icons which already ship in the web bundle — no
 * new dependencies added (per task rules).
 */
export interface PasswordInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Optional helper text rendered below the input and linked via aria-describedby. */
  hint?: string;
  /** Optional className applied to the outer wrapper (default handles positioning). */
  wrapperClassName?: string;
  /** Optional data-testid for the input itself. Toggle always uses "password-toggle". */
  "data-testid"?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput(
    {
      hint,
      wrapperClassName,
      className,
      id,
      "aria-describedby": ariaDescribedBy,
      "data-testid": dataTestId,
      ...rest
    },
    ref
  ) {
    const { t } = useTranslation();
    const [visible, setVisible] = useState(false);
    const autoId = useId();
    const inputId = id ?? `password-input-${autoId}`;
    const hintId = hint ? `${inputId}-hint` : undefined;

    // Combine caller-supplied describedby with our hint id.
    const describedBy =
      [ariaDescribedBy, hintId].filter(Boolean).join(" ") || undefined;

    const toggle = useCallback(() => setVisible((v) => !v), []);

    // Reserve space on the right for the toggle so long values don't run
    // under the icon. `pr-10` ≈ 2.5rem, matching the 40px hit target.
    const inputClass = [
      "w-full pr-10",
      className ?? "",
    ]
      .join(" ")
      .trim();

    const toggleLabel = visible
      ? t("passwordInput.hide", "Hide password")
      : t("passwordInput.show", "Show password");

    return (
      <div className={wrapperClassName ?? "relative"}>
        <input
          {...rest}
          ref={ref}
          id={inputId}
          type={visible ? "text" : "password"}
          aria-describedby={describedBy}
          data-testid={dataTestId}
          className={inputClass}
        />
        <button
          type="button"
          onClick={toggle}
          aria-label={toggleLabel}
          aria-pressed={visible}
          title={toggleLabel}
          tabIndex={0}
          data-testid="password-toggle"
          className="absolute inset-y-0 right-0 flex items-center justify-center px-3 text-gray-500 hover:text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-0 dark:text-gray-400 dark:hover:text-gray-200"
        >
          {visible ? (
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          ) : (
            <Eye className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        {hint ? (
          <p
            id={hintId}
            className="mt-1 text-xs text-gray-500 dark:text-gray-400"
          >
            {hint}
          </p>
        ) : null}
      </div>
    );
  }
);
