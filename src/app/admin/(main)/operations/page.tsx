import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
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
import { guardAdminGroup } from "@/lib/auth/adminAccess";

// Live ops data: fetch fresh on every request (matches riders page)
export const revalidate = 0;

export default async function OperationsPage() {
  await guardAdminGroup("operations");
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
      customer_profiles ( users!customer_profiles_user_id_fkey ( full_name, mobile ), addresses ( street_1, city, pincode ) ),
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
      customer_profiles ( users!customer_profiles_user_id_fkey(full_name, mobile) ), 
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

  // Fetch all shop (addon) orders across all customers, newest first.
  // Moved here from the Customers portal.
  const supabaseAdmin = createAdminClient();
  const { data: rawShopOrders } = await supabaseAdmin
    .from("addon_orders")
    .select(
      `
      id,
      created_at,
      total_amount,
      status,
      target_delivery_date,
      delivery_order_id,
      delivered_at,
      fulfillment_status,
      customer_profile_id,
      franchise_id,
      walkin_name,
      walkin_mobile,
      delivery_orders (delivery_date),
      addon_order_items (
        quantity,
        unit_price,
        products (name)
      ),
      customer_profiles (
        users!customer_profiles_user_id_fkey (full_name)
      )
    `,
    )
    .order("created_at", { ascending: false });

  const shopOrders = (rawShopOrders || []).map((o: any) => {
    const profile = Array.isArray(o.customer_profiles)
      ? o.customer_profiles[0]
      : o.customer_profiles;
    const user = Array.isArray(profile?.users) ? profile?.users[0] : profile?.users;
    const delivery = Array.isArray(o.delivery_orders)
      ? o.delivery_orders[0]
      : o.delivery_orders;
    const items = (Array.isArray(o.addon_order_items) ? o.addon_order_items : [])
      .filter(Boolean)
      .map((item: any) => ({
        product_name: item?.products?.name ?? "Product",
        quantity: item?.quantity ?? 1,
        unit_price: item?.unit_price ?? 0,
      }));
    return {
      id: o.id as string,
      created_at: o.created_at as string,
      customer_profile_id: (o.customer_profile_id as string) ?? null,
      // A walk-in counter sale has no profile; its buyer name lives on the order.
      customer_name:
        (user?.full_name as string) || (o.walkin_name as string) || "N/A",
      walkin_name: (o.walkin_name as string) ?? null,
      walkin_mobile: (o.walkin_mobile as string) ?? null,
      total_amount: o.total_amount as number | null,
      status: o.status as string | null,
      target_delivery_date: o.target_delivery_date as string | null,
      delivery_order_id: o.delivery_order_id as string | null,
      scheduled_delivery_date: (delivery?.delivery_date as string) ?? null,
      delivered_at: (o.delivered_at as string) ?? null,
      fulfillment_status: (o.fulfillment_status as string) ?? null,
      franchise_id: o.franchise_id ?? null,
      items,
    };
  });

  // Compact Operations view: show only orders that need attention —
  //   - every not-yet-delivered PAID order (purchased + scheduled/assigned), and
  //   - orders delivered within the last 3 days (by delivered_at),
  // while hiding PENDING (never completed) and CANCELLED orders and older
  // delivered history (still available per-customer / via export).
  const deliveredCutoff = getISTDateString(-3);
  const compactShopOrders = shopOrders.filter((o) => {
    if (o.status === "PAID") return true;
    const isDeliveredTerminal =
      o.status === "DELIVERED" ||
      o.status === "COMPLETED" ||
      o.fulfillment_status === "CLINIC_PICKUP" ||
      o.fulfillment_status === "DELIVERED_OFFLINE";
    if (!isDeliveredTerminal) return false;
    // Recency by delivered_at, falling back to the scheduled delivery date.
    const deliveredOn =
      (o.delivered_at ? o.delivered_at.slice(0, 10) : null) ??
      o.scheduled_delivery_date ??
      null;
    return deliveredOn !== null && deliveredOn >= deliveredCutoff;
  });

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
        shopOrders={compactShopOrders}
      />

      {pendingFailures.length > 0 && (
        <FailedDeliveryApprovals approvals={pendingFailures} />
      )}
    </div>
  );
}