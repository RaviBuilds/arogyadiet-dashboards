// src/validations/clinic.ts
// Zod schemas for the City → Kitchen → Clinic hierarchy (core-clinic-architecture).
// These complement the pure validators in `src/lib/clinic/validation.ts` and are
// used by the master-portal React Hook Form + Zod forms and Server Actions.
//
// Bound note (Requirements 3 vs 14): `clinicCreateSchema` uses the stricter
// canonical create bounds (name 1..120, address 1..255, Requirement 3.5). The
// master-portal form may accept the wider Requirement 14 bounds at its surface
// (name 1..200, address 1..500) while the persisted column widths use the
// widest declared bound.

import { z } from "zod";

/**
 * Pincode validation: exactly 6 numeric digits (Requirement 5.4).
 */
export const pincodeSchema = z
  .string()
  .regex(/^[0-9]{6}$/, "Pincode must be exactly 6 digits");

/**
 * City name (Requirement 1.1): non-empty, 1 to 100 characters.
 */
export const citySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "City name is required")
    .max(100, "City name cannot exceed 100 characters"),
});

export type CityInput = z.infer<typeof citySchema>;

/**
 * Clinic create input (Requirement 3.5 canonical bounds).
 *   - name: 1..120 characters
 *   - address: 1..255 characters
 *   - latitude: -90..90 inclusive
 *   - longitude: -180..180 inclusive
 *   - kitchen_id: a valid UUID reference
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
