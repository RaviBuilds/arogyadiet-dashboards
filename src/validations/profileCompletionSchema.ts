// src/validations/profileCompletionSchema.ts
//
// Zod schema for the customer profile-completion dialog. Every field is
// optional and independently format-validated, so the customer can submit any
// subset (including none) of the remaining profile fields. Cross-field and
// persistence rules (partial-update rejection, COMPLETED transition) live in
// the OnboardingService, not here.
//
// Mirrors the completable `customer_profiles` fields plus an optional real
// email that replaces an admin-entered Test_Email.
//
// Validates: Requirements 9.2, 9.3, 9.7, 10.5

import { z } from "zod";

/**
 * Profile-completion payload: all fields optional, each validated only for
 * format when a value is provided (Req 9.2). Empty/omitted fields are allowed
 * and simply left unchanged on the Customer_Record.
 */
export const profileCompletionSchema = z.object({
  // ISO date string (yyyy-mm-dd) when provided.
  dateOfBirth: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a valid date (YYYY-MM-DD).")
    .optional(),

  gender: z.enum(["Male", "Female", "Other"]).optional(),

  dietaryPreference: z.enum(["Veg", "Non-Veg"]).optional(),

  allergies: z
    .string()
    .max(500, "Allergies must be at most 500 characters.")
    .optional(),

  medicalHistoryNotes: z
    .string()
    .max(2000, "Medical history must be at most 2000 characters.")
    .optional(),

  // Req 10.5: real email offered only when the current email is a Test_Email.
  email: z
    .string()
    .min(1, "Email is required.")
    .max(254, "Email must be at most 254 characters.")
    .email("Enter a valid email address.")
    .optional(),
});

export type ProfileCompletionInput = z.infer<typeof profileCompletionSchema>;
