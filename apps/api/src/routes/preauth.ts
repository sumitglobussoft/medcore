import { Router, Request, Response, NextFunction } from "express";
// Multi-tenant wiring: `tenantScopedPrisma` is a Prisma $extends wrapper that
// auto-injects tenantId on create and auto-filters on read for the 20
// tenant-scoped models (see services/tenant-prisma.ts). We alias it to
// `prisma` so every existing call site keeps working without edits.
import { tenantScopedPrisma as prisma } from "../services/tenant-prisma";
import {
  Role,
  preAuthRequestSchema,
  updatePreAuthStatusSchema,
  PREAUTH_PREFIX,
} from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { auditLog } from "../middleware/audit";

const router = Router();
router.use(authenticate);

// POST /api/v1/preauth — submit request
router.post(
  "/",
  authorize(Role.ADMIN, Role.RECEPTION),
  validate(preAuthRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = req.body;
      const cfgKey = "next_preauth_number";
      const cfg = await prisma.systemConfig.findUnique({ where: { key: cfgKey } });
      const seq = cfg ? parseInt(cfg.value) : 1;
      const requestNumber = `${PREAUTH_PREFIX}${String(seq).padStart(6, "0")}`;

      const created = await prisma.$transaction(async (tx) => {
        const doc = await tx.preAuthRequest.create({
          data: {
            requestNumber,
            patientId: body.patientId,
            insuranceProvider: body.insuranceProvider,
            policyNumber: body.policyNumber,
            procedureName: body.procedureName,
            estimatedCost: body.estimatedCost,
            diagnosis: body.diagnosis ?? null,
            supportingDocs: body.supportingDocs
              ? JSON.stringify(body.supportingDocs)
              : null,
            notes: body.notes ?? null,
            createdBy: req.user!.userId,
          },
        });
        if (cfg) {
          await tx.systemConfig.update({
            where: { key: cfgKey },
            data: { value: String(seq + 1) },
          });
        } else {
          await tx.systemConfig.create({
            data: { key: cfgKey, value: String(seq + 1) },
          });
        }
        return doc;
      });

      auditLog(req, "PREAUTH_CREATE", "preauth_request", created.id, {
        requestNumber,
        patientId: body.patientId,
      }).catch(console.error);

      res.status(201).json({ success: true, data: created, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/preauth — list with filters
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { status, patientId, from, to } = req.query as Record<
      string,
      string | undefined
    >;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (patientId) where.patientId = patientId;
    if (from || to) {
      where.submittedAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    const rows = await prisma.preAuthRequest.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      include: {
        patient: {
          select: {
            id: true,
            mrNumber: true,
            user: { select: { name: true, phone: true } },
          },
        },
      },
    });
    res.json({ success: true, data: rows, error: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/preauth/:id — detail
router.get("/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const doc = await prisma.preAuthRequest.findUnique({
      where: { id: req.params.id },
      include: {
        patient: {
          select: {
            id: true,
            mrNumber: true,
            user: { select: { name: true, phone: true, email: true } },
          },
        },
      },
    });
    if (!doc) {
      res
        .status(404)
        .json({ success: false, data: null, error: "Request not found" });
      return;
    }
    res.json({ success: true, data: doc, error: null });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/v1/preauth/:id/status — update status
router.patch(
  "/:id/status",
  authorize(Role.ADMIN, Role.RECEPTION),
  validate(updatePreAuthStatusSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const {
        status,
        approvedAmount,
        rejectionReason,
        claimReferenceNumber,
        notes,
      } = req.body;
      const updated = await prisma.preAuthRequest.update({
        where: { id: req.params.id },
        data: {
          status,
          approvedAmount: approvedAmount ?? null,
          rejectionReason: rejectionReason ?? null,
          claimReferenceNumber: claimReferenceNumber ?? null,
          notes: notes ?? undefined,
          resolvedAt: new Date(),
        },
      });
      auditLog(req, "PREAUTH_STATUS_UPDATE", "preauth_request", updated.id, {
        status,
        approvedAmount,
      }).catch(console.error);
      res.json({ success: true, data: updated, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as preauthRouter };
