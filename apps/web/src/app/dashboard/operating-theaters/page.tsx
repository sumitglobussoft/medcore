"use client";

/**
 * Issue #158 — /dashboard/operating-theaters → /dashboard/ot redirect.
 * US-spelling sibling of /dashboard/operating-theatres. See that page
 * for the full rationale.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function OperatingTheatersRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/ot");
  }, [router]);
  return (
    <div
      className="p-8 text-sm text-gray-500"
      data-testid="operating-theaters-redirect"
    >
      Redirecting to Operating Theatres…
    </div>
  );
}
