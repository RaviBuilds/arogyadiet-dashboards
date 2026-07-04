// src/validations/addressCaptureSchema.ts
//
// Zod schema for the map-based Address_Capture component used by the admin
// Quick_Onboarding_Form. This is distinct from the legacy `addressSchema`:
// it adds a Home/Office tag, separate flat/floor inputs, and auto-filled
// locality fields resolved from the selected map location, and gates the
// pincode against the franchise's serviceable pincodes.
//
// Validates: Requirements 5.1, 5.2, 5.4, 5.6

import { z } from "zod";
import {
  isServiceable,
  notServiceableMessage,
} from "@/lib/address/serviceablePincode";

/**
 * Build an Address_Capture schema bound to a specific franchise's serviceable
 * pincodes. When `serviceAreaPincodes` is empty every pincode is treated as
 * not serviceable, so callers should pass the resolved service area.
 *
 * @param serviceAreaPincodes the serviceable pincodes for the admin's franchise
 * @param skipServiceabilityCheck if true, skips the serviceability validation (for KIT category)
 */
export function createAddressCaptureSchema(
  serviceAreaPincodes: string[] = [],
  skipServiceabilityCheck: boolean = false,
) {
  return z.object({
    // Req 5.1: address-tag selector offering exactly Home/Office, Home default.
    tag: z.enum(["Home", "Office"]).default("Home"),

    // Req 5.2: location search box accepting 1-255 chars of locality text.
    searchText: z.string().min(1).max(255).optional(),

    // Req 5.4: flat number is required (1-50 chars); floor number optional (<=20 chars).
    flatNumber: z
      .string()
      .min(1, "Flat number is required.")
      .max(50, "Flat number must be at most 50 characters."),
    floorNumber: z
      .string()
      .max(20, "Floor number must be at most 20 characters.")
      .optional(),

    // Street/locality details auto-filled from map (e.g. "Sree Apartments, 2nd Main Road, Tavarekere")
    streetAddress: z
      .string()
      .max(255, "Street address must be at most 255 characters.")
      .optional(),

    // Req 5.3: auto-filled from the selected map location.
    area: z.string().min(1, "Area could not be resolved from the location."),
    city: z.string().min(1, "City could not be resolved from the location."),
    state: z.string().min(1, "State could not be resolved from the location."),

    // Req 5.6: pincode must be within the franchise's serviceable pincodes (unless skipped for KIT).
    // Req 3.1, 3.2: KIT category bypasses serviceability check, only validates format.
    pincode: z.string().superRefine((value, ctx) => {
      // Basic format validation (6 digits)
      if (!/^\d{6}$/.test(value.trim())) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Pincode must be exactly 6 digits.",
        });
        return;
      }
      
      // Skip serviceability check for KIT category (Req 3.1, 3.2)
      if (skipServiceabilityCheck) {
        return;
      }
      
      // Enforce serviceability for MEAL/ACCOMMODATION (Req 5.6, 3.3)
      if (!isServiceable(value, serviceAreaPincodes)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: notServiceableMessage(value),
        });
      }
    }),

    // Req 5.3: latitude/longitude recorded into addresses.lat / addresses.lng.
    lat: z.number(),
    lng: z.number(),
  });
}

/**
 * Default Address_Capture schema with no serviceable pincodes bound. Used for
 * shape/type inference; the action layer rebuilds it with the resolved service
 * area so the serviceability check is meaningful.
 */
export const addressCaptureSchema = createAddressCaptureSchema();

export type AddressCaptureValues = z.infer<typeof addressCaptureSchema>;
