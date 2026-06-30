import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { Truck } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import FranchiseRiderDashboard from "./FranchiseRiderDashboard";

export const revalidate = 0;

const PICKED_UP_STATUSES = [
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

function deriveTodayDeliveryStatus(todaysBatches: any[]): string {
  if (todaysBatches.length === 0) return "No Batch Assigned";
  const allOrders = todaysBatches.flatMap((b: any) => b.delivery_orders || []);
  if (allOrders.length === 0) return "No Orders";
  const statuses = allOrders.map((o: any) => o.status || "UNKNOWN");
  if (statuses.every((s: string) => s === "DELIVERED")) return "DELIVERED";
  return (
    DELIVERY_STATUS_PRIORITY.find((s) => statuses.includes(s)) ||
    statuses[0] ||
    "UNKNOWN"
  );
}

export default async function FranchiseRidersPage() {
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

  // Fetch riders, franchise service areas, and approved territory pincodes
  const [ridersRes, areasRes, approvedRes] = await Promise.all([
    supabase
      .from("rider_profiles")
      .select(`
        id, employee_code, is_active, is_online, last_online_at, last_offline_at,
        emergency_contact, joining_date, created_at, franchise_id,
        users!inner ( id, full_name, mobile, email ),
        rider_service_areas ( pincode ),
        delivery_batches ( id, status, expected_payout, delivery_date,
          delivery_orders ( id, status, pickup_marked_at )
        ),
        rider_monthly_summaries ( total_earnings ),
        rider_payouts ( amount_withdrawn, payment_date )
      `)
      .eq("franchise_id", franchiseId)
      .eq("is_active", true),
    supabase
      .from("rider_service_areas")
      .select("*")
      .eq("franchise_id", franchiseId)
      .order("created_at", { ascending: false }),
    supabase
      .from("franchise_pincodes")
      .select("pincode")
      .eq("franchise_id", franchiseId)
      .order("pincode"),
  ]);

  const riders = (ridersRes.data || []).map((rider: any) => {
    const serviceAreas = rider.rider_service_areas?.map((a: any) => a.pincode) || [];
    const todaysBatches = (rider.delivery_batches || []).filter(
      (b: any) => b.delivery_date === today,
    );

    let totalOrders = 0;
    let completedOrders = 0;
    let expectedEarning = 0;

    todaysBatches.forEach((batch: any) => {
      expectedEarning += Number(batch.expected_payout || 0);
      const orders = batch.delivery_orders || [];
      totalOrders += orders.length;
      completedOrders += orders.filter((o: any) => o.status === "DELIVERED").length;
    });

    const allTodayOrders = todaysBatches.flatMap((b: any) => b.delivery_orders || []);
    const hasPickedUp = allTodayOrders.some(
      (o: any) => o.pickup_marked_at || PICKED_UP_STATUSES.includes(o.status),
    );
    const todayDeliveryStatus = deriveTodayDeliveryStatus(todaysBatches);

    const totalEarned =
      rider.rider_monthly_summaries?.reduce(
        (sum: number, curr: any) => sum + Number(curr.total_earnings || 0),
        0,
      ) || 0;

    const payouts = [...(rider.rider_payouts || [])];
    payouts.sort(
      (a: any, b: any) =>
        new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime(),
    );
    const lastPayoutAmount = payouts.length > 0 ? payouts[0].amount_withdrawn : null;
    const lastPayoutDate = payouts.length > 0 ? payouts[0].payment_date : null;

    return {
      id: rider.id,
      userId: rider.users?.id || "",
      fullName: rider.users?.full_name || "N/A",
      email: rider.users?.email || "N/A",
      mobile: rider.users?.mobile || "N/A",
      employeeCode: rider.employee_code || "N/A",
      emergencyContact: rider.emergency_contact || "N/A",
      isOnline: rider.is_online || false,
      statusUpdatedAt: rider.is_online
        ? rider.last_online_at || rider.created_at
        : rider.last_offline_at || rider.last_online_at || rider.created_at || null,
      serviceAreas,
      joiningDate: rider.joining_date || null,
      todayTotalOrders: totalOrders,
      todayCompletedOrders: completedOrders,
      todayExpectedEarning: expectedEarning,
      hasPickedUp,
      todayDeliveryStatus,
      totalEarned,
      lastPayoutAmount,
      lastPayoutDate,
    };
  });

  const approvedPincodes = (approvedRes.data || []).map((r: any) => r.pincode);

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Riders"
        subtitle="Manage delivery riders, daily activity, and service areas."
        icon={Truck}
      />
      <FranchiseRiderDashboard
        riders={riders}
        allAreas={areasRes.data || []}
        approvedPincodes={approvedPincodes}
        franchiseId={franchiseId}
      />
    </div>
  );
}
