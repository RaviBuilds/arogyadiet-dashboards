import { createClient } from "@/lib/supabase/server";
import {
  fetchPendingFailureApprovals,
  fetchRosterData,
  getAutomationLogs,
  reconcileDeliveryBatchStatusesAction,
} from "@/actions/admin-actions/operationsActions";
import { getISTDateString } from "@/lib/dates/ist";
import FailedDeliveryApprovals from "@/shared/components/admin/operations/FailedDeliveryApprovals";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { AdminOperationsWrapper } from "./AdminOperationsWrapper";

// Live ops data: fetch fresh on every request (matches riders page)
export const revalidate = 0;

export default async function OperationsPage() {
  const supabase = await createClient();

  const today = getISTDateString();
  const tomorrowStr = getISTDateString(1);

  await reconcileDeliveryBatchStatusesAction();

  // 1. Fetch Dispatch Board (today + tomorrow)
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
    .in("delivery_date", [today, tomorrowStr]);

  // 2. Fetch Tomorrow's Planned Deliveries
  
  const { data: rawPlannedDeliveries } = await supabase
    .from("delivery_orders")
    .select(`
      id, 
      status, 
      franchise_id,
      customer_profiles ( users(full_name, mobile) ), 
      addresses ( street_1, city, pincode ), 
      meal_categories ( name )
    `)
    .eq("delivery_date", tomorrowStr)
    .eq("status", "ORDER_CREATED");
  // 3. Fetch Initial 10-Day Roster for the new Submenu
  const tenDaysFromNow = getISTDateString(10);
  const endDate = tenDaysFromNow;

  const initialRosterData = await fetchRosterData(today, endDate);
  const automationLogsStartDate = getISTDateString(-5);
  const initialAutomationLogs = await getAutomationLogs(
    automationLogsStartDate,
    tomorrowStr,
  );

  const pendingFailures = await fetchPendingFailureApprovals();

  return (
    <div className="flex animate-in fade-in flex-col gap-6 pb-2 duration-500">
      <AdminPageHeader
        title="Operations Control"
        description="Manage daily dispatch, route sequences, and planned deliveries."
      />

      <AdminOperationsWrapper
        deliveries={rawDeliveries || []}
        plannedDeliveries={rawPlannedDeliveries || []}
        rosterData={initialRosterData}
        automationLogs={initialAutomationLogs}
      />

      {pendingFailures.length > 0 && (
        <FailedDeliveryApprovals approvals={pendingFailures} />
      )}
    </div>
  );
}