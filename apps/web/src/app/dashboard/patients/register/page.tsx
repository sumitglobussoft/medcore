"use client";

/**
 * Issue #143 — static-segment route for /dashboard/patients/register.
 *
 * Next.js 15 dynamic-segment collision: without this static page,
 * /dashboard/patients/[id]/page.tsx matched /dashboard/patients/register
 * and treated "register" as the patient `id`, producing a "Patient not
 * found" or 404 instead of the registration form. A static segment beats
 * a dynamic one in Next routing, so this file alone fixes the collision.
 *
 * The patient list page (`/dashboard/patients`) already owns the canonical
 * registration form — exposed via the `?register=1` query string we land
 * here with — so we simply forward to it and let that page open the
 * registration drawer/form.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PatientsRegisterRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/dashboard/patients?register=1");
  }, [router]);
  return (
    <div
      className="p-8 text-sm text-gray-500"
      data-testid="patients-register-redirect"
    >
      Opening patient registration…
    </div>
  );
}
