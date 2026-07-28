import { createClient as createAdminClient } from "@supabase/supabase-js";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { AdminSubscriptionsWrapper } from "./AdminSubscriptionsWrapper";
import { guardAdminGroup } from "@/lib/auth/adminAccess";

export const revalidate = 0;

export default async function SubscriptionsPage() {
  await guardAdminGroup("subscriptions");
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Fetch Subscription Plans
  const { data: plans } = await supabaseAdmin
    .from("subscription_plans")
    .select("*")
    .order("duration_days", { ascending: true });

  // 2. Fetch all user subscriptions for modeling/analytics
  const { data: activeSubs } = await supabaseAdmin
    .from("subscriptions")
    .select("id, status, starts_on, ends_on, plan_id, franchise_id, subscription_plans(name)")
    .in("status", ["ACTIVE", "PENDING"]);

  // 3. Fetch global discount coupons (not tied to any customer)
  const { data: globalCoupons } = await supabaseAdmin
    .from("coupons")
    .select(
      "id, code, discount_type, discount_value_30_days, discount_value_60_days, discount_value_90_days, flat_discounts_by_plan, discount_value, max_uses, times_used, expires_at, created_at",
    )
    .is("customer_profile_id", null)
    .is("franchise_id", null)
    .order("created_at", { ascending: false });

  // 4. Fetch subscription records (active / pending / expired-stopped) for the
  // record list tabs that were moved here from the Customers portal.
  const recordSelectFields = `
    id, starts_on, effective_end_on, ends_on, total_days, pause_credits_total, pause_credits_used, status, franchise_id,
    customer_profiles ( users!customer_profiles_user_id_fkey ( full_name, email ) ),
    subscription_plans ( name )
  `;

  const mapSubRow = (sub: any) => {
    const profile = Array.isArray(sub.customer_profiles)
      ? sub.customer_profiles[0]
      : sub.customer_profiles;
    const user = Array.isArray(profile?.users)
      ? profile?.users[0]
      : profile?.users;
    return {
      id: sub.id,
      customer_name: user?.full_name || "N/A",
      email: user?.email || "N/A",
      plan_name: sub.subscription_plans?.name || "Custom Plan",
      total_days: sub.total_days || 0,
      starts_on: sub.starts_on,
      ends_on: sub.effective_end_on || sub.ends_on,
      pause_credits_total: sub.pause_credits_total || 0,
      pause_credits_used: sub.pause_credits_used || 0,
      status: sub.status as string,
      franchise_id: sub.franchise_id || null,
    };
  };

  const { data: rawActiveRecords } = await supabaseAdmin
    .from("subscriptions")
    .select(recordSelectFields)
    .eq("status", "ACTIVE")
    .order("starts_on", { ascending: false });

  const { data: rawPendingRecords } = await supabaseAdmin
    .from("subscriptions")
    .select(recordSelectFields)
    .eq("status", "PENDING")
    .order("starts_on", { ascending: true });

  const { data: rawStoppedRecords } = await supabaseAdmin
    .from("subscriptions")
    .select(recordSelectFields)
    .in("status", ["STOPPED", "CANCELLED", "EXPIRED"])
    .order("ends_on", { ascending: false });

  const subscriptionRecordsActive = (rawActiveRecords || []).map(mapSubRow);
  const subscriptionRecordsPending = (rawPendingRecords || []).map(mapSubRow);
  const subscriptionRecordsStopped = (rawStoppedRecords || []).map(mapSubRow);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Subscription Management"
        description="Manage subscription plans, KIT products, and view analytics."
      />
      <AdminSubscriptionsWrapper
        plans={plans || []}
        activeSubscriptions={activeSubs || []}
        initialGlobalCoupons={globalCoupons || []}
        subscriptionRecordsActive={subscriptionRecordsActive}
        subscriptionRecordsPending={subscriptionRecordsPending}
        subscriptionRecordsStopped={subscriptionRecordsStopped}
      />
    </div>
  );
}