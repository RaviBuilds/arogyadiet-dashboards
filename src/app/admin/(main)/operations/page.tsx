import { createClient } from "@/lib/supabase/server";
import OperationsDashboard from "@/shared/components/admin/operations/OperationsDashboard";
import { fetchRosterData } from "@/actions/admin-actions/operationsActions";

// ENABLES ISR: Cache this page and revalidate every 1 hour (3600 seconds)
export const revalidate = 3600;

export default async function OperationsPage() {
  const supabase = await createClient();

  // 1. Fetch Today's Dispatch Board
  const today = new Date().toISOString().split("T")[0];
  const { data: rawDeliveries } = await supabase
    .from("delivery_orders")
    .select(
      `
      id, status, delivery_date, route_sequence, payout_amount, created_at, pickup_marked_at, delivered_at,
      customer_profiles ( users ( full_name, mobile ), addresses ( street_1, city, pincode ) ),
      rider_profiles ( id, emergency_contact, users ( full_name ), rider_service_areas ( pincode ) ),
      meal_categories ( name ), delivery_batches ( id, status ),
      addon_orders ( addon_order_items ( quantity ) )
    `,
    )
    .eq("delivery_date", today);

  // 2. Fetch Tomorrow's Planned Deliveries
  const tomorrow = new Date();
  //tomorrow planned delivery made to today for testing
  //tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setDate(tomorrow.getDate());
  const tomorrowStr = tomorrow.toISOString().split("T")[0];
  
  const { data: rawPlannedDeliveries } = await supabase
    .from("delivery_orders")
    .select(`
      id, 
      status, 
      customer_profiles ( users(full_name, mobile) ), 
      addresses ( street_1, city, pincode ), 
      meal_categories ( name )
    `)
    .eq("delivery_date", tomorrowStr);
  console.log("raw Planned Deliveries=>", rawPlannedDeliveries);
  // 3. Fetch Initial 10-Day Roster for the new Submenu
  const tenDaysFromNow = new Date();
  tenDaysFromNow.setDate(tenDaysFromNow.getDate() + 10);
  const endDate = tenDaysFromNow.toISOString().split("T")[0];

  const initialRosterData = await fetchRosterData(today, endDate);

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
        initialRosterData={initialRosterData}
      />
    </div>
  );
}
