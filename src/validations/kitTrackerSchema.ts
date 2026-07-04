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
    fatConsumption: z
      .string()
      .max(200, "Fat consumption must be at most 200 characters.")
      .optional(),
    waterIntakeLiters: z
      .number()
      .min(0, "Water intake cannot be negative.")
      .max(20, "Water intake cannot exceed 20 liters.")
      .optional(),
    buttermilkIntake: z
      .string()
      .max(200, "Buttermilk intake must be at most 200 characters.")
      .optional(),
    soupNameQty: z
      .string()
      .max(200, "Soup details must be at most 200 characters.")
      .optional(),
    proteinCurry: z
      .string()
      .max(200, "Protein curry must be at most 200 characters.")
      .optional(),
    mainDish: z
      .string()
      .max(200, "Main dish must be at most 200 characters.")
      .optional(),
    vegCurry: z
      .string()
      .max(200, "Veg curry must be at most 200 characters.")
      .optional(),
    eggsCount: z
      .number()
      .int("Eggs count must be a whole number.")
      .min(0, "Eggs count cannot be negative.")
      .max(50, "Eggs count cannot exceed 50.")
      .optional(),
    saladsQty: z
      .string()
      .max(200, "Salads quantity must be at most 200 characters.")
      .optional(),
    stepCount: z
      .number()
      .int("Step count must be a whole number.")
      .min(0, "Step count cannot be negative.")
      .max(200000, "Step count cannot exceed 200,000.")
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
