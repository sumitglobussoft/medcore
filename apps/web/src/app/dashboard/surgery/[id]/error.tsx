"use client";

// Issue #86 (Apr 2026): the surgery detail page would surface as an RSC 503
// when an unhandled error escaped React render — usually a null deref on
// `surgery.ot.dailyRate.toFixed(...)` or a stale fetch returning a partial
// object. This boundary keeps the dashboard chrome alive and gives the user
// a Retry button instead of a hard 503 page.

import { useEffect } from "react";
import Link from "next/link";

export default function SurgeryDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Forward to console so the dev server logs still capture the stack.
    console.error("[surgery/[id]/error]", error);
  }, [error]);

  return (
    <div
      data-testid="surgery-detail-error"
      role="alert"
      className="rounded-xl bg-white p-8 shadow-sm"
    >
      <h2 className="mb-2 text-lg font-semibold text-red-700">
        Could not load this surgery
      </h2>
      <p className="mb-4 text-sm text-gray-600">
        {error.message || "An unexpected error occurred while rendering this page."}
      </p>
      {error.digest && (
        <p className="mb-4 text-xs text-gray-400">Reference: {error.digest}</p>
      )}
      <div className="flex gap-2">
        <button
          onClick={reset}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
        >
          Retry
        </button>
        <Link
          href="/dashboard/surgery"
          className="rounded-lg border px-4 py-2 text-sm hover:bg-gray-50"
        >
          Back to Surgery
        </Link>
      </div>
    </div>
  );
}
