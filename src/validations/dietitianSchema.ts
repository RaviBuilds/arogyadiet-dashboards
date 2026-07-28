// src/validations/dietitianSchema.ts
// Zod schemas for Dietitian account provisioning (Master Portal) and for the
// Dietitian_Link write path (onboarding + Customer_360).
//
// Every user-visible string comes from `src/lib/dietitian/messages.ts` so a
// message can never drift between the layer that raises it and the layer that
// asserts it.
//
// Message ordering note (Requirements 2.4 / 2.5): an empty Mobile number is
// reported as `Mobile number is required for a dietitian` and the 10-digit
// check is skipped, so the two rejections stay distinguishable instead of being
// reported together.
//
// Validates: Requirements 2.4, 2.5, 6.4

import { z } from "zod";
import {
  MOBILE_REQUIRED_FOR_DIETITIAN,
  MOBILE_MUST_BE_TEN_DIGITS,
  SELECTED_USER_IS_NOT_A_DIETITIAN,
} from "@/lib/dietitian/messages";

/**
 * Dietitian Mobile number (Requirements 2.4, 2.5).
 *
 * Trimmed first, then checked in a single pass so exactly one message is
 * produced: an empty (or whitespace-only) value yields
 * `Mobile number is required for a dietitian` and short-circuits; anything
 * else that is not exactly 10 digits yields `Enter a 10-digit mobile number`.
 *
 * The same rule is enforced at the data layer by the
 * `users_dietitian_mobile_check` constraint (Requirement 2.7), so a direct
 * database write cannot bypass it.
 */
export const dietitianMobileSchema = z
  .string({ error: MOBILE_REQUIRED_FOR_DIETITIAN })
  .trim()
  .superRefine((mobile, ctx) => {
    if (mobile.length === 0) {
      ctx.addIssue({ code: "custom", message: MOBILE_REQUIRED_FOR_DIETITIAN });
      return; // Req 2.4 wins over Req 2.5 for an empty value.
    }
    if (!/^\d{10}$/.test(mobile)) {
      ctx.addIssue({ code: "custom", message: MOBILE_MUST_BE_TEN_DIGITS });
    }
  });

/**
 * The Dietitian_Clinic_Link is 0..1 — `null` is a valid assignment and is the
 * state every seeded Dietitian starts in (Requirements 3.4, 4.3).
 */
export const dietitianClinicIdSchema = z
  .string()
  .uuid("Select a valid clinic.")
  .nullable();

/**
 * Create Dietitian input (Requirement 2).
 *
 * `mobile` carries the ordered rejection of Requirements 2.4 / 2.5. Duplicate
 * mobiles (Requirement 2.6) and the at-most-one-active-Dietitian-per-Franchise
 * rule (Requirement 2.11) are constraint violations mapped to their pinned
 * messages by `DietitianAccountService`, not shape validation — a schema cannot
 * see other rows.
 *
 * Bounds note: the length and password bounds are design decisions matching the
 * persisted column widths and the existing admin-creation surface. The
 * requirements pin only the Mobile number rules.
 */
export const createDietitianSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Full name is required")
    .max(100, "Full name cannot exceed 100 characters"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Enter a valid email address")
    .max(254, "Email cannot exceed 254 characters"),
  mobile: dietitianMobileSchema,
  password: z.string().min(6, "Password must be at least 6 characters"),
  clinicId: dietitianClinicIdSchema,
});

export type CreateDietitianInput = z.infer<typeof createDietitianSchema>;

/**
 * Edit Dietitian input (Requirements 3.5, 3.6).
 *
 * The email and password are not editable on this surface; the assigned Clinic
 * always is, and may be cleared back to `null`.
 */
export const updateDietitianSchema = createDietitianSchema.omit({
  password: true,
  email: true,
});

export type UpdateDietitianInput = z.infer<typeof updateDietitianSchema>;

/**
 * Dietitian_Link write input (Requirements 6.1, 6.2, 6.4).
 *
 * `dietitianUserId` is nullable because an empty Dietitian_Link is valid for
 * every Customer_Category (Requirement 6.2). A malformed reference is reported
 * with the same message the service returns when the referenced `users` row is
 * not a Dietitian (Requirement 6.4), so the caller sees one consistent string
 * for "that is not a dietitian".
 */
export const assignDietitianSchema = z.object({
  customerProfileId: z.string().uuid("Invalid customer profile ID"),
  dietitianUserId: z
    .string()
    .uuid(SELECTED_USER_IS_NOT_A_DIETITIAN)
    .nullable(),
});

export type AssignDietitianInput = z.infer<typeof assignDietitianSchema>;
