// src/validations/kitBulkImportSchema.ts
//
// Zod schema for a single row of the KIT customer bulk-import spreadsheet.
//
// LAYERING: Pure validation. It mirrors the rules the interactive
// Quick_Onboarding_Form enforces for Primary_Category = KIT
// (`createQuickOnboardingSchema` + `createAddressCaptureSchema`) with two
// deliberate relaxations that only make sense for an offline migration:
//
//   1. `lat` / `lng` are nullable. A KIT kit ships by courier, so the pincode
//      alone is enough; offline records rarely carry coordinates. The
//      interactive form resolves them from the map picker and therefore keeps
//      them mandatory.
//   2. `startDate` may be in the past without the past-date acknowledgement
//      flow, because the rows being imported describe kits already dispatched.
//      Daily-preference generation does not run for KIT, so no per-day records
//      have to be reconstructed.
//
// Serviceability is NOT checked (KIT bypasses it, matching Req 3.1/3.2 of the
// KIT onboarding rules).

import { z } from "zod";

/** Genders accepted by `customer_profiles.gender`. */
export const KIT_BULK_GENDERS = ["Male", "Female", "Other"] as const;

/** Dietary preferences accepted by `customer_profiles.dietary_preference`. */
export const KIT_BULK_DIETARY_PREFERENCES = ["Veg", "Non-Veg"] as const;

/** Meal categories a subscription can be seeded with. */
export const KIT_BULK_MEAL_PREFERENCES = ["VEG", "EGG", "CHICKEN"] as const;

/** Address tags supported by Address_Capture. */
export const KIT_BULK_ADDRESS_TAGS = ["Home", "Office"] as const;

/**
 * A KIT import row after string cleanup, enum normalization, reference
 * resolution (kit product / clinic name → UUID) and default application.
 */
export const kitBulkCustomerRowSchema = z.object({
  fullName: z
    .string()
    .min(2, "Required (at least 2 characters).")
    .max(100, "Must be at most 100 characters."),
  mobile: z
    .string()
    .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number (starts with 6-9)."),
  gender: z.enum(KIT_BULK_GENDERS, {
    message: "Must be Male, Female or Other.",
  }),
  dietaryPreference: z.enum(KIT_BULK_DIETARY_PREFERENCES, {
    message: "Must be Veg or Non-Veg.",
  }),
  email: z
    .string()
    .max(254, "Must be at most 254 characters.")
    .email("Enter a valid email address.")
    .optional(),
  allergies: z.string().max(500, "Must be at most 500 characters.").optional(),

  // Resolved from the `kit_product` column against active kit_products.
  kitProductId: z.string().uuid("Unknown KIT product."),
  kitDurationDays: z
    .number()
    .int("Must be a whole number of days.")
    .min(1, "Must be at least 1 day.")
    .max(365, "Must be at most 365 days."),

  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the YYYY-MM-DD format.")
    .optional(),
  initialMealPreference: z.enum(KIT_BULK_MEAL_PREFERENCES, {
    message: "Must be VEG, EGG or CHICKEN.",
  }),

  // Only PAID is accepted: OnboardingService refuses to persist anything for a
  // non-PAID payment status (Req 8.1/8.2).
  paymentStatus: z.literal("PAID", {
    message: "Only PAID is accepted for a KIT import.",
  }),
  tempPin: z.string().regex(/^\d{6}$/, "Must be exactly 6 digits."),

  // Optional manual clinic assignment, resolved from the `clinic_name` column.
  clinicId: z.string().uuid("Unknown clinic.").optional(),

  address: z.object({
    tag: z.enum(KIT_BULK_ADDRESS_TAGS, {
      message: "Must be Home or Office.",
    }),
    flatNumber: z
      .string()
      .min(1, "Required.")
      .max(50, "Must be at most 50 characters."),
    floorNumber: z.string().max(20, "Must be at most 20 characters.").optional(),
    streetAddress: z
      .string()
      .max(255, "Must be at most 255 characters.")
      .optional(),
    area: z.string().min(1, "Required."),
    city: z.string().min(1, "Required."),
    state: z.string().min(1, "Required."),
    pincode: z.string().regex(/^\d{6}$/, "Must be exactly 6 digits."),
    lat: z
      .number()
      .min(-90, "Must be between -90 and 90.")
      .max(90, "Must be between -90 and 90.")
      .nullable(),
    lng: z
      .number()
      .min(-180, "Must be between -180 and 180.")
      .max(180, "Must be between -180 and 180.")
      .nullable(),
  }),
});

export type KitBulkCustomerRow = z.infer<typeof kitBulkCustomerRowSchema>;

/**
 * Map a Zod issue path back to the spreadsheet column the client filled in, so
 * validation feedback names the column instead of the internal field.
 */
const SCHEMA_PATH_TO_COLUMN: Record<string, string> = {
  fullName: "full_name",
  mobile: "mobile",
  gender: "gender",
  dietaryPreference: "dietary_preference",
  email: "email",
  allergies: "allergies",
  kitProductId: "kit_product",
  kitDurationDays: "kit_duration_days",
  startDate: "start_date",
  initialMealPreference: "initial_meal_preference",
  paymentStatus: "payment_status",
  tempPin: "temporary_pin",
  clinicId: "clinic_name",
  "address.tag": "address_tag",
  "address.flatNumber": "address_flat_number",
  "address.floorNumber": "address_floor_number",
  "address.streetAddress": "address_street",
  "address.area": "address_area",
  "address.city": "address_city",
  "address.state": "address_state",
  "address.pincode": "address_pincode",
  "address.lat": "address_lat",
  "address.lng": "address_lng",
};

/** Resolve the spreadsheet column name for a Zod issue path. */
export function kitColumnForPath(path: readonly PropertyKey[]): string {
  const key = path.map((segment) => String(segment)).join(".");
  return SCHEMA_PATH_TO_COLUMN[key] ?? key;
}
