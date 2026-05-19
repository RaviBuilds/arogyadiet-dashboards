
import { SubscriptionClientTable } from "./SubscriptionClientTable";
import { columns } from "./columns";
import { createClient } from "@/lib/supabase/server";

export default async function SubscriptionsPage() {

  const supabase = await createClient();


  const { data: rawSubscriptions, error } = await supabase
    .from('subscriptions')
    .select(`
      id,
      status,
      starts_on,
      ends_on,
      pause_credits_total,
      pause_credits_used,
      customer_profiles ( users ( full_name, email ) ),
      subscription_plans ( name )
    `)
    .order('created_at', { ascending: false });

  if (error) {
    console.error("Error fetching subscriptions:", error);
    return <p>Error loading subscriptions.</p>;
  }
  console.log("RawSubscription =>", rawSubscriptions);

  const subscriptions = rawSubscriptions.map((sub: any) => {
    const profile = Array.isArray(sub.customer_profiles) ? sub.customer_profiles[0] : sub.customer_profiles;
    const user = Array.isArray(profile?.users) ? profile?.users[0] : profile?.users;

    return {
      id: sub.id,
      status: sub.status,
      starts_on: sub.starts_on,
      ends_on: sub.ends_on,
      pause_credits_total: sub.pause_credits_total,
      pause_credits_used: sub.pause_credits_used,
      customer_name: user?.full_name || "N/A",
      email: user?.email || "N/A",
      plan_name: sub.subscription_plans?.name || "N/A",
    };
  });

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Subscriptions CRM</h2>
      </div>
      <SubscriptionClientTable data={subscriptions} columns={columns} />
    </div>
  );
}
