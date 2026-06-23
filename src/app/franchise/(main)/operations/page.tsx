import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { Settings2, Info } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import TodaysDeliveries from "@/shared/components/admin/operations/TodaysDeliveries";
import FailedDeliveryApprovals from "@/shared/components/admin/operations/FailedDeliveryApprovals";
import { reconcileDeliveryBatchStatusesAction } from "@/actions/admin-actions/operationsActions";
import {
  franchiseUpdateOrderStatusAction,
  franchiseMarkBatchPickedUpAction,
  franchiseApproveFailedDeliveryAction,
  franchiseRejectFailedDeliveryAction,
  revalidateFranchiseOperationsPage,
  fetchFranchisePendingFailureApprovals,
} from "@/actions/franchise-actions/franchiseOperationsActions";
import { getISTDateString } from "@/lib/dates/ist";

export const revalidate = 0;

export default async function FranchiseOperationsPage() {
  const cookieStore = await cookies();
  const franchiseId = cookieStore.get("x-franchise-id")?.value ?? "";

  if (!franchiseId) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p>Unable to determine franchise. Please contact support.</p>
      </div>
    );
  }

  const supabase = createAdminClient();

  const today = getISTDateString();
  const tomorrow = getISTDateString(1);

  // Keep batch statuses in sync (idempotent, same as the admin page).
  await reconcileDeliveryBatchStatusesAction();

  // Dispatch Board + Active Batches data — same shape as the admin board,
  // scoped strictly to this franchise.
  const { data: rawDeliveries } = await supabase
    .from("delivery_orders")
    .select(
      `
      id, status, delivery_date, route_sequence, payout_amount, created_at, pickup_marked_at, delivered_at, franchise_id,
      customer_profiles ( users ( full_name, mobile ), addresses ( street_1, city, pincode ) ),
      rider_profiles ( id, emergency_contact, users ( full_name ), rider_service_areas ( area_name ) ),
      meal_categories ( name ),
      delivery_batches ( id, status, total_distance_km, expected_payout ),
      addon_orders ( addon_order_items ( quantity ) )
    `,
    )
    .eq("franchise_id", franchiseId)
    .in("delivery_date", [today, tomorrow]);

  const pendingFailures = await fetchFranchisePendingFailureApprovals();

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Operations Control"
        subtitle="Manage daily dispatch, route sequences, and planned deliveries for your franchise."
        icon={Settings2}
      />

      {/* Automations are owned centrally — only daily dispatch is managed here. */}
      <div className="flex items-center gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50/70 px-4 py-3 shadow-[0_8px_30px_rgb(0,0,0,0.03)] ring-1 ring-inset ring-white/40">
        <Info className="h-4 w-4 text-amber-600 shrink-0" />
        <p className="text-xs text-amber-800">
          System automations (Order Creation, Product Linking, Routing &amp;
          Batching) are managed centrally by the Admin team. Orders and routes
          for your franchise are generated automatically every day.
        </p>
      </div>

      <TodaysDeliveries
        data={rawDeliveries || []}
        onUpdateStatus={franchiseUpdateOrderStatusAction}
        onMarkBatchPickup={franchiseMarkBatchPickedUpAction}
        onRevalidate={revalidateFranchiseOperationsPage}
      />

      {pendingFailures.length > 0 && (
        <FailedDeliveryApprovals
          approvals={pendingFailures}
          onApprove={franchiseApproveFailedDeliveryAction}
          onReject={franchiseRejectFailedDeliveryAction}
        />
      )}
    </div>
  );
}
