import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "@medcore/db";
import {
  Role,
  createMedicineSchema,
  updateMedicineSchema,
  createDrugInteractionSchema,
  checkInteractionsSchema,
} from "@medcore/shared";
import { authenticate, authorize } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { auditLog } from "../middleware/audit";

const router = Router();
router.use(authenticate);

// GET /api/v1/medicines — list medicines with search/category filters
router.get("/", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { search, category, page = "1", limit = "20" } = req.query;
    const skip = (parseInt(page as string) - 1) * parseInt(limit as string);
    const take = Math.min(parseInt(limit as string), 100);

    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: "insensitive" } },
        { genericName: { contains: search as string, mode: "insensitive" } },
        { brand: { contains: search as string, mode: "insensitive" } },
      ];
    }

    const [medicines, total] = await Promise.all([
      prisma.medicine.findMany({
        where,
        skip,
        take,
        orderBy: { name: "asc" },
      }),
      prisma.medicine.count({ where }),
    ]);

    res.json({
      success: true,
      data: medicines,
      error: null,
      meta: { page: parseInt(page as string), limit: take, total },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/medicines/:id — detail with interactions
router.get(
  "/:id",
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const medicine = await prisma.medicine.findUnique({
        where: { id: req.params.id },
        include: {
          interactionsA: { include: { drugB: true } },
          interactionsB: { include: { drugA: true } },
          inventoryItems: {
            where: { quantity: { gt: 0 } },
            orderBy: { expiryDate: "asc" },
          },
        },
      });

      if (!medicine) {
        res.status(404).json({
          success: false,
          data: null,
          error: "Medicine not found",
        });
        return;
      }

      const interactions = [
        ...medicine.interactionsA.map((i) => ({
          id: i.id,
          severity: i.severity,
          description: i.description,
          otherDrug: i.drugB,
        })),
        ...medicine.interactionsB.map((i) => ({
          id: i.id,
          severity: i.severity,
          description: i.description,
          otherDrug: i.drugA,
        })),
      ];

      const { interactionsA, interactionsB, ...rest } = medicine;

      res.json({
        success: true,
        data: { ...rest, interactions },
        error: null,
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/medicines — create medicine
router.post(
  "/",
  authorize(Role.ADMIN, Role.DOCTOR),
  validate(createMedicineSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const medicine = await prisma.medicine.create({ data: req.body });
      auditLog(req, "CREATE_MEDICINE", "medicine", medicine.id, {
        name: medicine.name,
      }).catch(console.error);
      res.status(201).json({ success: true, data: medicine, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// PATCH /api/v1/medicines/:id — update medicine
router.patch(
  "/:id",
  authorize(Role.ADMIN, Role.DOCTOR),
  validate(updateMedicineSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const medicine = await prisma.medicine.update({
        where: { id: req.params.id },
        data: req.body,
      });
      auditLog(req, "UPDATE_MEDICINE", "medicine", medicine.id, req.body).catch(
        console.error
      );
      res.json({ success: true, data: medicine, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/medicines/interactions — add drug interaction
router.post(
  "/interactions",
  authorize(Role.ADMIN, Role.DOCTOR),
  validate(createDrugInteractionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { drugAId, drugBId, severity, description } = req.body;

      if (drugAId === drugBId) {
        res.status(400).json({
          success: false,
          data: null,
          error: "Cannot create self-interaction",
        });
        return;
      }

      const interaction = await prisma.drugInteraction.create({
        data: { drugAId, drugBId, severity, description },
        include: { drugA: true, drugB: true },
      });

      auditLog(
        req,
        "CREATE_DRUG_INTERACTION",
        "drug_interaction",
        interaction.id,
        { drugAId, drugBId, severity }
      ).catch(console.error);

      res.status(201).json({ success: true, data: interaction, error: null });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/v1/medicines/check-interactions — check interactions among a list
router.post(
  "/check-interactions",
  validate(checkInteractionsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { medicineIds } = req.body as { medicineIds: string[] };

      if (medicineIds.length < 2) {
        res.json({ success: true, data: [], error: null });
        return;
      }

      const interactions = await prisma.drugInteraction.findMany({
        where: {
          AND: [
            { drugAId: { in: medicineIds } },
            { drugBId: { in: medicineIds } },
          ],
        },
        include: { drugA: true, drugB: true },
      });

      res.json({ success: true, data: interactions, error: null });
    } catch (err) {
      next(err);
    }
  }
);

export { router as medicineRouter };
