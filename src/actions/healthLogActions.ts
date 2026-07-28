"use server";

// src/actions/healthLogActions.ts
//
// Server actions for accommodation health log management.
// Handles customer-submitted daily logs (water intake, activity) and
// admin-submitted health metrics (weight, BP, sugar).
//
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 13.5, 13.6

import * as healthLogRepository from "@/repositories/healthLogRepository";
import * as stayRepository from "@/repositories/stayRepository";
import {
  adminHealthLogSchema,
  type AdminHealthLogInput,
} from "@/validations/accommodationSchema";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionSuccess<T> = { success: true; data: T };
type ActionError = { error: string; fieldErrors?: Record<string, string> };
type ActionResult<T> = ActionSuccess<T> | ActionError;

// ---------------------------------------------------------------------------
// 10.1, 13.5 — submitAdminHealthLogAction
// ---------------------------------------------------------------------------

/**
 * Submit an admin health log entry for a specific stay and date.
 *
 * - Validates input with adminHealthLogSchema
 * - Gets the stay to retrieve customer_profile_id
 * - Inserts the admin health log
 *
 * Req 10.1, 13.5
 */
export async function submitAdminHealthLogAction(
  stayId: string,
  input: AdminHealthLogInput
): Promise<ActionResult<null>> {
  try {
    // 1. Validate input
    const parsed = adminHealthLogSchema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".");
        if (field && !fieldErrors[field]) {
          fieldErrors[field] = issue.message;
        }
      }
      return { error: "Validation failed", fieldErrors };
    }

    // 2. Get the stay to get customer_profile_id
    const stay = await stayRepository.getStayById(stayId);
    if (!stay) {
      return { error: "Stay not found." };
    }

    // 3. Insert admin health log
    await healthLogRepository.insertAdminHealthLog({
      stay_entry_id: stayId,
      customer_profile_id: stay.customer_profile_id,
      log_date: parsed.data.logDate,
      weight_kg: parsed.data.weightKg ?? null,
      bp_systolic: parsed.data.bpSystolic ?? null,
      bp_diastolic: parsed.data.bpDiastolic ?? null,
      sugar_level_mgdl: parsed.data.sugarLevelMgdl ?? null,
      notes: parsed.data.notes ?? null,
    });

    return { success: true, data: null };
  } catch (err) {
    console.error("submitAdminHealthLogAction error:", err);
    return { error: "Failed to save health log. Please try again." };
  }
}

// ---------------------------------------------------------------------------
// 9.5, 13.6 — getCustomerHealthLogsAction
// ---------------------------------------------------------------------------

/**
 * Get all customer health logs for a given stay.
 *
 * Req 9.5, 13.6
 */
export async function getCustomerHealthLogsAction(
  stayId: string
): Promise<ActionResult<healthLogRepository.CustomerHealthLogRow[]>> {
  try {
    const logs = await healthLogRepository.getCustomerHealthLogs(stayId);
    return { success: true, data: logs };
  } catch (err) {
    console.error("getCustomerHealthLogsAction error:", err);
    return { error: "Failed to fetch health logs." };
  }
}

// ---------------------------------------------------------------------------
// 10.1, 13.5 — getAdminHealthLogsAction
// ---------------------------------------------------------------------------

/**
 * Get all admin health logs for a given stay.
 *
 * Req 10.1, 13.5
 */
export async function getAdminHealthLogsAction(
  stayId: string
): Promise<ActionResult<healthLogRepository.AdminHealthLogRow[]>> {
  try {
    const logs = await healthLogRepository.getAdminHealthLogs(stayId);
    return { success: true, data: logs };
  } catch (err) {
    console.error("getAdminHealthLogsAction error:", err);
    return { error: "Failed to fetch health logs." };
  }
}
