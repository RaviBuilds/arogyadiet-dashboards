// src/validations/addressSchema.ts
import { z } from "zod";

export const addressSchema = z.object({
  id: z.string().optional(),
  tag: z.enum(["Home", "Work", "Other"]),
  street_1: z.string().min(5, "Street address must be at least 5 characters."),
  street_2: z.string().optional(),
  landmark: z.string().optional(),
  city: z.string(),
  state: z.string(),
  is_primary: z.boolean(),
  pincode: z
    .string()
    .regex(
      /^500\d{3}$/,
      "Sorry, we currently only deliver to Hyderabad pincodes (500XXX).",
    ),
  lat: z.number().optional().nullable(),
  lng: z.number().optional().nullable(),
});

export type AddressFormValues = z.infer<typeof addressSchema>;
