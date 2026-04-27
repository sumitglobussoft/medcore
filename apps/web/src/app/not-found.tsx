/**
 * Issue #123 — global 404 page with navigation back into the app.
 *
 * Next.js 15 picks up `app/not-found.tsx` for any unmatched route. The
 * default Next 404 leaves the user with no app shell and no obvious way
 * back, so we render a styled card with two CTAs:
 *   • Back to dashboard  (the most common need for a logged-in user)
 *   • Back to home       (for a logged-out / marketing visitor)
 *
 * Server component (no "use client") — Next will statically pre-render
 * this. Both CTAs are plain anchors so they work with JS disabled.
 */

import Link from "next/link";

export default function NotFound() {
  return (
    <div
      data-testid="not-found-page"
      className="flex min-h-[70vh] items-center justify-center bg-gray-50 p-6 dark:bg-gray-950"
    >
      <div className="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-sm dark:bg-gray-900">
        <p className="text-sm font-semibold uppercase tracking-wider text-primary">
          404
        </p>
        <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-gray-100">
          Page not found
        </h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/dashboard"
            data-testid="not-found-dashboard-link"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark"
          >
            Back to dashboard
          </Link>
          <Link
            href="/"
            data-testid="not-found-home-link"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
