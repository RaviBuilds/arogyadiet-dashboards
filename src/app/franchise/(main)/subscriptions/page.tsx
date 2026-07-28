import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { CreditCard } from "lucide-react";
import { PageHeader } from "@/shared/components/franchise/ui/PageHeader";
import FranchiseSubscriptionsClient from "./FranchiseSubscriptionsClient";

export const revalidate = 0;

export default async function FranchiseSubscriptionsPage() {
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

  // Fetch subscription plans (read-only, centralized by admin)
  const { data: plans } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("is_active", true)
    .order("duration_days", { ascending: true });

  // Fetch this franchise's global discount coupons (not tied to a customer)
  const { data: globalCoupons } = await supabase
    .from("coupons")
    .select(
      "id, code, discount_type, discount_value_30_days, discount_value_60_days, discount_value_90_days, flat_discounts_by_plan, discount_value, max_uses, times_used, expires_at, created_at",
    )
    .is("customer_profile_id", null)
    .eq("franchise_id", franchiseId)
    .order("created_at", { ascending: false });

  // Fetch franchise-scoped subscriptions with customer info
  const subSelectFields = `
    id, starts_on, effective_end_on, ends_on, total_days, 
    pause_credits_total, pause_credits_used, status, created_at,
    customer_profiles ( id, users!customer_profiles_user_id_fkey ( full_name, email, mobile ) ),
    subscription_plans ( name, code )
  `;

  const [activeRes, pendingRes, stoppedRes] = await Promise.allSettled([
    supabase
      .from("subscriptions")
      .select(subSelectFields)
      .eq("franchise_id", franchiseId)
      .eq("status", "ACTIVE")
      .order("starts_on", { ascending: false }),
    supabase
      .from("subscriptions")
      .select(subSelectFields)
      .eq("franchise_id", franchiseId)
      .eq("status", "PENDING")
      .order("starts_on", { ascending: true }),
    supabase
      .from("subscriptions")
      .select(subSelectFields)
      .eq("franchise_id", franchiseId)
      .in("status", ["STOPPED", "CANCELLED", "EXPIRED"])
      .order("ends_on", { ascending: false }),
  ]);

  const mapSub = (sub: any) => {
    const profile = Array.isArray(sub.customer_profiles)
      ? sub.customer_profiles[0]
      : sub.customer_profiles;
    const user = Array.isArray(profile?.users) ? profile?.users[0] : profile?.users;
    return {
      id: sub.id,
      customer_name: user?.full_name || "N/A",
      email: user?.email || "N/A",
      mobile: user?.mobile || "N/A",
      plan_name: sub.subscription_plans?.name || "Custom Plan",
      total_days: sub.total_days || 0,
      starts_on: sub.starts_on,
      ends_on: sub.effective_end_on || sub.ends_on,
      pause_credits_total: sub.pause_credits_total || 0,
      pause_credits_used: sub.pause_credits_used || 0,
      status: sub.status as string,
    };
  };

  const activeSubs = activeRes.status === "fulfilled" ? (activeRes.value.data ?? []).map(mapSub) : [];
  const pendingSubs = pendingRes.status === "fulfilled" ? (pendingRes.value.data ?? []).map(mapSub) : [];
  const stoppedSubs = stoppedRes.status === "fulfilled" ? (stoppedRes.value.data ?? []).map(mapSub) : [];

  return (
    <div className="flex flex-col gap-8 animate-in fade-in duration-500">
      <PageHeader
        title="Subscription Management"
        subtitle="View and manage subscriptions for your franchise customers."
        icon={CreditCard}
      />
      <FranchiseSubscriptionsClient
        plans={plans ?? []}
        globalCoupons={globalCoupons ?? []}
        activeSubscriptions={activeSubs}
        pendingSubscriptions={pendingSubs}
        stoppedSubscriptions={stoppedSubs}
      />
    </div>
  );
}
