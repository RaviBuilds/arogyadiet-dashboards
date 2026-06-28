import { createClient as createAdminClient } from "@supabase/supabase-js";
import type { RiderData } from "@/shared/components/admin/riders/RiderManagement";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { AdminRidersWrapper } from "./AdminRidersWrapper";
import { guardAdminPage } from "@/lib/auth/adminAccess";

export const revalidate = 0;

export default async function RidersPage() {
  await guardAdminPage("operations");
  // Use Service Role for Admin Dashboard to securely bypass RLS
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

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
  const today = getISTDateString(0);

  const PICKED_UP_ORDER_STATUSES = [
    "PICKED",
    "OUT_FOR_DELIVERY",
    "ON_THE_WAY",
    "REACHING_TO_LOCATION",
    "DELIVERED",
  ];

  const DELIVERY_STATUS_PRIORITY = [
    "FAILED",
    "CANCELLED",
    "REACHING_TO_LOCATION",
    "ON_THE_WAY",
    "OUT_FOR_DELIVERY",
    "ASSIGNED",
    "MEAL_PREPARED",
    "ORDER_CREATED",
  ];

  const deriveTodayPickupInfo = (todaysBatches: any[]) => {
    if (todaysBatches.length === 0) {
      return {
        latestBatchStatus: "No Batch Assigned",
        latestBatchTime: "N/A",
      };
    }

    const allOrders = todaysBatches.flatMap(
      (batch) => batch.delivery_orders || [],
    );
    const pickedOrders = allOrders.filter(
      (order) =>
        order.pickup_marked_at ||
        PICKED_UP_ORDER_STATUSES.includes(order.status),
    );

    if (pickedOrders.length > 0) {
      const pickupTimestamps = pickedOrders
        .map((order) => order.pickup_marked_at)
        .filter(Boolean)
        .map((timestamp) => new Date(timestamp).getTime());

      const earliestPickup =
        pickupTimestamps.length > 0
          ? new Date(Math.min(...pickupTimestamps)).toISOString()
          : null;

      return {
        latestBatchStatus: "PICKED UP",
        latestBatchTime: earliestPickup || "N/A",
      };
    }

    const activeBatch = todaysBatches.sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];

    return {
      latestBatchStatus: "NOT YET PICKED UP",
      latestBatchTime: activeBatch.created_at,
    };
  };

  const deriveTodayDeliveryStatus = (todaysBatches: any[]) => {
    if (todaysBatches.length === 0) {
      return "No Batch Assigned";
    }

    const allOrders = todaysBatches.flatMap(
      (batch) => batch.delivery_orders || [],
    );

    if (allOrders.length === 0) {
      return "No Orders";
    }

    const statuses = allOrders.map((order) => order.status || "UNKNOWN");

    if (statuses.every((status) => status === "DELIVERED")) {
      return "DELIVERED";
    }

    return (
      DELIVERY_STATUS_PRIORITY.find((status) => statuses.includes(status)) ||
      statuses[0] ||
      "UNKNOWN"
    );
  };

  // Removed foreignTable order/limit to prevent PostgREST parsing crashes.
  const [ridersRes, areasRes] = await Promise.all([
    supabaseAdmin
      .from("rider_profiles")
      .select(
        `id, employee_code, is_active, is_online, last_online_at, last_offline_at, emergency_contact, created_at, joining_date, franchise_id, clinic_id, clinics (name), users!inner (id, full_name, mobile, email), rider_service_areas (pincode), delivery_batches (id, status, expected_payout, created_at, delivery_date, delivery_orders (id, status, pickup_marked_at)), rider_monthly_summaries (total_earnings), rider_payouts (amount_withdrawn, payment_date)`,
      )
      .eq("is_active", true),
    supabaseAdmin
      .from("rider_service_areas")
      .select("*")
      .order("created_at", { ascending: false }),
  ]);

  if (ridersRes.error) {
    // Stringify the error so we can actually read it if it ever happens again
    console.error(
      "Error fetching riders:",
      JSON.stringify(ridersRes.error, null, 2),
    );
  }

  const riders: (RiderData & { franchiseId: string | null })[] = (ridersRes.data || []).map((rider: any) => {
    const serviceAreas =
      rider.rider_service_areas?.map((area: any) => area.pincode) || [];
    const todaysBatches = (rider.delivery_batches || []).filter(
      (b: any) => b.delivery_date === today,
    );
    let totalOrders = 0,
      completedOrders = 0,
      expectedEarning = 0;

    const { latestBatchStatus, latestBatchTime } =
      deriveTodayPickupInfo(todaysBatches);
    const todayDeliveryStatus = deriveTodayDeliveryStatus(todaysBatches);

    todaysBatches.forEach((batch: any) => {
      expectedEarning += Number(batch.expected_payout || 0);
      const orders = batch.delivery_orders || [];
      totalOrders += orders.length;
      completedOrders += orders.filter(
        (o: any) => o.status === "DELIVERED",
      ).length;
    });

    const totalEarned =
      rider.rider_monthly_summaries?.reduce(
        (sum: number, curr: any) => sum + Number(curr.total_earnings || 0),
        0,
      ) || 0;

    // Sort payouts safely in JS to find the most recent one
    const payouts = rider.rider_payouts || [];
    payouts.sort(
      (a: any, b: any) =>
        new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime(),
    );

    const lastPayoutAmount =
      payouts.length > 0 ? payouts[0].amount_withdrawn : null;
    const lastPayoutDate = payouts.length > 0 ? payouts[0].payment_date : null;

    return {
      id: rider.id,
      userId: rider.users?.id || "",
      fullName: rider.users?.full_name || "N/A",
      email: rider.users?.email || "N/A",
      mobile: rider.users?.mobile || "N/A",
      emergency_contact: rider.emergency_contact || "N/A",
      employee_code: rider.employee_code || "N/A",
      is_online: rider.is_online || false,
      status_updated_at: rider.is_online
        ? rider.last_online_at || rider.created_at
        : rider.last_offline_at ||
          rider.last_online_at ||
          rider.created_at ||
          new Date().toISOString(),
      assigned_pincodes: serviceAreas,
      todayCompletedDeliveries: completedOrders,
      todayTotalDeliveries: totalOrders,
      todayEstimatedEarning: expectedEarning,
      latestBatchStatus,
      latestBatchTime,
      todayDeliveryStatus,
      joiningDate: rider.joining_date || null,
      totalEarned: totalEarned,
      lastPayoutAmount: lastPayoutAmount,
      lastPayoutDate: lastPayoutDate,
      clinic_id: rider.clinic_id || null,
      clinicName: rider.clinics?.name || null,
      franchiseId: rider.franchise_id || null,
    };
  });

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Operations & Riders"
        description="Manage delivery personnel, daily activity, service areas,onboarding."
      />
      <AdminRidersWrapper data={riders} allAreas={areasRes.data || []} />
    </div>
  );
}
