import { z } from "zod";

const invoiceItemSchema = z.object({
  description: z.string().min(1, "Description is required"),
  category: z.string().min(1, "Category is required"),
  quantity: z.number().int().min(1).default(1),
  unitPrice: z.number().min(0),
});

export const createInvoiceSchema = z.object({
  appointmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  items: z.array(invoiceItemSchema).min(1, "At least one item is required"),
  taxPercentage: z.number().min(0).max(100).default(0),
  discountAmount: z.number().min(0).default(0),
  notes: z.string().optional(),
});

export const recordPaymentSchema = z.object({
  invoiceId: z.string().uuid(),
  amount: z.number().min(0.01, "Amount must be greater than 0"),
  mode: z.enum(["CASH", "CARD", "UPI", "ONLINE", "INSURANCE"]),
  transactionId: z.string().optional(),
});

export const insuranceClaimSchema = z.object({
  invoiceId: z.string().uuid(),
  patientId: z.string().uuid(),
  insuranceProvider: z.string().min(1),
  policyNumber: z.string().min(1),
  claimAmount: z.number().min(0.01),
});

export const updateClaimStatusSchema = z.object({
  status: z.enum(["SUBMITTED", "APPROVED", "REJECTED", "SETTLED"]),
  approvedAmount: z.number().min(0).optional(),
});

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type InsuranceClaimInput = z.infer<typeof insuranceClaimSchema>;
export type UpdateClaimStatusInput = z.infer<typeof updateClaimStatusSchema>;
