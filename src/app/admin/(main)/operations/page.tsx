import { createClient } from "@/lib/supabase/server";
import OperationsDashboard from "@/shared/components/admin/operations/OperationsDashboard";
import {
  fetchRosterData,
  getAutomationLogs,
} from "@/actions/admin-actions/operationsActions";

// Live ops data: fetch fresh on every request (matches riders page)
export const revalidate = 0;

export default async function OperationsPage() {
  const getISTDateString = (offsetDays = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  };
  const supabase = await createClient();

  const today = getISTDateString();
  const tomorrowStr = getISTDateString(1);

  // 1. Fetch Dispatch Board (today + tomorrow)
  const { data: rawDeliveries } = await supabase
    .from("delivery_orders")
    .select(
      `
      id, status, delivery_date, route_sequence, payout_amount, created_at, pickup_marked_at, delivered_at,
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
    today,
  );

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Operations Control
        </h1>
        <p className="text-muted-foreground mt-1">
          Manage daily dispatch, route sequences, and planned deliveries.
        </p>
      </div>

      <OperationsDashboard
        deliveries={rawDeliveries || []}
        plannedDeliveries={rawPlannedDeliveries || []}
        rosterData={initialRosterData}
        automationLogs={initialAutomationLogs}
      />
    </div>
  );
}