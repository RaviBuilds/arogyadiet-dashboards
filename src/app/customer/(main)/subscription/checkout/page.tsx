import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CheckoutWizard } from "@/shared/components/customer/subscription/checkout/checkout-wizard.tsx";

export default async function CheckoutPage() {
  const supbase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supbase.auth.getUser();
  if (!user || userError) redirect("/login");

  const profileResponse = await supbase
    .from("customer_profiles")
    .select("dietary_preference, id, users!inner(auth_user_id)")
    .eq("users.auth_user_id", user.id)
    .maybeSingle();

  //fetch the plan and profile  in parallel
  const [plansResponse, latestSubscriptionResponse] = await Promise.all([
    supbase
      .from("subscription_plans")
      .select("*")
      .eq("is_active", true)
      .order("duration_days", { ascending: true }),
    supbase
      .from("subscriptions")
      .select("id, ends_on, effective_end_on, status")
      .eq("customer_profile_id", profileResponse.data?.id)
      .in("status", ["ACTIVE", "QUEUED"])
      .order("ends_on", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  return (
    <div className="bg-slate-50/50 min-h-screen">
      <CheckoutWizard
        plans={plansResponse.data || []}
        profile={profileResponse.data}
        latestSubscription={latestSubscriptionResponse.data}
      />
    </div>
  );
}
