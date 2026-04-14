import { z } from "zod";

export const bookAppointmentSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  slotId: z.string().uuid(),
  notes: z.string().optional(),
});

export const walkInSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  priority: z.enum(["NORMAL", "URGENT", "EMERGENCY"]).default("NORMAL"),
  notes: z.string().optional(),
});

export const updateAppointmentStatusSchema = z.object({
  status: z.enum([
    "BOOKED",
    "CHECKED_IN",
    "IN_CONSULTATION",
    "COMPLETED",
    "CANCELLED",
    "NO_SHOW",
  ]),
});

export const doctorScheduleSchema = z.object({
  doctorId: z.string().uuid(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"),
  slotDurationMinutes: z.number().int().min(5).max(120).default(15),
});

export const scheduleOverrideSchema = z.object({
  doctorId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  isBlocked: z.boolean().default(true),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  reason: z.string().optional(),
});

export const rescheduleAppointmentSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  slotStart: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"),
});

export const recurringAppointmentSchema = z.object({
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  slotStart: z.string().regex(/^\d{2}:\d{2}$/, "Time must be HH:MM"),
  frequency: z.enum(["DAILY", "WEEKLY", "MONTHLY"]),
  occurrences: z.number().int().min(2).max(52),
  notes: z.string().optional(),
});

export type BookAppointmentInput = z.infer<typeof bookAppointmentSchema>;
export type WalkInInput = z.infer<typeof walkInSchema>;
export type UpdateAppointmentStatusInput = z.infer<typeof updateAppointmentStatusSchema>;
export type DoctorScheduleInput = z.infer<typeof doctorScheduleSchema>;
export type ScheduleOverrideInput = z.infer<typeof scheduleOverrideSchema>;
export type RescheduleAppointmentInput = z.infer<typeof rescheduleAppointmentSchema>;
export type RecurringAppointmentInput = z.infer<typeof recurringAppointmentSchema>;
