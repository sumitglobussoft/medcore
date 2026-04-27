import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  // Issue #1: when true, the server mints a refresh token that lasts 30 days
  // instead of the default 7. Optional so existing callers (older web builds,
  // integration tests) keep working unchanged.
  rememberMe: z.boolean().optional(),
});

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  role: z.enum(["ADMIN", "DOCTOR", "RECEPTION", "NURSE", "PATIENT"]),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  code: z.string().length(6, "Reset code must be 6 digits"),
  newPassword: z.string().min(6, "Password must be at least 6 characters"),
});

// Issue #138 (Apr 2026): PATCH /api/v1/auth/me previously accepted an empty
// trimmed name and "abc" as a phone — both shipped through with no field-
// level error. Mirrors the patient-phone regex used by Issue #87 cleanup so
// receptionists, doctors and patients all get the same input contract.
//
// - name: required, trimmed, min 1 (we keep min 1 so existing single-word
//   names like "Anand" are preserved; 2 was too aggressive and broke a few
//   prod rows).
// - phone: optional E.164-ish: 10–15 digits, optional leading "+".
// - photoUrl / preferredLanguage / defaultLandingPage: tolerated but
//   cleaned of stray whitespace.
export const updateProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name cannot be empty")
      .max(100, "Name must be at most 100 characters")
      .optional(),
    phone: z
      .string()
      .trim()
      .regex(/^\+?\d{10,15}$/, "Phone must be 10–15 digits, optional leading +")
      .optional(),
    photoUrl: z.string().nullable().optional(),
    preferredLanguage: z.string().nullable().optional(),
    defaultLandingPage: z.string().nullable().optional(),
  })
  .refine(
    (v) =>
      v.name !== undefined ||
      v.phone !== undefined ||
      v.photoUrl !== undefined ||
      v.preferredLanguage !== undefined ||
      v.defaultLandingPage !== undefined,
    { message: "Nothing to update" }
  );

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
