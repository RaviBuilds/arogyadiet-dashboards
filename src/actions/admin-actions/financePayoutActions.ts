"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logAdminAction } from "@/lib/logger";
import { revalidatePath } from "next/cache";

// ──────────────────────────────────────────────
// Rider Payout Adjustments
// Manual +/- adjustments to a rider's payout without altering delivery logs.
// ──────────────────────────────────────────────

interface AddAdjustmentInput {
  summaryId: string;
  riderId: string;
  adjustmentType: string;
  amount: number; // positive = addition, negative = deduction
  reason: string;
}

export async function addPayoutAdjustment(input: AddAdjustmentInput) {
  const supabase = createAdminClient();
  const userSupabase = await createClient();

  const {
    data: { user },
  } = await userSupabase.auth.getUser();

  if (!user) {
    return { error: "Unauthorized" };
  }

  // Get the admin user's internal user ID
  const { data: adminUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  // Verify the summary exists and is in GENERATED status
  const { data: summary, error: fetchErr } = await supabase
    .from("rider_monthly_summaries")
    .select("id, status, total_earnings, adjustment_total, final_amount")
    .eq("id", input.summaryId)
    .single();

  if (fetchErr || !summary) {
    return { error: "Payout summary not found." };
  }

  if (summary.status === "PAID") {
    return { error: "Cannot adjust a payout that has already been released." };
  }

  // Insert adjustment record
  const { error: insertErr } = await supabase
    .from("rider_payout_adjustments")
    .insert({
      rider_id: input.riderId,
      summary_id: input.summaryId,
      adjustment_type: input.adjustmentType,
      amount: input.amount,
      reason: input.reason,
      created_by: adminUser?.id || null,
    });

  if (insertErr) {
    return { error: insertErr.message };
  }

  // Recalculate the total adjustments for this summary
  const { data: allAdjustments } = await supabase
    .from("rider_payout_adjustments")
    .select("amount")
    .eq("summary_id", input.summaryId);

  const newAdjTotal = (allAdjustments || []).reduce(
    (sum, a) => sum + Number(a.amount || 0),
    0,
  );

  const baseEarnings = Number(summary.total_earnings || 0);
  const newFinalAmount = baseEarnings + newAdjTotal;

  // Update the summary with new totals
  const { error: updateErr } = await supabase
    .from("rider_monthly_summaries")
    .update({
      adjustment_total: Number(newAdjTotal.toFixed(2)),
      final_amount: Number(newFinalAmount.toFixed(2)),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.summaryId);

  if (updateErr) {
    return { error: updateErr.message };
  }

  await logAdminAction("CREATE", "rider_payout_adjustment", input.summaryId, {
    rider_id: input.riderId,
    type: input.adjustmentType,
    amount: input.amount,
    reason: input.reason,
  });

  revalidatePath("/master/finance");
  return { success: true, newAdjTotal, newFinalAmount };
}

// ──────────────────────────────────────────────
// Get Adjustments for a Summary
// ──────────────────────────────────────────────

export async function getPayoutAdjustments(summaryId: string) {
  const supabase = createAdminClient();

  const { data, error } = await supabase
    .from("rider_payout_adjustments")
    .select("id, adjustment_type, amount, reason, created_at, created_by, users(full_name)")
    .eq("summary_id", summaryId)
    .order("created_at", { ascending: false });

  if (error) {
    return [];
  }

  return (data || []).map((a: any) => ({
    id: a.id,
    type: a.adjustment_type,
    amount: Number(a.amount || 0),
    reason: a.reason,
    createdAt: a.created_at,
    createdBy: a.users?.full_name || "System",
  }));
}
