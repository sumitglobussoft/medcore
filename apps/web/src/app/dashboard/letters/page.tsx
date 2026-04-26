"use client";

/**
 * Issue #83: legacy `/dashboard/letters` URL — redirects to the renamed
 * `/dashboard/ai-letters` so existing bookmarks don't 404.
 *
 * Use a client-side replace (not a `redirect()` from next/navigation) so the
 * browser history doesn't get a back-button bounce loop. The redirect is
 * idempotent — if the user is already on /ai-letters, this page never
 * renders.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function LegacyLettersRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/ai-letters");
  }, [router]);
  return (
    <div
      className="p-8 text-sm text-gray-500"
      data-testid="legacy-letters-redirect"
    >
      Redirecting to AI Letters…
    </div>
  );
}
