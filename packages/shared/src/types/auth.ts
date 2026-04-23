import type { Role } from "./roles";

/**
 * Decoded JWT payload attached to every authenticated request as `req.user`.
 *
 * `tenantId` is optional so that tokens minted before multi-tenancy was
 * introduced (legacy tokens without a `tenantId` claim) still verify. The
 * tenant middleware treats an absent tenant as "pass-through / global admin".
 *
 * Declared in the shared package so that both the Express middleware (see
 * `apps/api/src/middleware/auth.ts`) and the tenant resolver (see
 * `apps/api/src/middleware/tenant.ts`) can reference the exact same shape.
 */
export interface AuthPayload {
  /** User id (primary key of the `users` row). */
  userId: string;
  /** User email (denormalised into the token for logging convenience). */
  email: string;
  /** User role — drives RBAC via `authorize(...)`. */
  role: Role;
  /**
   * Tenant id the user belongs to. `null` when the user is a global/admin
   * account that is not scoped to any tenant. `undefined` when the token
   * pre-dates the multi-tenant rollout (backward compatibility).
   */
  tenantId?: string | null;
  /** Optional JWT id — rotates on every sign so refresh tokens are unique. */
  jti?: string;
}
