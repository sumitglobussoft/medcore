import { z } from "zod";

export const LabTestStatus = z.enum([
  "ORDERED",
  "SAMPLE_COLLECTED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
]);

export const LabResultFlag = z.enum(["NORMAL", "LOW", "HIGH", "CRITICAL"]);

export const createLabTestSchema = z.object({
  code: z.string().min(1, "Code is required"),
  name: z.string().min(1, "Name is required"),
  category: z.string().optional(),
  price: z.number().nonnegative(),
  sampleType: z.string().optional(),
  normalRange: z.string().optional(),
  description: z.string().optional(),
});

export const updateLabTestSchema = createLabTestSchema.partial();

export const createLabOrderSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  admissionId: z.string().uuid().optional(),
  testIds: z.array(z.string().uuid()).min(1, "At least one test is required"),
  notes: z.string().optional(),
  priority: z.enum(["ROUTINE", "URGENT", "STAT"]).optional(),
});

export const updateLabOrderStatusSchema = z.object({
  status: LabTestStatus,
});

export const recordLabResultSchema = z.object({
  orderItemId: z.string().uuid(),
  parameter: z.string().min(1, "Parameter is required"),
  value: z.string().min(1, "Value is required"),
  unit: z.string().optional(),
  normalRange: z.string().optional(),
  flag: LabResultFlag.optional(),
  notes: z.string().optional(),
});

export const labQCSchema = z.object({
  testId: z.string().uuid(),
  qcLevel: z.enum(["LOW", "NORMAL", "HIGH", "INTERNAL"]),
  instrument: z.string().optional(),
  meanValue: z.number(),
  recordedValue: z.number(),
  cv: z.number().optional(),
  withinRange: z.boolean(),
  notes: z.string().optional(),
});

export const verifyResultSchema = z.object({
  notes: z.string().optional(),
});

export const shareLinkSchema = z.object({
  resource: z.enum(["lab_order", "prescription", "invoice"]).default("lab_order"),
  days: z.number().int().min(1).max(30).optional(), // default 7
});

export type CreateLabTestInput = z.infer<typeof createLabTestSchema>;
export type UpdateLabTestInput = z.infer<typeof updateLabTestSchema>;
export type CreateLabOrderInput = z.infer<typeof createLabOrderSchema>;
export type UpdateLabOrderStatusInput = z.infer<
  typeof updateLabOrderStatusSchema
>;
export type RecordLabResultInput = z.infer<typeof recordLabResultSchema>;
export type LabQCInput = z.infer<typeof labQCSchema>;
export type VerifyResultInput = z.infer<typeof verifyResultSchema>;
export type ShareLinkInput = z.infer<typeof shareLinkSchema>;
