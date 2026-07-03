// src/validations/realEmailSchema.ts
//
// Zod schema for the real email address a customer supplies to replace an
// admin-entered Test_Email during profile completion.
//
// Validates: Requirements 10.2, 10.5
//   - 1 to 254 characters
//   - valid email address format

import { z } from "zod";

/** A customer-supplied real email: non-empty, at most 254 chars, valid format. */
export const realEmailSchema = z
  .string()
  .min(1, "Email is required.")
  .max(254, "Email must be at most 254 characters.")
  .email("Enter a valid email address.");

export type RealEmailValue = z.infer<typeof realEmailSchema>;
