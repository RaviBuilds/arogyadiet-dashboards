// src/validations/addressSchema.ts
import { z } from "zod";
import { getPincodeValidationError } from "@/lib/address/validatePincode";

export function createAddressSchema(serviceAreaPincodes: string[] = []) {
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
