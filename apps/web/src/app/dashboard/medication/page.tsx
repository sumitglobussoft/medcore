"use client";

/**
 * Issue #136 — /dashboard/medication → /dashboard/medication-dashboard
 * redirect stub. The canonical page is `medication-dashboard`; the
 * shorter `/dashboard/medication` URL was 404-ing.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function MedicationRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/medication-dashboard");
  }, [router]);
  return (
    <div
      className="p-8 text-sm text-gray-500"
      data-testid="medication-redirect"
    >
      Redirecting to Medication Dashboard…
    </div>
  );
}
