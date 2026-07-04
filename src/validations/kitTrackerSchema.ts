// src/validations/kitTrackerSchema.ts
//
// Zod validation schemas for KIT Tracker server actions.
// Used by confirmReceivedDateAction and saveDailyLogAction for input validation.
//
// Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 6.1

import { z } from "zod";

/**
 * Discriminated union schema for daily log input.
 *
 * - FOOD_TAKEN: allows optional activityMinutes, activityName, weightKg
 * - FOOD_SKIPPED: no optional fields permitted
 */
export const dailyLogSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("FOOD_TAKEN"),
    activityMinutes: z
      .number()
      .int("Activity minutes must be a whole number.")
      .min(0, "Activity minutes cannot be negative.")
      .max(1440, "Activity minutes cannot exceed 1440.")
      .optional(),
    activityName: z
      .string()
      .max(100, "Activity name must be at most 100 characters.")
      .optional(),
    weightKg: z
      .number()
      .min(0, "Weight cannot be negative.")
      .max(500, "Weight cannot exceed 500 kg.")
      .refine(
        (v) => Math.round(v * 100) === v * 100,
        "Weight must have at most 2 decimal places."
      )
      .optional(),
  }),
  z.object({ status: z.literal("FOOD_SKIPPED") }),
]);

/**
 * Schema for validating received date strings in yyyy-MM-dd format.
 */
export const receivedDateSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}$/,
    "Date must be in yyyy-MM-dd format."
  )
  .refine((val) => {
    const date = new Date(val);
    return !isNaN(date.getTime());
  }, "Invalid date value.");

/** Inferred type for daily log input payload. */
export type DailyLogInput = z.infer<typeof dailyLogSchema>;

/** Inferred type for received date input. */
export type ReceivedDateInput = z.infer<typeof receivedDateSchema>;
