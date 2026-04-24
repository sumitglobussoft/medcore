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
  const [loading, setLoading] = useState(false);

  function update(field: string, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
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
      const msg =
        err instanceof Error ? err.message : t("register.error.generic");
      setError(msg);
      toast.error(msg);
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
              className={inputClass}
              placeholder={t("register.fullName.placeholder")}
            />
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
                className={inputClass}
                placeholder="you@example.com"
              />
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
                className={inputClass}
                placeholder={t("register.phone.placeholder")}
              />
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
              className={inputClass}
              placeholder={t("register.password.placeholder")}
            />
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
                min="0"
                max="150"
                value={form.age}
                onChange={(e) => update("age", e.target.value)}
                className={inputClass}
                placeholder={t("register.age.placeholder")}
              />
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
