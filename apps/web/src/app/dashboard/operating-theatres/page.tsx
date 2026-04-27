"use client";

/**
 * Issue #158 — /dashboard/operating-theatres → /dashboard/ot redirect.
 *
 * The canonical Operating Theatre live status board lives at
 * `/dashboard/ot`. UK / US spelling variants (`operating-theatres`,
 * `operating-theaters`) were 404-ing for users who navigated by typing
 * the route or following older bookmarks.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OperatingTheatresRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/ot");
  }, [router]);
  return (
    <div
      className="p-8 text-sm text-gray-500"
      data-testid="operating-theatres-redirect"
    >
      Redirecting to Operating Theatres…
    </div>
  );
}
