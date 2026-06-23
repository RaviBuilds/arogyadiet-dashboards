import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { Truck } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import FranchiseRiderDashboard from "./FranchiseRiderDashboard";

export const revalidate = 0;

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

  // Fetch riders for this franchise
  const { data: rawRiders } = await supabase
    .from("rider_profiles")
    .select(`
      id, employee_code, is_active, is_online, last_online_at, last_offline_at, 
      emergency_contact, joining_date,
      users!inner ( id, full_name, mobile, email ),
      rider_service_areas ( pincode ),
      delivery_batches ( id, status, expected_payout, delivery_date, 
        delivery_orders ( id, status, pickup_marked_at ) 
      )
    `)
    .eq("franchise_id", franchiseId)
    .eq("is_active", true);

  const riders = (rawRiders || []).map((rider: any) => {
    const serviceAreas = rider.rider_service_areas?.map((a: any) => a.pincode) || [];
    const todaysBatches = (rider.delivery_batches || []).filter((b: any) => b.delivery_date === today);

    let totalOrders = 0;
    let completedOrders = 0;
    let expectedEarning = 0;

    todaysBatches.forEach((batch: any) => {
      expectedEarning += Number(batch.expected_payout || 0);
      const orders = batch.delivery_orders || [];
      totalOrders += orders.length;
      completedOrders += orders.filter((o: any) => o.status === "DELIVERED").length;
    });

    // Derive pickup status
    const PICKED_UP_STATUSES = ["PICKED", "OUT_FOR_DELIVERY", "ON_THE_WAY", "REACHING_TO_LOCATION", "DELIVERED"];
    const allTodayOrders = todaysBatches.flatMap((b: any) => b.delivery_orders || []);
    const hasPickedUp = allTodayOrders.some(
      (o: any) => o.pickup_marked_at || PICKED_UP_STATUSES.includes(o.status)
    );

    return {
      id: rider.id,
      fullName: rider.users?.full_name || "N/A",
      email: rider.users?.email || "N/A",
      mobile: rider.users?.mobile || "N/A",
      employeeCode: rider.employee_code || "N/A",
      isOnline: rider.is_online || false,
      lastOnlineAt: rider.is_online ? rider.last_online_at : rider.last_offline_at,
      serviceAreas,
      joiningDate: rider.joining_date || null,
      emergencyContact: rider.emergency_contact || "N/A",
      todayTotalOrders: totalOrders,
      todayCompletedOrders: completedOrders,
      todayExpectedEarning: expectedEarning,
      hasPickedUp,
    };
  });

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Riders"
        subtitle="Manage delivery riders and track daily operations."
        icon={Truck}
      />
      <FranchiseRiderDashboard riders={riders} franchiseId={franchiseId} />
    </div>
  );
}
