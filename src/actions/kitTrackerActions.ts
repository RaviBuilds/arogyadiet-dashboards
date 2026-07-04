"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { format } from "date-fns";
import {
  receivedDateSchema,
  dailyLogSchema,
  type DailyLogInput,
} from "@/validations/kitTrackerSchema";

export interface KitDailyLog {
  id: string;
  subscription_id: string;
  log_date: string;
  status: "FOOD_TAKEN" | "FOOD_SKIPPED";
  physical_activity_minutes: number | null;
  physical_activity_name: string | null;
  weight_kg: number | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Server-clock today in yyyy-MM-dd (IST). */
function getServerToday(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/**
 * Parse trigger / constraint error messages from Supabase/Postgres into
 * user-friendly strings.
 */
function parseTriggerError(message: string): string {
  if (message.includes("kit_daily_logs rows may only be created for KIT")) {
    return "This action is only available for KIT subscriptions.";
  }
  if (message.includes("kit_received_date may only be set for KIT")) {
    return "Received date can only be set for KIT subscriptions.";
  }
  if (message.includes("kit_received_date is locked")) {
    return "The received date is locked and cannot be changed after daily logs have been recorded.";
  }
  if (message.includes("chk_kit_tracker_fields_kit_only")) {
    return "KIT tracker fields can only be set for KIT subscriptions.";
  }
  if (message.includes("chk_skipped_has_no_optional_fields")) {
    return "Food skipped entries cannot have activity or weight data.";
  }
  return "An unexpected error occurred. Please try again.";
}

// ---------------------------------------------------------------------------
// 3.2 — confirmReceivedDateAction
// ---------------------------------------------------------------------------

export async function confirmReceivedDateAction(
  subscriptionId: string,
  receivedDate: string
): Promise<{ success: true } | { success: false; error: string }> {
  // 1. Validate date format
  const parsed = receivedDateSchema.safeParse(receivedDate);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const today = getServerToday();

  // 2. Fetch subscription and verify KIT category
  const { data: subscription, error: fetchError } = await supabase
    .from("subscriptions")
    .select(
      "id, customer_category, starts_on, kit_duration_days, kit_total_skipped_days"
    )
    .eq("id", subscriptionId)
    .single();

  if (fetchError || !subscription) {
    return { success: false, error: "Subscription not found." };
  }

  if (subscription.customer_category !== "KIT") {
    return {
      success: false,
      error: "This action is only available for KIT subscriptions.",
    };
  }

  // 3. Validate receivedDate is not in the future
  if (receivedDate > today) {
    return {
      success: false,
      error: "The received date cannot be in the future.",
    };
  }

  // 4. Compute tracker end date
  // kit_tracker_end_date = receivedDate + (kit_duration_days - 1) + kit_total_skipped_days
  const durationDays = subscription.kit_duration_days ?? 0;
  const skippedDays = subscription.kit_total_skipped_days ?? 0;
  const totalDaysToAdd = durationDays - 1 + skippedDays;

  // Compute the end date using date arithmetic
  const receivedDateObj = new Date(receivedDate + "T00:00:00");
  receivedDateObj.setDate(receivedDateObj.getDate() + totalDaysToAdd);
  const trackerEndDate = format(receivedDateObj, "yyyy-MM-dd");

  // 5. Update subscription
  const { error: updateError } = await supabase
    .from("subscriptions")
    .update({
      kit_received_date: receivedDate,
      kit_tracker_end_date: trackerEndDate,
    })
    .eq("id", subscriptionId);

  if (updateError) {
    return { success: false, error: parseTriggerError(updateError.message) };
  }

  // 6. Mark shipping status as delivered when customer confirms receipt
  await supabase
    .from("kit_shipping_info")
    .update({ delivered_at: new Date().toISOString() })
    .eq("subscription_id", subscriptionId)
    .is("delivered_at", null);

  // 7. Also update starts_on on the subscription to the received date (KIT start = received date)
  await supabase
    .from("subscriptions")
    .update({ starts_on: receivedDate })
    .eq("id", subscriptionId);

  // Revalidate the customer dashboard so shipping status updates immediately
  revalidatePath("/dashboard");

  return { success: true };
}

// ---------------------------------------------------------------------------
// 3.3 — saveDailyLogAction
// ---------------------------------------------------------------------------

export async function saveDailyLogAction(
  subscriptionId: string,
  logDate: string,
  input: DailyLogInput
): Promise<
  | { success: true; totalSkippedDays: number; trackerEndDate: string }
  | { success: false; error: string }
> {
  // 1. Validate input with Zod
  const parsed = dailyLogSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0].message };
  }

  // 2. Validate logDate format
  const dateValid = receivedDateSchema.safeParse(logDate);
  if (!dateValid.success) {
    return { success: false, error: "Invalid log date format." };
  }

  const supabase = await createClient();
  const today = getServerToday();

  // 3. Fetch subscription to verify category and received date
  const { data: subscription, error: fetchError } = await supabase
    .from("subscriptions")
    .select("id, customer_category, kit_received_date")
    .eq("id", subscriptionId)
    .single();

  if (fetchError || !subscription) {
    return { success: false, error: "Subscription not found." };
  }

  if (subscription.customer_category !== "KIT") {
    return {
      success: false,
      error: "This action is only available for KIT subscriptions.",
    };
  }

  if (!subscription.kit_received_date) {
    return {
      success: false,
      error: "Please confirm your package received date first.",
    };
  }

  // 4. Validate logDate is within [kit_received_date, today] inclusive
  if (logDate < subscription.kit_received_date) {
    return {
      success: false,
      error: "The log date cannot be before the received date.",
    };
  }

  if (logDate > today) {
    return {
      success: false,
      error: "The log date cannot be in the future.",
    };
  }

  // 5. Prepare upsert values — force null for FOOD_SKIPPED
  const validInput = parsed.data;
  const status = validInput.status;

  const activityMinutes =
    status === "FOOD_TAKEN" && "activityMinutes" in validInput
      ? (validInput.activityMinutes ?? null)
      : null;
  const activityName =
    status === "FOOD_TAKEN" && "activityName" in validInput
      ? (validInput.activityName ?? null)
      : null;
  const weightKg =
    status === "FOOD_TAKEN" && "weightKg" in validInput
      ? (validInput.weightKg ?? null)
      : null;

  // 6. INSERT ... ON CONFLICT (subscription_id, log_date) DO UPDATE
  const { error: upsertError } = await supabase
    .from("kit_daily_logs")
    .upsert(
      {
        subscription_id: subscriptionId,
        log_date: logDate,
        status,
        physical_activity_minutes: activityMinutes,
        physical_activity_name: activityName,
        weight_kg: weightKg,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "subscription_id,log_date" }
    );

  if (upsertError) {
    return { success: false, error: parseTriggerError(upsertError.message) };
  }

  // 7. Re-fetch updated tracker state (trigger maintains these)
  const { data: updated, error: refetchError } = await supabase
    .from("subscriptions")
    .select("kit_total_skipped_days, kit_tracker_end_date")
    .eq("id", subscriptionId)
    .single();

  if (refetchError || !updated) {
    return {
      success: false,
      error: "Log saved but failed to retrieve updated tracker state.",
    };
  }

  return {
    success: true,
    totalSkippedDays: updated.kit_total_skipped_days ?? 0,
    trackerEndDate: updated.kit_tracker_end_date ?? "",
  };
}

// ---------------------------------------------------------------------------
// 3.4 — getKitTrackerStateAction
// ---------------------------------------------------------------------------

export async function getKitTrackerStateAction(
  subscriptionId: string
): Promise<{
  receivedDate: string | null;
  trackerEndDate: string | null;
  totalSkippedDays: number;
  dailyLogs: KitDailyLog[];
}> {
  const supabase = await createClient();

  // 1. Fetch tracker columns from subscriptions
  const { data: subscription, error: subError } = await supabase
    .from("subscriptions")
    .select("kit_received_date, kit_tracker_end_date, kit_total_skipped_days")
    .eq("id", subscriptionId)
    .single();

  if (subError || !subscription) {
    return {
      receivedDate: null,
      trackerEndDate: null,
      totalSkippedDays: 0,
      dailyLogs: [],
    };
  }

  // 2. Fetch all daily log rows ordered by log_date ASC
  const { data: logs, error: logsError } = await supabase
    .from("kit_daily_logs")
    .select("*")
    .eq("subscription_id", subscriptionId)
    .order("log_date", { ascending: true });

  return {
    receivedDate: subscription.kit_received_date ?? null,
    trackerEndDate: subscription.kit_tracker_end_date ?? null,
    totalSkippedDays: subscription.kit_total_skipped_days ?? 0,
    dailyLogs: (logs ?? []) as KitDailyLog[],
  };
}
