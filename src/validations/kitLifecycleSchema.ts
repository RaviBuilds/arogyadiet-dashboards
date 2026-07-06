// src/validations/kitLifecycleSchema.ts
//
// Zod validation schemas for KIT lifecycle management server actions.
// Used by sendNewKitAction and startNewKitAction for input validation.
//
// Validates: Requirements 4.3, 4.5, 4.6, 4.7

import { z } from "zod";

/** Courier partner options matching kit_shipping_info.courier_partner values. */
export const COURIER_PARTNERS = ["OTHER", "APSRTC", "TGSRTC", "DTDC"] as const;
export type CourierPartner = (typeof COURIER_PARTNERS)[number];

/** Meal preference options for KIT subscriptions. */
export const MEAL_PREFERENCES = ["Veg", "Egg", "Chicken"] as const;
export type MealPreference = (typeof MEAL_PREFERENCES)[number];

/**
 * Schema for the Send New KIT workflow form.
 *
 * Req 4.3: KIT Duration days — positive integer 1-365.
 * Req 4.5: Address selection with optional new address inline.
 * Req 4.6: New address fields — addressLine min 5 chars, pinCode exactly 6 digits.
 * Req 4.7: Shipping details — courier partner, tracking number, tracking URL (required for OTHER).
 */
export const sendNewKitSchema = z
  .object({
    kitProductId: z.string().uuid("Select a valid KIT product."),

    kitDurationDays: z.coerce
      .number()
      .int("Kit duration must be a whole number.")
      .min(1, "Kit duration must be at least 1 day.")
      .max(365, "Kit duration cannot exceed 365 days."),

    mealPreference: z.enum(MEAL_PREFERENCES, {
      message: "Select a meal preference.",
    }),

    addressId: z.string().uuid("Select a valid address."),

    newAddress: z
      .object({
        addressLine: z
          .string()
          .min(5, "Address line must be at least 5 characters."),
        city: z.string().min(1, "City is required."),
        state: z.string().min(1, "State is required."),
        pinCode: z
          .string()
          .regex(/^\d{6}$/, "PIN code must be exactly 6 digits."),
      })
      .optional(),

    courierPartner: z.enum(COURIER_PARTNERS, {
      message: "Select a courier partner.",
    }),

    trackingNumber: z
      .string()
      .min(1, "Tracking number is required."),

    trackingUrl: z.string().url("Enter a valid tracking URL.").optional(),
  })
  .superRefine((data, ctx) => {
    // Req 4.7: tracking URL is required when courier partner is "OTHER".
    if (data.courierPartner === "OTHER" && !data.trackingUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["trackingUrl"],
        message: "Tracking URL is required when courier partner is Other shipping.",
      });
    }
  });

/**
 * Schema for the Start New KIT action.
 *
 * Validates subscriptionId as UUID and startDate as a valid ISO date string (yyyy-MM-dd).
 * Date bounds (not in future, not before delivered_at) are enforced in the service layer
 * since they require runtime state.
 */
export const startNewKitSchema = z.object({
  subscriptionId: z.string().uuid("Invalid subscription ID."),

  startDate: z
    .string()
    .regex(
      /^\d{4}-\d{2}-\d{2}$/,
      "Date must be in yyyy-MM-dd format."
    )
    .refine((val) => {
      const date = new Date(val);
      return !isNaN(date.getTime());
    }, "Invalid date value."),
});

/** Inferred type for Send New KIT form payload. */
export type SendNewKitInput = z.infer<typeof sendNewKitSchema>;

/** Inferred type for Start New KIT action payload. */
export type StartNewKitInput = z.infer<typeof startNewKitSchema>;
