"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/store";
import { useTranslation } from "@/lib/i18n";
import { LanguageDropdown } from "@/components/LanguageDropdown";
import { PasswordInput } from "@/components/PasswordInput";
import { toast } from "@/lib/toast";
// Issue #130: surface ALL zod validation errors at once (one inline span per
// field via data-testid="error-{field}") instead of toasting only the first.
import { extractFieldErrors, type FieldErrorMap } from "@/lib/field-errors";

export default function RegisterPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    gender: "MALE",
    age: "",
    address: "",
  });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrorMap>({});
  const [loading, setLoading] = useState(false);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
    // Issue #130: clear the per-field error as soon as the user edits the
    // input — keeps the inline span in sync with the new value without
    // forcing a server round-trip.
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function validateClient(): FieldErrorMap {
    const errs: FieldErrorMap = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!form.email.trim()) errs.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      errs.email = "Enter a valid email address";
    const digits = form.phone.replace(/\D/g, "");
    if (!form.phone.trim()) errs.phone = "Phone number is required";
    else if (digits.length < 10 || digits.length > 13)
      errs.phone = "Enter a valid 10-digit phone";
    if (!form.password) errs.password = "Password is required";
    else if (form.password.length < 6)
      errs.password = "Password must be at least 6 characters";
    if (form.age) {
      const n = parseInt(form.age, 10);
      // Issue #167 (Apr 2026): self-registration is the adult path.
      // Newborns can't sign themselves up — guard against the
      // empty-input-coerces-to-0 silent failure.
      if (Number.isNaN(n) || n < 1 || n > 150)
        errs.age = "Enter a valid age between 1 and 150";
    }
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    // Issue #130: run client validation against ALL fields up front so the
    // user sees every problem at once, not just the first to trip zod on
    // the server.
    const clientErrs = validateClient();
    if (Object.keys(clientErrs).length > 0) {
      setFieldErrors(clientErrs);
      return;
    }
    setFieldErrors({});
    setLoading(true);

    try {
      await api.post("/auth/register", {
        name: form.name,
        email: form.email,
        phone: form.phone,
        password: form.password,
        gender: form.gender,
        age: form.age ? parseInt(form.age) : undefined,
        address: form.address || undefined,
        role: "PATIENT",
      });

      await login(form.email, form.password);
      toast.success("Registered successfully");
      router.push("/dashboard");
    } catch (err) {
      // Issue #130: server-side zod errors are returned as
      // { details: [{ field, message }] }. Render every field's message
      // inline rather than blanket-toasting only the first.
      const fields = extractFieldErrors(err);
      if (fields) {
        setFieldErrors(fields);
      } else {
        const msg =
          err instanceof Error ? err.message : t("register.error.generic");
        setError(msg);
        toast.error(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    "w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100";

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-950">
      <div className="fixed right-4 top-4">
        <LanguageDropdown />
      </div>
      <div className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-xl dark:bg-gray-800">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary">{t("app.name")}</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            {t("register.title")}
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
          aria-label="Registration form"
          // Issue #130 / #102: suppress browser native tooltips so all
          // validation feedback lives inline below each input.
          noValidate
        >
          {error && (
            <div
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-danger dark:bg-red-900/30 dark:text-red-300"
            >
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="reg-name"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
            >
              {t("register.fullName")}
            </label>
            <input
              id="reg-name"
              type="text"
              required
              autoComplete="name"
              value={form.name}
              onChange={(e) => update("name", e.target.value)}
              className={
                fieldErrors.name
                  ? inputClass.replace("border-gray-300", "border-red-500")
                  : inputClass
              }
              placeholder={t("register.fullName.placeholder")}
              aria-invalid={!!fieldErrors.name}
              aria-describedby={fieldErrors.name ? "reg-name-err" : undefined}
            />
            {fieldErrors.name && (
              <p
                id="reg-name-err"
                data-testid="error-name"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {fieldErrors.name}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="reg-email"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
              >
                {t("register.email")}
              </label>
              <input
                id="reg-email"
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
                className={
                  fieldErrors.email
                    ? inputClass.replace("border-gray-300", "border-red-500")
                    : inputClass
                }
                placeholder="you@example.com"
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? "reg-email-err" : undefined}
              />
              {fieldErrors.email && (
                <p
                  id="reg-email-err"
                  data-testid="error-email"
                  className="mt-1 text-xs text-red-600 dark:text-red-400"
                >
                  {fieldErrors.email}
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="reg-phone"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
              >
                {t("register.phone")}
              </label>
              <input
                id="reg-phone"
                type="tel"
                required
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
                className={
                  fieldErrors.phone
                    ? inputClass.replace("border-gray-300", "border-red-500")
                    : inputClass
                }
                placeholder={t("register.phone.placeholder")}
                aria-invalid={!!fieldErrors.phone}
                aria-describedby={fieldErrors.phone ? "reg-phone-err" : undefined}
              />
              {fieldErrors.phone && (
                <p
                  id="reg-phone-err"
                  data-testid="error-phone"
                  className="mt-1 text-xs text-red-600 dark:text-red-400"
                >
                  {fieldErrors.phone}
                </p>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="reg-password"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
            >
              {t("register.password")}
            </label>
            <PasswordInput
              id="reg-password"
              required
              autoComplete="new-password"
              minLength={6}
              value={form.password}
              onChange={(e) => update("password", e.target.value)}
              className={
                fieldErrors.password
                  ? inputClass.replace("border-gray-300", "border-red-500")
                  : inputClass
              }
              placeholder={t("register.password.placeholder")}
              aria-invalid={!!fieldErrors.password}
              aria-describedby={
                fieldErrors.password ? "reg-password-err" : undefined
              }
            />
            {fieldErrors.password && (
              <p
                id="reg-password-err"
                data-testid="error-password"
                className="mt-1 text-xs text-red-600 dark:text-red-400"
              >
                {fieldErrors.password}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="reg-gender"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
              >
                {t("register.gender")}
              </label>
              <select
                id="reg-gender"
                value={form.gender}
                onChange={(e) => update("gender", e.target.value)}
                className={inputClass}
              >
                <option value="MALE">{t("register.gender.male")}</option>
                <option value="FEMALE">{t("register.gender.female")}</option>
                <option value="OTHER">{t("register.gender.other")}</option>
              </select>
            </div>
            <div>
              <label
                htmlFor="reg-age"
                className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
              >
                {t("register.age")}
              </label>
              <input
                id="reg-age"
                type="number"
                min="1"
                max="150"
                value={form.age}
                onChange={(e) => update("age", e.target.value)}
                className={
                  fieldErrors.age
                    ? inputClass.replace("border-gray-300", "border-red-500")
                    : inputClass
                }
                placeholder={t("register.age.placeholder")}
                aria-invalid={!!fieldErrors.age}
                aria-describedby={fieldErrors.age ? "reg-age-err" : undefined}
              />
              {fieldErrors.age && (
                <p
                  id="reg-age-err"
                  data-testid="error-age"
                  className="mt-1 text-xs text-red-600 dark:text-red-400"
                >
                  {fieldErrors.age}
                </p>
              )}
            </div>
          </div>

          <div>
            <label
              htmlFor="reg-address"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
            >
              {t("register.address")}
            </label>
            <input
              id="reg-address"
              type="text"
              autoComplete="street-address"
              value={form.address}
              onChange={(e) => update("address", e.target.value)}
              className={inputClass}
              placeholder={t("register.address.placeholder")}
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            {loading ? t("register.submit.loading") : t("register.submit")}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {t("register.haveAccount")}{" "}
          <Link
            href="/login"
            className="font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded"
          >
            {t("register.signIn")}
          </Link>
        </p>
      </div>
    </div>
  );
}
