import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import FranchiseDashboardClient from "./FranchiseDashboardClient";

export const revalidate = 0;

export default async function FranchiseDashboardPage() {
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
  const today = new Date().toISOString().split("T")[0];
  const firstOfMonth = new Date();
  firstOfMonth.setDate(1);
  const monthStart = firstOfMonth.toISOString().split("T")[0];

  // Fetch dashboard metrics server-side for fast initial load
  const [
    activeSubsRes,
    totalCustomersRes,
    activeRidersRes,
    todayDeliveriesRes,
    monthDeliveriesRes,
    pendingSubsRes,
    todayOrdersRes,
    franchiseRes,
  ] = await Promise.allSettled([
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("franchise_id", franchiseId)
      .eq("status", "ACTIVE"),
    supabase
      .from("customer_profiles")
      .select("id", { count: "exact", head: true })
      .eq("franchise_id", franchiseId),
    supabase
      .from("rider_profiles")
      .select("id", { count: "exact", head: true })
      .eq("franchise_id", franchiseId)
      .eq("is_active", true),
    supabase
      .from("delivery_orders")
      .select("id, status", { count: "exact" })
      .eq("franchise_id", franchiseId)
      .eq("delivery_date", today),
    supabase
      .from("delivery_orders")
      .select("id", { count: "exact", head: true })
      .eq("franchise_id", franchiseId)
      .gte("delivery_date", monthStart),
    supabase
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("franchise_id", franchiseId)
      .eq("status", "PENDING"),
    supabase
      .from("delivery_orders")
      .select("id, status, customer_profiles(users!customer_profiles_user_id_fkey(full_name)), rider_profiles(users(full_name))")
      .eq("franchise_id", franchiseId)
      .eq("delivery_date", today)
      .order("route_sequence", { ascending: true })
      .limit(20),
    supabase
      .from("franchises")
      .select("name, status, created_at")
      .eq("id", franchiseId)
      .single(),
  ]);

  const activeSubscriptions = activeSubsRes.status === "fulfilled" ? (activeSubsRes.value.count ?? 0) : 0;
  const totalCustomers = totalCustomersRes.status === "fulfilled" ? (totalCustomersRes.value.count ?? 0) : 0;
  const activeRiders = activeRidersRes.status === "fulfilled" ? (activeRidersRes.value.count ?? 0) : 0;
  const todayDeliveryCount = todayDeliveriesRes.status === "fulfilled" ? (todayDeliveriesRes.value.count ?? 0) : 0;
  const monthDeliveries = monthDeliveriesRes.status === "fulfilled" ? (monthDeliveriesRes.value.count ?? 0) : 0;
  const pendingSubscriptions = pendingSubsRes.status === "fulfilled" ? (pendingSubsRes.value.count ?? 0) : 0;

  // Calculate today's delivery status breakdown
  let deliveredToday = 0;
  let pendingToday = 0;
  let failedToday = 0;
  if (todayDeliveriesRes.status === "fulfilled" && todayDeliveriesRes.value.data) {
    const orders = todayDeliveriesRes.value.data as any[];
    deliveredToday = orders.filter((o: any) => o.status === "DELIVERED").length;
    failedToday = orders.filter((o: any) => o.status === "FAILED" || o.status === "CANCELLED").length;
    pendingToday = orders.length - deliveredToday - failedToday;
  }

  const todayOrders = todayOrdersRes.status === "fulfilled" ? (todayOrdersRes.value.data ?? []) : [];
  const franchise = franchiseRes.status === "fulfilled" ? franchiseRes.value.data : null;

  return (
    <FranchiseDashboardClient
      franchiseId={franchiseId}
      franchiseName={franchise?.name ?? "Your Franchise"}
      metrics={{
        activeSubscriptions,
        totalCustomers,
        activeRiders,
        todayDeliveries: todayDeliveryCount,
        monthDeliveries,
        pendingSubscriptions,
        deliveredToday,
        pendingToday,
        failedToday,
      }}
      todayOrders={todayOrders}
    />
  );
}
