"use server";

// src/actions/healthLogActions.ts
//
// Server actions for accommodation health log management.
// Handles customer-submitted daily logs (water intake, activity) and
// admin-submitted health metrics (weight, BP, sugar).
//
// Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 13.5, 13.6

import { createClient } from "@/lib/supabase/server";
import * as healthLogRepository from "@/repositories/healthLogRepository";
import * as stayRepository from "@/repositories/stayRepository";
import {
  customerHealthLogSchema,
  adminHealthLogSchema,
  type CustomerHealthLogInput,
  type AdminHealthLogInput,
} from "@/validations/accommodationSchema";
import { getISTDateString } from "@/lib/dates/ist";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActionSuccess<T> = { success: true; data: T };
type ActionError = { error: string; fieldErrors?: Record<string, string> };
type ActionResult<T> = ActionSuccess<T> | ActionError;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Authenticate the current customer session and resolve their customer_profile_id.
 * Mirrors the pattern from kitLifecycleActions.
 */
async function authenticateCustomer(): Promise<
  { success: true; customerProfileId: string } | { success: false; error: string }
> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { success: false, error: "Unauthorized" };
  }

  const { data: dbUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!dbUser) {
    return { success: false, error: "User not found." };
  }

  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", dbUser.id)
    .single();

  if (!profile) {
    return { success: false, error: "Customer profile not found." };
  }

  return { success: true, customerProfileId: profile.id };
}

// ---------------------------------------------------------------------------
// 9.1, 9.2, 9.3, 9.4 — submitCustomerHealthLogAction
// ---------------------------------------------------------------------------

/**
 * Submit (upsert) a customer health log entry for today's date.
 *
 * - Authenticates the customer
 * - Validates active stay requirement
 * - Validates input with customerHealthLogSchema
 * - Upserts the log for (stay_entry_id, today IST)
 *
 * Req 9.1, 9.2, 9.3, 9.4
 */
export async function submitCustomerHealthLogAction(
  input: CustomerHealthLogInput
): Promise<ActionResult<null>> {
  try {
    // 1. Authenticate customer
    const auth = await authenticateCustomer();
    if (!auth.success) {
      return { error: auth.error };
    }

    // 2. Get customer's active stay
    const activeStay = await stayRepository.getActiveStay(auth.customerProfileId);
    if (!activeStay) {
      return { error: "Health logging is available during active stays only" };
    }

    // 3. Validate input
    const parsed = customerHealthLogSchema.safeParse(input);
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

    // 4. Upsert customer health log for today (IST)
    const todayIST = getISTDateString();
    await healthLogRepository.upsertCustomerHealthLog({
      stay_entry_id: activeStay.id,
      customer_profile_id: auth.customerProfileId,
      log_date: todayIST,
      water_intake_liters: parsed.data.waterIntakeLiters,
      activity_name: parsed.data.activityName ?? null,
      activity_duration_minutes: parsed.data.activityDurationMinutes ?? null,
    });

    return { success: true, data: null };
  } catch (err) {
    console.error("submitCustomerHealthLogAction error:", err);
    return { error: "Failed to save health log. Please try again." };
  }
}

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
