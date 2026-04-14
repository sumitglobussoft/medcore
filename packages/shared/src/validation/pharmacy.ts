import { z } from "zod";

export const InteractionSeverity = z.enum([
  "MILD",
  "MODERATE",
  "SEVERE",
  "CONTRAINDICATED",
]);

export const StockMovementType = z.enum([
  "PURCHASE",
  "DISPENSED",
  "RETURNED",
  "EXPIRED",
  "ADJUSTMENT",
  "DAMAGED",
]);

export const createMedicineSchema = z.object({
  name: z.string().min(1, "Name is required"),
  genericName: z.string().optional(),
  brand: z.string().optional(),
  form: z.string().optional(),
  strength: z.string().optional(),
  category: z.string().optional(),
  description: z.string().optional(),
  sideEffects: z.string().optional(),
  contraindications: z.string().optional(),
  prescriptionRequired: z.boolean().optional(),
});

export const updateMedicineSchema = createMedicineSchema.partial();

export const createDrugInteractionSchema = z.object({
  drugAId: z.string().uuid(),
  drugBId: z.string().uuid(),
  severity: InteractionSeverity,
  description: z.string().min(1, "Description is required"),
});

export const createInventoryItemSchema = z.object({
  medicineId: z.string().uuid(),
  batchNumber: z.string().min(1, "Batch number is required"),
  quantity: z.number().int().nonnegative(),
  unitCost: z.number().nonnegative(),
  sellingPrice: z.number().nonnegative(),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Expiry date must be YYYY-MM-DD"),
  supplier: z.string().optional(),
  reorderLevel: z.number().int().nonnegative().optional(),
  location: z.string().optional(),
});

export const updateInventoryItemSchema = z.object({
  location: z.string().optional(),
  reorderLevel: z.number().int().nonnegative().optional(),
  sellingPrice: z.number().nonnegative().optional(),
});

export const stockMovementSchema = z.object({
  inventoryItemId: z.string().uuid(),
  type: StockMovementType,
  quantity: z.number().int(),
  reason: z.string().optional(),
});

export const dispensePrescriptionSchema = z.object({
  prescriptionId: z.string().uuid(),
});

export const checkInteractionsSchema = z.object({
  medicineIds: z.array(z.string().uuid()).min(1, "Provide at least one medicine"),
});

export type CreateMedicineInput = z.infer<typeof createMedicineSchema>;
export type UpdateMedicineInput = z.infer<typeof updateMedicineSchema>;
export type CreateDrugInteractionInput = z.infer<
  typeof createDrugInteractionSchema
>;
export type CreateInventoryItemInput = z.infer<typeof createInventoryItemSchema>;
export type UpdateInventoryItemInput = z.infer<typeof updateInventoryItemSchema>;
export type StockMovementInput = z.infer<typeof stockMovementSchema>;
export type DispensePrescriptionInput = z.infer<
  typeof dispensePrescriptionSchema
>;
export type CheckInteractionsInput = z.infer<typeof checkInteractionsSchema>;
