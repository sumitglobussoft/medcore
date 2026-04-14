"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/store";
import { useTranslation } from "@/lib/i18n";
import { LanguageDropdown } from "@/components/LanguageDropdown";
import { toast } from "@/lib/toast";

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuthStore();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(email, password);
      toast.success("Welcome back!");
      router.push("/dashboard");
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("login.error.generic");
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-950">
      <div className="fixed right-4 top-4">
        <LanguageDropdown />
      </div>
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl dark:bg-gray-800">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-primary">{t("app.name")}</h1>
          <p className="mt-2 text-gray-500 dark:text-gray-400">
            {t("app.tagline")}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5" aria-label="Login form">
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
              htmlFor="login-email"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
            >
              {t("login.email")}
            </label>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              placeholder={t("login.email.placeholder")}
            />
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200"
            >
              {t("login.password")}
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              placeholder={t("login.password.placeholder")}
            />
          </div>

          <div className="flex justify-end">
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded"
            >
              {t("login.forgot")}
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-primary py-2.5 font-medium text-white transition hover:bg-primary-dark disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            {loading ? t("login.submit.loading") : t("login.submit")}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {t("login.newPatient")}{" "}
          <Link
            href="/register"
            className="font-medium text-primary hover:underline focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded"
          >
            {t("login.register")}
          </Link>
        </p>

        <div className="mt-4 rounded-lg bg-gray-50 p-4 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
          <p className="font-medium">Demo Accounts:</p>
          <p>Admin: admin@medcore.local / admin123</p>
          <p>Doctor: dr.sharma@medcore.local / doctor123</p>
          <p>Reception: reception@medcore.local / reception123</p>
          <p>Nurse: nurse@medcore.local / nurse123</p>
        </div>
      </div>
    </div>
  );
}
