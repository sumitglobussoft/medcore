"use client";

/**
 * Issue #144 — /dashboard/blood-bank → /dashboard/bloodbank redirect stub.
 *
 * The canonical Blood Bank page lives at `/dashboard/bloodbank` (no
 * hyphen) but multiple help links and external bookmarks expected the
 * hyphenated variant and were 404-ing with no app shell. We forward the
 * hyphenated path to the canonical one client-side via `router.replace`
 * so the dashboard shell still wraps the page (no flash 404).
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BloodBankHyphenRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/bloodbank");
  }, [router]);
  return (
    <div
      className="p-8 text-sm text-gray-500"
      data-testid="blood-bank-redirect"
    >
      Redirecting to Blood Bank…
    </div>
  );
}
