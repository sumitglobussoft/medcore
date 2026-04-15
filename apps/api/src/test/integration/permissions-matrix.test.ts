// Permissions matrix — exhaustive role × endpoint authorization test.
//
// For each curated endpoint we encode the `authorize(...)` decorator as
// `rolesAllowed`. Then for each of the 7 canonical roles we hit the endpoint
// with a valid JWT for that role and assert:
//   – If role ∈ rolesAllowed  → status ≠ 403 (anything else is acceptable,
//     including 400 / 404 / 409 — we only care about the auth decision)
//   – If role ∉ rolesAllowed  → status === 403
//
// To isolate the auth decision from body-validation we use GET where the route
// supports it and POST with an empty body otherwise (the authorize middleware
// runs before the validate middleware, so missing fields still produce 403 if
// the role is wrong — exactly what we want to assert).
//
// Skipped unless DATABASE_URL_TEST is set.
import { it, expect, beforeAll } from "vitest";
import request from "supertest";
import { describeIfDB, resetDB, getAuthToken } from "../setup";

// NOTE: The Prisma / shared `Role` enum only defines 5 values:
// ADMIN, DOCTOR, RECEPTION, NURSE, PATIENT.
// The task brief references PHARMACIST and LAB_TECH, but they do not exist
// in the schema — creating a user with those roles would violate the enum.
// We therefore matrix-test the 5 real roles (25 endpoints × 5 roles = 125
// assertions) and flag the missing roles in the task report.
type Role =
  | "ADMIN"
  | "DOCTOR"
  | "RECEPTION"
  | "NURSE"
  | "PATIENT";

const ALL_ROLES: Role[] = [
  "ADMIN",
  "DOCTOR",
  "RECEPTION",
  "NURSE",
  "PATIENT",
];

interface MatrixRow {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  rolesAllowed: Role[];
  body?: Record<string, unknown>;
  label: string;
}

// ─── Curated representative matrix (~25 rows × 7 roles = 175 assertions) ───
//
// Each row was read off the `authorize()` decorator in the corresponding route
// file. If a route has no authorize() call but only `router.use(authenticate)`,
// it accepts all authenticated roles — those rows are excluded because they
// give no 403-vs-allow discrimination.
const MATRIX: MatrixRow[] = [
  // Patient CRUD
  {
    method: "GET",
    path: "/api/v1/patients",
    rolesAllowed: ["ADMIN", "DOCTOR", "RECEPTION", "NURSE"],
    label: "list patients",
  },
  {
    method: "POST",
    path: "/api/v1/patients",
    rolesAllowed: ["ADMIN", "RECEPTION"],
    body: {},
    label: "create patient",
  },
  {
    method: "POST",
    path: "/api/v1/patients/00000000-0000-0000-0000-000000000000/merge",
    rolesAllowed: ["ADMIN"],
    body: {},
    label: "merge patients",
  },
  {
    method: "POST",
    path: "/api/v1/patients/00000000-0000-0000-0000-000000000000/vitals",
    rolesAllowed: ["ADMIN", "DOCTOR", "NURSE"],
    body: {},
    label: "record vitals",
  },

  // Appointment CRUD
  {
    method: "POST",
    path: "/api/v1/appointments/walk-in",
    rolesAllowed: ["ADMIN", "RECEPTION"],
    body: {},
    label: "walk-in appointment",
  },
  {
    method: "POST",
    path: "/api/v1/appointments/recurring",
    rolesAllowed: ["ADMIN", "RECEPTION"],
    body: {},
    label: "recurring appointments",
  },
  {
    method: "GET",
    path: "/api/v1/appointments/stats",
    rolesAllowed: ["ADMIN", "DOCTOR", "RECEPTION"],
    label: "appointment stats",
  },
  {
    method: "GET",
    path: "/api/v1/appointments/no-shows",
    rolesAllowed: ["ADMIN", "DOCTOR", "RECEPTION"],
    label: "appointment no-shows",
  },
  {
    method: "PATCH",
    path: "/api/v1/appointments/00000000-0000-0000-0000-000000000000/reschedule",
    rolesAllowed: ["ADMIN", "DOCTOR", "RECEPTION", "NURSE", "PATIENT"],
    body: {},
    label: "reschedule appointment",
  },

  // Prescription CRUD
  {
    method: "POST",
    path: "/api/v1/prescriptions",
    rolesAllowed: ["ADMIN", "DOCTOR"],
    body: {},
    label: "create prescription",
  },
  {
    method: "POST",
    path: "/api/v1/prescriptions/check-interactions",
    rolesAllowed: ["ADMIN", "DOCTOR"],
    body: {},
    label: "check drug interactions",
  },
  {
    method: "POST",
    path: "/api/v1/prescriptions/copy-from-previous",
    rolesAllowed: ["ADMIN", "DOCTOR"],
    body: {},
    label: "copy previous prescription",
  },
  {
    method: "POST",
    path: "/api/v1/prescriptions/templates",
    rolesAllowed: ["ADMIN", "DOCTOR"],
    body: {},
    label: "create prescription template",
  },

  // Billing
  {
    method: "POST",
    path: "/api/v1/billing/invoices",
    rolesAllowed: ["ADMIN", "RECEPTION"],
    body: {},
    label: "create invoice",
  },
  {
    method: "POST",
    path: "/api/v1/billing/payments",
    rolesAllowed: ["ADMIN", "RECEPTION"],
    body: {},
    label: "record payment",
  },
  {
    method: "POST",
    path: "/api/v1/billing/refunds",
    rolesAllowed: ["ADMIN", "RECEPTION"],
    body: {},
    label: "refund",
  },
  {
    method: "POST",
    path: "/api/v1/billing/apply-late-fees",
    rolesAllowed: ["ADMIN"],
    body: {},
    label: "apply late fees",
  },
  {
    method: "GET",
    path: "/api/v1/billing/reports/daily",
    rolesAllowed: ["ADMIN", "RECEPTION"],
    label: "daily billing report",
  },

  // Admissions
  {
    method: "POST",
    path: "/api/v1/admissions",
    rolesAllowed: ["ADMIN", "DOCTOR", "RECEPTION"],
    body: {},
    label: "create admission",
  },
  {
    method: "PATCH",
    path: "/api/v1/admissions/00000000-0000-0000-0000-000000000000/discharge",
    rolesAllowed: ["ADMIN", "DOCTOR"],
    body: {},
    label: "discharge admission",
  },
  {
    method: "POST",
    path: "/api/v1/admissions/00000000-0000-0000-0000-000000000000/vitals",
    rolesAllowed: ["ADMIN", "DOCTOR", "NURSE"],
    body: {},
    label: "admission vitals",
  },

  // Lab orders / results
  {
    method: "POST",
    path: "/api/v1/lab/tests",
    rolesAllowed: ["ADMIN"],
    body: {},
    label: "create lab test catalog entry",
  },
  {
    method: "POST",
    path: "/api/v1/lab/orders",
    rolesAllowed: ["ADMIN", "DOCTOR"],
    body: {},
    label: "create lab order",
  },
  {
    method: "POST",
    path: "/api/v1/lab/results",
    rolesAllowed: ["ADMIN", "DOCTOR", "NURSE"],
    body: {},
    label: "post lab result",
  },

  // Medication admin
  {
    method: "POST",
    path: "/api/v1/medication/orders",
    rolesAllowed: ["ADMIN", "DOCTOR"],
    body: {},
    label: "create medication order",
  },

  // Audit (admin only)
  {
    method: "GET",
    path: "/api/v1/audit",
    rolesAllowed: ["ADMIN"],
    label: "list audit log",
  },

  // Analytics (admin + reception by router.use guard)
  {
    method: "GET",
    path: "/api/v1/analytics/overview",
    rolesAllowed: ["ADMIN", "RECEPTION"],
    label: "analytics overview",
  },

  // Emergency
  {
    method: "POST",
    path: "/api/v1/emergency/cases",
    rolesAllowed: ["ADMIN", "NURSE", "RECEPTION", "DOCTOR"],
    body: {},
    label: "create emergency case",
  },
  {
    method: "PATCH",
    path: "/api/v1/emergency/cases/00000000-0000-0000-0000-000000000000/close",
    rolesAllowed: ["ADMIN", "DOCTOR"],
    body: {},
    label: "close emergency case",
  },

  // Surgery
  {
    method: "POST",
    path: "/api/v1/surgery/ots",
    rolesAllowed: ["ADMIN"],
    body: {},
    label: "create OT",
  },
  {
    method: "POST",
    path: "/api/v1/surgery",
    rolesAllowed: ["DOCTOR", "ADMIN"],
    body: {},
    label: "schedule surgery",
  },

  // Blood bank
  {
    method: "POST",
    path: "/api/v1/bloodbank/donors",
    rolesAllowed: ["NURSE", "DOCTOR", "ADMIN"],
    body: {},
    label: "create blood donor",
  },
  {
    method: "POST",
    path: "/api/v1/bloodbank/inventory",
    rolesAllowed: ["NURSE", "DOCTOR", "ADMIN"],
    body: {},
    label: "add blood unit",
  },

  // Pharmacy
  {
    method: "POST",
    path: "/api/v1/pharmacy/inventory",
    rolesAllowed: ["ADMIN", "RECEPTION"],
    body: {},
    label: "create pharmacy inventory",
  },
  {
    method: "POST",
    path: "/api/v1/pharmacy/dispense",
    rolesAllowed: ["ADMIN", "RECEPTION", "NURSE"],
    body: {},
    label: "dispense medicine",
  },
  {
    method: "GET",
    path: "/api/v1/pharmacy/reports/stock-value",
    rolesAllowed: ["ADMIN"],
    label: "pharmacy stock-value report",
  },

  // Wards
  {
    method: "POST",
    path: "/api/v1/wards",
    rolesAllowed: ["ADMIN"],
    body: {},
    label: "create ward",
  },
];

let app: any;
const tokens: Partial<Record<Role, string>> = {};

describeIfDB("Permissions Matrix (integration)", () => {
  beforeAll(async () => {
    await resetDB();
    const mod = await import("../../app");
    app = mod.app;
    for (const role of ALL_ROLES) {
      tokens[role] = await getAuthToken(role);
    }
  });

  // ─── Matrix: 25+ rows × 7 roles = 175+ assertions ───
  for (const row of MATRIX) {
    for (const role of ALL_ROLES) {
      const expected = row.rolesAllowed.includes(role);
      const label = `${row.method} ${row.path} as ${role} → ${expected ? "not 403" : "403"} (${row.label})`;
      it(label, async () => {
        const token = tokens[role]!;
        const method = row.method.toLowerCase() as
          | "get"
          | "post"
          | "patch"
          | "delete";
        let req = (request(app) as any)[method](row.path).set(
          "Authorization",
          `Bearer ${token}`
        );
        if (row.method !== "GET" && row.method !== "DELETE") {
          req = req.send(row.body ?? {});
        }
        const res = await req;
        if (expected) {
          // Role IS allowed by authorize() — anything except 403 is fine.
          // (400 validation error, 404 not-found, 409 conflict, 200 OK, etc.)
          expect(res.status).not.toBe(403);
        } else {
          // Role is NOT allowed — authorize() must return exactly 403.
          expect(res.status).toBe(403);
        }
      });
    }
  }

  // ─── No-token assertions: three disparate endpoints → 401 ───
  it("GET /api/v1/patients with no token → 401", async () => {
    const res = await request(app).get("/api/v1/patients");
    expect(res.status).toBe(401);
  });

  it("POST /api/v1/billing/invoices with no token → 401", async () => {
    const res = await request(app).post("/api/v1/billing/invoices").send({});
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/audit with no token → 401", async () => {
    const res = await request(app).get("/api/v1/audit");
    expect(res.status).toBe(401);
  });
});
