
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { SubscriptionClientTable } from "./SubscriptionClientTable";
import { columns } from "./columns";

export default async function SubscriptionsPage() {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    }
  );

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

  const subscriptions = rawSubscriptions.map((sub) => ({
    id: sub.id,
    status: sub.status,
    starts_on: sub.starts_on,
    ends_on: sub.ends_on,
    pause_credits_total: sub.pause_credits_total,
    pause_credits_used: sub.pause_credits_used,
    customer_name: sub.customer_profiles?.users?.full_name || "N/A",
    customer_email: sub.customer_profiles?.users?.email || "N/A",
    plan_name: sub.subscription_plans?.name || "N/A",
  }));

  return (
    <div className="flex-1 space-y-4 p-8 pt-6">
      <div className="flex items-center justify-between space-y-2">
        <h2 className="text-3xl font-bold tracking-tight">Subscriptions CRM</h2>
      </div>
      <SubscriptionClientTable data={subscriptions} columns={columns} />
    </div>
  );
}
