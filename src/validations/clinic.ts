// src/validations/clinic.ts
// Zod schemas for the Business → Kitchen → Clinic hierarchy
// (core-clinic-architecture).
//
// These guard the form layer (React Hook Form + Zod) and the master/admin
// Server Actions. They complement the pure validators in
// `src/lib/clinic/validation.ts`, which remain the canonical source of truth for
// field-level error reporting.
//
// Bounds note (Requirement 3 vs 14/21): the clinic has two validation surfaces.
// `clinicCreateSchema` uses the stricter canonical create bounds (name 1..120,
// address 1..255, Requirement 3.5). `clinicMasterSchema` widens those to the
// master Core Business surface bounds (name 1..200, address 1..500, Requirements
// 14.2 / 21.5), matching the persisted column widths so no valid input is
// truncated.

import { z } from "zod";

/**
 * Pincode validation: exactly 6 numeric digits (Requirement 5.4).
 */
export const pincodeSchema = z
  .string()
  .regex(/^\d{6}$/, "Pincode must be exactly 6 digits");

/**
 * Business input (Requirement 20.1, 20.10): trimmed name 1..100 and a
 * type discriminator of `Core` or `Franchise`.
 */
export const businessSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Business name is required")
    .max(100, "Business name cannot exceed 100 characters"),
  type: z.enum(["Core", "Franchise"]),
});

export type BusinessSchemaInput = z.infer<typeof businessSchema>;

/**
 * Kitchen input (Requirements 2.2, 2.4, 2.5, 2.8, 2.9): a name, a required
 * Business reference, and a required City reference. A Kitchen carries NO
 * address / latitude / longitude — the geographic routing origin is always the
 * Clinic (Requirement 2.5, 21.4).
 */
export const kitchenSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Kitchen name is required")
    .max(120, "Kitchen name cannot exceed 120 characters"),
  business_id: z.string().uuid("Invalid business ID"),
  city_id: z.string().uuid("Invalid city ID"),
  // no address/lat/lng (Req 2.5, 21.4)
});

export type KitchenSchemaInput = z.infer<typeof kitchenSchema>;

/**
 * Clinic create input — canonical Requirement 3 bounds.
 *   - name: 1..120 characters
 *   - address: 1..255 characters
 *   - latitude: -90..90 inclusive
 *   - longitude: -180..180 inclusive
 *   - kitchen_id: a valid UUID reference (Business resolved via Kitchen)
 */
export const clinicCreateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Clinic name is required")
    .max(120, "Clinic name cannot exceed 120 characters"),
  address: z
    .string()
    .trim()
    .min(1, "Clinic address is required")
    .max(255, "Clinic address cannot exceed 255 characters"),
  latitude: z
    .number()
    .min(-90, "Latitude must be between -90 and 90")
    .max(90, "Latitude must be between -90 and 90"),
  longitude: z
    .number()
    .min(-180, "Longitude must be between -180 and 180")
    .max(180, "Longitude must be between -180 and 180"),
  kitchen_id: z.string().uuid("Invalid kitchen ID"),
});

export type ClinicCreateSchemaInput = z.infer<typeof clinicCreateSchema>;

/**
 * Clinic master input — wider master Core Business surface bounds
 * (Requirements 14.2 / 21.5), matching the persisted column widths.
 *   - name: 1..200 characters
 *   - address: 1..500 characters
 * Latitude / longitude / kitchen_id constraints are inherited unchanged.
 */
export const clinicMasterSchema = clinicCreateSchema.extend({
  name: z
    .string()
    .trim()
    .min(1, "Clinic name is required")
    .max(200, "Clinic name cannot exceed 200 characters"),
  address: z
    .string()
    .trim()
    .min(1, "Clinic address is required")
    .max(500, "Clinic address cannot exceed 500 characters"),
});

export type ClinicMasterSchemaInput = z.infer<typeof clinicMasterSchema>;

/**
 * City name (Requirement 1.1): non-empty, trimmed, 1 to 100 characters.
 */
export const citySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "City name is required")
    .max(100, "City name cannot exceed 100 characters"),
});

export type CityInput = z.infer<typeof citySchema>;
