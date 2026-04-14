"use client";

import { useState, use } from "react";
import { useTranslation } from "@/lib/i18n";
import { LanguageDropdown } from "@/components/LanguageDropdown";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

const CATEGORIES = ["DOCTOR", "NURSE", "FOOD", "CLEANLINESS", "OVERALL"];

function StarInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex gap-1" role="radiogroup" aria-label={ariaLabel}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={n === value}
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          onClick={() => onChange(n)}
          className={`text-3xl transition focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 rounded ${
            n <= value ? "text-yellow-500" : "text-gray-300 dark:text-gray-600"
          }`}
        >
          {"\u2605"}
        </button>
      ))}
    </div>
  );
}

export default function PublicFeedbackPage({
  params,
}: {
  params: Promise<{ patientId: string }>;
}) {
  const { patientId } = use(params);
  const { t } = useTranslation();
  const [ratings, setRatings] = useState<Record<string, number>>({
    DOCTOR: 0,
    NURSE: 0,
    FOOD: 0,
    CLEANLINESS: 0,
    OVERALL: 0,
  });
  const [nps, setNps] = useState(7);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function catLabel(cat: string): string {
    return t(`feedback.cat.${cat.toLowerCase()}`, cat);
  }

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      for (const cat of CATEGORIES) {
        if (ratings[cat] === 0) continue;
        const res = await fetch(`${API_BASE}/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patientId,
            category: cat,
            rating: ratings[cat],
            nps: cat === "OVERALL" ? nps : undefined,
            comment: cat === "OVERALL" ? comment : undefined,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || t("feedback.error"));
        }
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("feedback.error"));
    }
    setSubmitting(false);
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-white p-6 dark:from-gray-900 dark:to-gray-950">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg dark:bg-gray-800">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-4xl text-green-600 dark:bg-green-900/30">
            {"\u2713"}
          </div>
          <h1 className="mb-2 text-2xl font-bold text-gray-800 dark:text-gray-100">
            {t("feedback.thankYou")}
          </h1>
          <p className="text-gray-600 dark:text-gray-300">
            {t("feedback.thankYou.body")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white p-6 dark:from-gray-900 dark:to-gray-950">
      <div className="mx-auto mb-4 max-w-lg flex justify-end">
        <LanguageDropdown />
      </div>
      <div className="mx-auto max-w-lg rounded-2xl bg-white p-8 shadow-lg dark:bg-gray-800">
        <h1 className="mb-2 text-center text-2xl font-bold text-gray-800 dark:text-gray-100">
          {t("feedback.title")}
        </h1>
        <p className="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {t("feedback.subtitle")}
        </p>

        <div className="space-y-5">
          {CATEGORIES.map((cat) => (
            <div key={cat}>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200">
                {catLabel(cat)}
              </label>
              <StarInput
                value={ratings[cat]}
                onChange={(n) => setRatings({ ...ratings, [cat]: n })}
                ariaLabel={catLabel(cat)}
              />
            </div>
          ))}

          <div>
            <label
              htmlFor="nps-range"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200"
            >
              {t("feedback.nps")} ({nps}/10)
            </label>
            <input
              id="nps-range"
              type="range"
              min={0}
              max={10}
              value={nps}
              onChange={(e) => setNps(parseInt(e.target.value))}
              className="w-full accent-primary"
              aria-valuemin={0}
              aria-valuemax={10}
              aria-valuenow={nps}
            />
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>{t("feedback.nps.low")}</span>
              <span>{t("feedback.nps.high")}</span>
            </div>
          </div>

          <div>
            <label
              htmlFor="fb-comment"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-200"
            >
              {t("feedback.comments")}
            </label>
            <textarea
              id="fb-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder={t("feedback.comments.placeholder")}
              className="w-full rounded-lg border px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-lg bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300"
            >
              {error}
            </p>
          )}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full rounded-lg bg-primary py-3 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
          >
            {submitting ? t("feedback.submit.loading") : t("feedback.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
