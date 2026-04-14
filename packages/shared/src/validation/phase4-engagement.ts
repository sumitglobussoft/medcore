import { z } from "zod";

export const FEEDBACK_CATEGORIES = [
  "DOCTOR",
  "NURSE",
  "RECEPTION",
  "CLEANLINESS",
  "FOOD",
  "WAITING_TIME",
  "BILLING",
  "OVERALL",
] as const;

export const COMPLAINT_STATUSES = [
  "OPEN",
  "UNDER_REVIEW",
  "RESOLVED",
  "ESCALATED",
  "CLOSED",
] as const;

export const COMPLAINT_PRIORITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
] as const;

export const MESSAGE_TYPES = ["TEXT", "IMAGE", "FILE", "SYSTEM"] as const;

export const VISITOR_PURPOSES = [
  "PATIENT_VISIT",
  "DELIVERY",
  "APPOINTMENT",
  "MEETING",
  "OTHER",
] as const;

// ───────────────────────────────────────────────────────
// FEEDBACK
// ───────────────────────────────────────────────────────

export const createFeedbackSchema = z.object({
  patientId: z.string().uuid(),
  category: z.enum(FEEDBACK_CATEGORIES),
  rating: z.number().int().min(1).max(5),
  nps: z.number().int().min(0).max(10).optional(),
  comment: z.string().optional(),
});

// ───────────────────────────────────────────────────────
// COMPLAINTS
// ───────────────────────────────────────────────────────

export const createComplaintSchema = z
  .object({
    patientId: z.string().uuid().optional(),
    name: z.string().optional(),
    phone: z.string().optional(),
    category: z.string().min(1),
    description: z.string().min(1),
    priority: z.enum(COMPLAINT_PRIORITIES).default("MEDIUM"),
  })
  .refine((d) => d.patientId || d.name, {
    message: "Either patientId or name is required",
    path: ["name"],
  });

export const updateComplaintSchema = z.object({
  status: z.enum(COMPLAINT_STATUSES).optional(),
  assignedTo: z.string().uuid().optional(),
  resolution: z.string().optional(),
  priority: z.enum(COMPLAINT_PRIORITIES).optional(),
});

// ───────────────────────────────────────────────────────
// CHAT
// ───────────────────────────────────────────────────────

export const createChatRoomSchema = z.object({
  name: z.string().optional(),
  isGroup: z.boolean().default(false),
  participantIds: z.array(z.string().uuid()).min(1),
});

export const sendMessageSchema = z.object({
  roomId: z.string().uuid(),
  content: z.string().min(1),
  type: z.enum(MESSAGE_TYPES).default("TEXT"),
  attachmentUrl: z.string().optional(),
});

// ───────────────────────────────────────────────────────
// VISITORS
// ───────────────────────────────────────────────────────

export const checkinVisitorSchema = z.object({
  name: z.string().min(1),
  phone: z.string().optional(),
  idProofType: z.string().optional(),
  idProofNumber: z.string().optional(),
  patientId: z.string().uuid().optional(),
  purpose: z.enum(VISITOR_PURPOSES),
  department: z.string().optional(),
  notes: z.string().optional(),
});

// ───────────────────────────────────────────────────────
// Types
// ───────────────────────────────────────────────────────

export type CreateFeedbackInput = z.infer<typeof createFeedbackSchema>;
export type CreateComplaintInput = z.infer<typeof createComplaintSchema>;
export type UpdateComplaintInput = z.infer<typeof updateComplaintSchema>;
export type CreateChatRoomInput = z.infer<typeof createChatRoomSchema>;
export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type CheckinVisitorInput = z.infer<typeof checkinVisitorSchema>;
