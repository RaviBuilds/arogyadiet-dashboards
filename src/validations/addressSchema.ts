// src/validations/addressSchema.ts
import { z } from "zod";
import {
  getPincodeValidationError,
  PINCODE_FORMAT_REGEX,
} from "@/lib/address/validatePincode";

/**
 * @param serviceAreaPincodes  Deliverable pincodes for serviceability checks.
 * @param bypassServiceability When true (e.g. KIT customers, whose orders ship
 *   by courier rather than local delivery), the pincode is only validated for
 *   the 6-digit format — the service-area / "we don't deliver here" check is
 *   skipped entirely. Mirrors the admin `validateAddressForCategory` KIT rule.
 */
export function createAddressSchema(
  serviceAreaPincodes: string[] = [],
  bypassServiceability = false,
) {
  return z.object({
    id: z.string().optional(),
    tag: z.enum(["Home", "Work", "Other"]),
    street_1: z
      .string()
      .min(5, "Street address must be at least 5 characters."),
    street_2: z.string().optional(),
    landmark: z.string().optional(),
    city: z.string(),
    state: z.string(),
    is_primary: z.boolean(),
    pincode: z.string().superRefine((value, ctx) => {
      if (bypassServiceability) {
        if (!PINCODE_FORMAT_REGEX.test(value.trim())) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Pincode must be exactly 6 digits.",
          });
        }
        return;
      }
      const error = getPincodeValidationError(value, serviceAreaPincodes);
      if (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error,
        });
      }
    }),
    lat: z.number().optional().nullable(),
    lng: z.number().optional().nullable(),
  });
}

export const addressSchema = createAddressSchema();

export type AddressFormValues = z.infer<typeof addressSchema>;
