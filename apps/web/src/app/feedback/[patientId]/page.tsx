"use client";

import { useState, use } from "react";

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api/v1";

const CATEGORIES = ["DOCTOR", "NURSE", "FOOD", "CLEANLINESS", "OVERALL"];

function StarInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`text-3xl transition ${
            n <= value ? "text-yellow-500" : "text-gray-300"
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

  async function submit() {
    setSubmitting(true);
    setError("");
    try {
      // Submit per category, but API requires auth; we'll call a public submission path.
      // Since the brief says public, we send without token but fall back to error if 401.
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
          throw new Error(
            data.error ||
              "We couldn't record your feedback. Please contact the hospital."
          );
        }
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed");
    }
    setSubmitting(false);
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-blue-50 to-white p-6">
        <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-4xl text-green-600">
            {"\u2713"}
          </div>
          <h1 className="mb-2 text-2xl font-bold text-gray-800">Thank You!</h1>
          <p className="text-gray-600">
            Your feedback has been submitted. We appreciate you helping us
            improve our service.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-white p-6">
      <div className="mx-auto max-w-lg rounded-2xl bg-white p-8 shadow-lg">
        <h1 className="mb-2 text-center text-2xl font-bold text-gray-800">
          How was your visit?
        </h1>
        <p className="mb-6 text-center text-sm text-gray-500">
          Please rate your experience. Your feedback helps us serve you better.
        </p>

        <div className="space-y-5">
          {CATEGORIES.map((cat) => (
            <div key={cat}>
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {cat === "OVERALL" ? "Overall Experience" : cat.charAt(0) + cat.slice(1).toLowerCase()}
              </label>
              <StarInput
                value={ratings[cat]}
                onChange={(n) => setRatings({ ...ratings, [cat]: n })}
              />
            </div>
          ))}

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              How likely are you to recommend us? ({nps}/10)
            </label>
            <input
              type="range"
              min={0}
              max={10}
              value={nps}
              onChange={(e) => setNps(parseInt(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-xs text-gray-500">
              <span>Not likely</span>
              <span>Very likely</span>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">
              Additional comments (optional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              placeholder="Share anything else you'd like us to know..."
              className="w-full rounded-lg border px-3 py-2 text-sm"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-600">
              {error}
            </p>
          )}

          <button
            onClick={submit}
            disabled={submitting}
            className="w-full rounded-lg bg-primary py-3 text-sm font-medium text-white hover:bg-primary-dark disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Submit Feedback"}
          </button>
        </div>
      </div>
    </div>
  );
}
