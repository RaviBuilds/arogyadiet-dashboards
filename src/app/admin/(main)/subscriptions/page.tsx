import { createClient as createAdminClient } from "@supabase/supabase-js";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { AdminSubscriptionsWrapper } from "./AdminSubscriptionsWrapper";
import { guardAdminPage } from "@/lib/auth/adminAccess";

export const revalidate = 0;

export default async function SubscriptionsPage() {
  await guardAdminPage("operations");
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

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Subscription Management"
        description="Manage master plans and view subscription analytics."
      />
      <AdminSubscriptionsWrapper
        plans={plans || []}
        activeSubscriptions={activeSubs || []}
        initialGlobalCoupons={globalCoupons || []}
      />
    </div>
  );
}