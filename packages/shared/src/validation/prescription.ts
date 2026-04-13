import { z } from "zod";

const prescriptionItemSchema = z.object({
  medicineName: z.string().min(1, "Medicine name is required"),
  dosage: z.string().min(1, "Dosage is required"),
  frequency: z.string().min(1, "Frequency is required"),
  duration: z.string().min(1, "Duration is required"),
  instructions: z.string().optional(),
});

export const createPrescriptionSchema = z.object({
  appointmentId: z.string().uuid(),
  patientId: z.string().uuid(),
  diagnosis: z.string().min(1, "Diagnosis is required"),
  items: z.array(prescriptionItemSchema).min(1, "At least one medicine is required"),
  advice: z.string().optional(),
  followUpDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
    .optional(),
});

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>;
