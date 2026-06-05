import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isBatchCompleteByCounts,
  isTerminalOrderStatus,
} from "@/lib/delivery/orderStatuses";
import { notifyBatchCompleted } from "@/lib/delivery/deliveryStatusNotifications";

const INCOMPLETE_BATCH_STATUSES = ["PENDING", "IN_TRANSIT"] as const;

function revalidateBatchCompletionPaths() {
  revalidatePath("/route");
  revalidatePath("/dashboard");
  revalidatePath("/admin/riders");
  revalidatePath("/admin/operations");
  revalidatePath("/rider/route");
  revalidatePath("/rider/dashboard");
}

export type TryCompleteBatchResult = {
  completed: boolean;
  batchId?: string;
};

export async function tryCompleteDeliveryBatch(
  supabase: SupabaseClient,
  batchId: string | null | undefined,
  deliveryDate: string | null | undefined,
): Promise<TryCompleteBatchResult> {
  if (!batchId || !deliveryDate) {
    return { completed: false };
  }

  const { data: orders, error } = await supabase
    .from("delivery_orders")
    .select("status")
    .eq("batch_id", batchId)
    .eq("delivery_date", deliveryDate);

  if (error) {
    console.error("Error fetching batch orders for completion:", error);
    return { completed: false, batchId };
  }

  if (!orders?.length) {
    return { completed: false, batchId };
  }

  const deliveredCount = orders.filter((o) => o.status === "DELIVERED").length;
  const failedCount = orders.filter((o) => o.status === "FAILED").length;
  const allTerminal = orders.every((order) =>
    isTerminalOrderStatus(order.status),
  );
  const completeByCounts = isBatchCompleteByCounts({
    mealCount: orders.length,
    deliveredCount,
    failedCount,
  });

  if (!allTerminal && !completeByCounts) {
    return { completed: false, batchId };
  }

  const { data: updatedBatch, error: updateError } = await supabase
    .from("delivery_batches")
    .update({ status: "COMPLETED" })
    .eq("id", batchId)
    .in("status", [...INCOMPLETE_BATCH_STATUSES])
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("Error completing delivery batch:", updateError);
    return { completed: false, batchId };
  }

  if (updatedBatch) {
    revalidateBatchCompletionPaths();
    await notifyBatchCompleted(batchId);
    return { completed: true, batchId };
  }

  return { completed: false, batchId };
}

export async function reconcileDeliveryBatchStatuses(
  supabase: SupabaseClient,
  deliveryDates: string[],
): Promise<{ batchesCompleted: number }> {
  if (!deliveryDates.length) {
    return { batchesCompleted: 0 };
  }

  const { data: batches, error } = await supabase
    .from("delivery_batches")
    .select("id, delivery_date")
    .in("delivery_date", deliveryDates)
    .in("status", [...INCOMPLETE_BATCH_STATUSES]);

  if (error) {
    console.error("Error fetching batches for reconcile:", error);
    return { batchesCompleted: 0 };
  }

  let batchesCompleted = 0;

  for (const batch of batches ?? []) {
    const result = await tryCompleteDeliveryBatch(
      supabase,
      batch.id,
      batch.delivery_date,
    );
    if (result.completed) {
      batchesCompleted += 1;
    }
  }

  if (batchesCompleted > 0) {
    revalidateBatchCompletionPaths();
  }

  return { batchesCompleted };
}
