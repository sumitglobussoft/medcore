import { z } from "zod";

export const startTriageSessionSchema = z.object({
  language: z.enum(["en", "hi"]).default("en"),
  inputMode: z.enum(["text", "voice"]).default("text"),
  patientId: z.string().uuid().optional(),
  isForDependent: z.boolean().default(false),
  dependentRelationship: z.string().optional(),
});

export const triageMessageSchema = z.object({
  message: z.string().min(1).max(2000),
  language: z.enum(["en", "hi"]).optional(),
});

export const bookFromTriageSchema = z.object({
  doctorId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  slotStart: z.string().regex(/^\d{2}:\d{2}$/),
  slotEnd: z.string().regex(/^\d{2}:\d{2}$/),
  patientId: z.string().uuid(),
});

export const startScribeSessionSchema = z.object({
  appointmentId: z.string().uuid(),
  consentObtained: z.literal(true),
  audioRetentionDays: z.number().int().min(0).max(365).default(30),
});

export const addTranscriptChunkSchema = z.object({
  entries: z.array(
    z.object({
      speaker: z.enum(["DOCTOR", "PATIENT", "ATTENDANT", "UNKNOWN"]),
      text: z.string().min(1),
      timestamp: z.string(),
      confidence: z.number().min(0).max(1).optional(),
    })
  ).min(1),
});

export const scribeSignOffSchema = z.object({
  soapFinal: z.object({
    subjective: z.any(),
    objective: z.any(),
    assessment: z.any(),
    plan: z.any(),
  }),
  icd10Codes: z.array(z.any()).optional(),
  rxApproved: z.boolean().default(false),
  doctorEdits: z.array(z.any()).default([]),
});
