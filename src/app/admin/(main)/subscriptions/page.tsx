import { createClient as createAdminClient } from "@supabase/supabase-js";
import { AdminPageHeader } from "@/shared/components/admin/core/AdminPageHeader";
import { SubscriptionDashboard } from "@/shared/components/admin/subscriptions/SubscriptionDashboard";

export const revalidate = 0;

export default async function SubscriptionsPage() {
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
    .select("id, status, starts_on, ends_on, plan_id, subscription_plans(name)")
    .in("status", ["ACTIVE", "PENDING", "QUEUED"]); // Adjust statuses based on your DB enums

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Subscription Management"
        description="Manage master plans and view subscription analytics."
      />
      <SubscriptionDashboard plans={plans || []} activeSubscriptions={activeSubs || []} />
    </div>
  );
}