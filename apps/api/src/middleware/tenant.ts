import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AuthPayload } from "@medcore/shared";

/**
 * Tenant identifier attached to every request by {@link tenantContextMiddleware}.
 * In the future this will be used by Prisma middleware (see
 * `apps/api/src/services/tenant-context.ts`) to automatically scope queries
 * to the caller's tenant.
 *
 * NOTE: The Express `Request.tenantId` augmentation is declared in
 * `apps/api/src/services/tenant-context.ts` to avoid duplicate declarations
 * across the tree; importing that module once is enough to pick it up.
 */

/**
 * Express middleware that resolves the current tenant for a request and sets
 * `req.tenantId`. Resolution order:
 *
 *   1. `X-Tenant-Id` header (explicit override — used for service-to-service
 *      traffic and admin tooling).
 *   2. `req.user.tenantId` — populated by {@link authenticate} from the JWT.
 *      When this middleware runs BEFORE `authenticate` (the default, because
 *      it is mounted globally in `app.ts`), we fall back to decoding the JWT
 *      ourselves so tenant resolution does not depend on middleware ordering.
 *   3. `undefined` — pass-through / cross-tenant admin endpoints.
 *
 * This middleware DOES NOT reject requests; enforcement (i.e. 400/403 when a
 * tenant-scoped route is hit without a tenant) is the caller's responsibility.
 * That keeps the middleware safe to mount globally alongside routes that
 * legitimately operate without a tenant (e.g. `/api/health`, cross-tenant
 * admin endpoints).
 */
export function tenantContextMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction,
) {
  // 1. Explicit header override — server-to-server calls, admin tooling.
  const headerTenant = req.header("X-Tenant-Id");
  if (headerTenant && typeof headerTenant === "string" && headerTenant.trim().length > 0) {
    req.tenantId = headerTenant.trim();
    return next();
  }

  // 2a. If authenticate() already ran, use the typed payload directly.
  if (req.user?.tenantId) {
    req.tenantId = req.user.tenantId;
    return next();
  }

  // 2b. Fall back to decoding the bearer token ourselves — this middleware
  //     is mounted globally BEFORE the per-router `authenticate` call, so
  //     `req.user` is typically still undefined here.
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length);
    try {
      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "dev-secret",
      ) as Partial<AuthPayload>;
      if (decoded && typeof decoded.tenantId === "string" && decoded.tenantId.length > 0) {
        req.tenantId = decoded.tenantId;
      }
    } catch {
      // Leave tenantId undefined; upstream auth middleware will handle the
      // invalid/expired token case. We deliberately do not 401 here because
      // not all routes require authentication.
    }
  }

  return next();
}
