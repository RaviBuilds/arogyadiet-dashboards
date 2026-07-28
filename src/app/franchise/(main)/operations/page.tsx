import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { Settings2 } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import {
  reconcileDeliveryBatchStatusesAction,
  fetchRosterData,
  getAutomationLogs,
} from "@/actions/admin-actions/operationsActions";
import { fetchFranchisePendingFailureApprovals } from "@/actions/franchise-actions/franchiseOperationsActions";
import { getISTDateString } from "@/lib/dates/ist";
import FranchiseOperationsClient from "./FranchiseOperationsClient";

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
  const tenDaysOut = getISTDateString(10);
  const automationLogsStart = getISTDateString(-5);

  // Keep batch statuses in sync (idempotent, same as the admin page).
  await reconcileDeliveryBatchStatusesAction();

  // Dispatch Board + Active Batches data — same shape as the admin board,
  // scoped strictly to this franchise.
  const { data: rawDeliveries } = await supabase
    .from("delivery_orders")
    .select(
      `
      id, status, delivery_date, route_sequence, payout_amount, created_at, pickup_marked_at, delivered_at, franchise_id,
      customer_profiles ( users!customer_profiles_user_id_fkey ( full_name, mobile ), addresses ( street_1, city, pincode ) ),
      rider_profiles ( id, emergency_contact, users ( full_name ), rider_service_areas ( area_name ) ),
      meal_categories ( name ),
      delivery_batches ( id, status, total_distance_km, expected_payout ),
      addon_orders ( addon_order_items ( quantity ) )
    `,
    )
    .eq("franchise_id", franchiseId)
    .in("delivery_date", [today, tomorrow]);

  // Planned (Tomorrow) — tomorrow's freshly created orders for this franchise.
  const { data: rawPlanned } = await supabase
    .from("delivery_orders")
    .select(
      `
      id, status, franchise_id,
      customer_profiles ( users!customer_profiles_user_id_fkey ( full_name, mobile ) ),
      addresses ( street_1, city, pincode ),
      meal_categories ( name )
    `,
    )
    .eq("franchise_id", franchiseId)
    .eq("delivery_date", tomorrow)
    .eq("status", "ORDER_CREATED");

  // Daily Meal Roster (next 10 days), scoped to this franchise.
  const rosterData = await fetchRosterData(today, tenDaysOut, franchiseId);

  // Automation last-run info (read-only — automations run centrally).
  const automationLogs = await getAutomationLogs(automationLogsStart, tomorrow);

  // Failed-delivery approvals raised by THIS franchise's riders only.
  const pendingFailures = await fetchFranchisePendingFailureApprovals();

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Operations Control"
        subtitle="Manage daily dispatch, route sequences, and planned deliveries for your franchise."
        icon={Settings2}
      />

      <FranchiseOperationsClient
        franchiseId={franchiseId}
        todayDeliveries={rawDeliveries ?? []}
        plannedDeliveries={rawPlanned ?? []}
        rosterData={rosterData ?? []}
        automationLogs={automationLogs ?? []}
        pendingFailures={pendingFailures ?? []}
      />
    </div>
  );
}
