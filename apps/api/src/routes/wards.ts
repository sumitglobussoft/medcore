import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import {
  Role,
  createWardSchema,
  createBedSchema,
  updateBedStatusSchema,
} from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { auditLog } from "../middleware/audit";

const router = Router();
router.use(authenticate);

// GET /api/v1/wards — list all wards with bed counts
router.get("/", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const wards = await prisma.ward.findMany({
      include: {
        beds: {
          select: { id: true, status: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const data = wards.map((w) => {
      const total = w.beds.length;
      const available = w.beds.filter((b) => b.status === "AVAILABLE").length;
      const occupied = w.beds.filter((b) => b.status === "OCCUPIED").length;
      return {
        id: w.id,
        name: w.name,
        type: w.type,
        floor: w.floor,
        description: w.description,
        createdAt: w.createdAt,
        bedStats: { total, available, occupied },
      };
    });

    res.json({ success: true, data, error: null });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/wards/:id — ward detail with all beds
router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ward = await prisma.ward.findUnique({
        where: { id: req.params.id },
        include: {
          beds: {
            orderBy: { bedNumber: "asc" },
            include: {
              admissions: {
                where: { status: "ADMITTED" },
                include: {
                  patient: {
                    include: { user: { select: { name: true, phone: true } } },
                  },
                },
              },
            },
          },
        },
      });

      if (!ward) {
        res.status(404).json({ success: false, data: null, error: "Ward not found" });
        return;
      }

      res.json({ success: true, data: ward, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/wards — create ward (ADMIN only)
router.post(
  "/",
  authorize(Role.ADMIN),
  validate(createWardSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ward = await prisma.ward.create({ data: req.body });
      auditLog(req, "CREATE_WARD", "ward", ward.id, { name: ward.name }).catch(console.error);
      res.status(201).json({ success: true, data: ward, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/wards/:wardId/beds — create bed (ADMIN only)
router.post(
  "/:wardId/beds",
  authorize(Role.ADMIN),
  validate(createBedSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { wardId } = req.params;
      const ward = await prisma.ward.findUnique({ where: { id: wardId } });
      if (!ward) {
        res.status(404).json({ success: false, data: null, error: "Ward not found" });
        return;
      }

      const bed = await prisma.bed.create({
        data: {
          wardId,
          bedNumber: req.body.bedNumber,
          dailyRate: req.body.dailyRate ?? 0,
        },
      });

      auditLog(req, "CREATE_BED", "bed", bed.id, { wardId, bedNumber: bed.bedNumber }).catch(console.error);
      res.status(201).json({ success: true, data: bed, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as wardRouter };

// Separate router for /beds endpoints
const bedsRouter = Router();
bedsRouter.use(authenticate);

// PATCH /api/v1/beds/:id/status — update bed status
bedsRouter.patch(
  "/:id/status",
  authorize(Role.ADMIN, Role.NURSE, Role.RECEPTION),
  validate(updateBedStatusSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bed = await prisma.bed.update({
        where: { id: req.params.id },
        data: { status: req.body.status, notes: req.body.notes },
      });
      auditLog(req, "UPDATE_BED_STATUS", "bed", bed.id, { status: req.body.status }).catch(console.error);
      res.json({ success: true, data: bed, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { bedsRouter };
