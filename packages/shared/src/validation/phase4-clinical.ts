import { z } from "zod";

export const TELEMEDICINE_STATUS = [
  "SCHEDULED",
  "WAITING",
  "IN_PROGRESS",
  "COMPLETED",
  "MISSED",
  "CANCELLED",
] as const;

export const TRIAGE_LEVELS = [
  "RESUSCITATION",
  "EMERGENT",
  "URGENT",
  "LESS_URGENT",
  "NON_URGENT",
] as const;

export const EMERGENCY_STATUS = [
  "WAITING",
  "TRIAGED",
  "IN_TREATMENT",
  "ADMITTED",
  "DISCHARGED",
  "TRANSFERRED",
  "LEFT_WITHOUT_BEING_SEEN",
  "DECEASED",
] as const;

// Telemedicine
export const createTelemedicineSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
  chiefComplaint: z.string().optional(),
  fee: z.number().nonnegative().default(500),
});

export const updateTelemedicineStatusSchema = z.object({
  status: z.enum(TELEMEDICINE_STATUS),
  doctorNotes: z.string().optional(),
  patientRating: z.number().int().min(1).max(5).optional(),
});

export const rateTelemedicineSchema = z.object({
  patientRating: z.number().int().min(1).max(5),
});

export const endTelemedicineSchema = z.object({
  doctorNotes: z.string().optional(),
});

// Emergency
export const createEmergencyCaseSchema = z.object({
  patientId: z.string().uuid().optional(),
  unknownName: z.string().optional(),
  unknownAge: z.number().int().nonnegative().optional(),
  unknownGender: z.string().optional(),
  arrivalMode: z.string().optional(),
  chiefComplaint: z.string().min(1),
});

export const triageSchema = z.object({
  caseId: z.string().uuid(),
  triageLevel: z.enum(TRIAGE_LEVELS),
  vitalsBP: z.string().optional(),
  vitalsPulse: z.number().int().optional(),
  vitalsResp: z.number().int().optional(),
  vitalsSpO2: z.number().int().optional(),
  vitalsTemp: z.number().optional(),
  glasgowComa: z.number().int().min(3).max(15).optional(),
  mewsScore: z.number().int().min(0).max(14).optional(),
});

export const assignEmergencyDoctorSchema = z.object({
  attendingDoctorId: z.string().uuid(),
});

export const updateEmergencyStatusSchema = z.object({
  status: z.enum(EMERGENCY_STATUS),
  attendingDoctorId: z.string().uuid().optional(),
  disposition: z.string().optional(),
  outcomeNotes: z.string().optional(),
});

export type CreateTelemedicineInput = z.infer<typeof createTelemedicineSchema>;
export type UpdateTelemedicineStatusInput = z.infer<
  typeof updateTelemedicineStatusSchema
>;
export type RateTelemedicineInput = z.infer<typeof rateTelemedicineSchema>;
export type EndTelemedicineInput = z.infer<typeof endTelemedicineSchema>;
export type CreateEmergencyCaseInput = z.infer<
  typeof createEmergencyCaseSchema
>;
export type TriageInput = z.infer<typeof triageSchema>;
export type AssignEmergencyDoctorInput = z.infer<
  typeof assignEmergencyDoctorSchema
>;
export type UpdateEmergencyStatusInput = z.infer<
  typeof updateEmergencyStatusSchema
>;
