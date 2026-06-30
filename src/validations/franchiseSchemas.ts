// src/validations/franchiseSchemas.ts
import { z } from "zod";

/**
 * Pincode validation: exactly 6 digits
 */
export const pincodeSchema = z
  .string()
  .regex(/^[0-9]{6}$/, "Pincode must be exactly 6 digits");

/**
 * Franchise name validation
 */
const franchiseNameSchema = z
  .string()
  .min(1, "Franchise name is required")
  .max(100, "Franchise name cannot exceed 100 characters")
  .trim();

/**
 * Franchise status enum
 */
export const franchiseStatusSchema = z.enum([
  "onboarding",
  "active",
  "suspended",
]);

/**
 * Schema for creating a new franchise.
 * Note: Pincodes are NOT included — ADMIN assigns them separately.
 */
export const createFranchiseSchema = z.object({
  name: franchiseNameSchema,
  kitchen_id: z.string().uuid("Invalid kitchen ID").nullable().optional(),
  owner_user_id: z.string().uuid("Invalid owner user ID").nullable().optional(),
});

export type CreateFranchiseInput = z.infer<typeof createFranchiseSchema>;

/**
 * Schema for updating a franchise
 */
export const updateFranchiseSchema = z.object({
  name: franchiseNameSchema.optional(),
  kitchen_id: z.string().uuid("Invalid kitchen ID").nullable().optional(),
  owner_user_id: z.string().uuid("Invalid owner user ID").nullable().optional(),
});

export type UpdateFranchiseInput = z.infer<typeof updateFranchiseSchema>;

/**
 * Schema for franchise status transition
 * Valid transitions:
 *   onboarding → active
 *   active → suspended
 *   suspended → active
 */
export const statusTransitionSchema = z
  .object({
    franchise_id: z.string().uuid("Invalid franchise ID"),
    to_status: franchiseStatusSchema,
  })
  .refine(
    (data) => data.to_status !== "onboarding",
    "Cannot transition to 'onboarding' status"
  );

export type StatusTransitionInput = z.infer<typeof statusTransitionSchema>;

/**
 * Schema for assigning pincodes to a franchise
 */
export const assignPincodesSchema = z.object({
  franchise_id: z.string().uuid("Invalid franchise ID"),
  pincodes: z
    .array(pincodeSchema)
    .min(1, "At least one pincode is required")
    .max(1000, "Cannot assign more than 1000 pincodes at once"),
});

export type AssignPincodesInput = z.infer<typeof assignPincodesSchema>;

/**
 * Schema for removing pincodes from a franchise
 */
export const removePincodesSchema = z.object({
  franchise_id: z.string().uuid("Invalid franchise ID"),
  pincodes: z
    .array(pincodeSchema)
    .min(1, "At least one pincode is required"),
});

export type RemovePincodesInput = z.infer<typeof removePincodesSchema>;

/**
 * Schema for a franchise admin requesting a new service-area pincode
 */
export const requestPincodeSchema = z.object({
  pincode: pincodeSchema,
});

export type RequestPincodeInput = z.infer<typeof requestPincodeSchema>;

/**
 * Schema for an admin reviewing (approving / rejecting) a pincode request
 */
export const reviewPincodeRequestSchema = z.object({
  request_id: z.string().uuid("Invalid request ID"),
  notes: z.string().max(500, "Notes cannot exceed 500 characters").optional(),
});

export type ReviewPincodeRequestInput = z.infer<typeof reviewPincodeRequestSchema>;

/**
 * Schema for franchise list filters
 */
export const franchiseListFiltersSchema = z.object({
  status: franchiseStatusSchema.optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  per_page: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type FranchiseListFiltersInput = z.infer<typeof franchiseListFiltersSchema>;
