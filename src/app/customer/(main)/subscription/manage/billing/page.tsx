import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BillingClient } from "@/modules/subscription/components/manage/billing-client";

export const revalidate = 0;

export default async function ManageBillingPage() {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) redirect("/login");

  const { data: appUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .single();

  if (!appUser) redirect("/login");

  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", appUser.id)
    .single();

  if (!profile) redirect("/profile");

  const { data: activeSub } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("customer_profile_id", profile.id)
    .eq("status", "ACTIVE")
    .maybeSingle();

  const { data: payments } = await supabase
    .from("payments")
    .select("*")
    .eq("customer_profile_id", profile.id)
    .order("created_at", { ascending: false });

  const paymentIds = (payments ?? []).map((p: any) => p.id);
  const subscriptionIds = (payments ?? [])
    .map((p: any) => p.subscription_id)
    .filter(Boolean);

  const [{ data: addonOrders }, { data: subscriptions }] = await Promise.all([
    paymentIds.length
      ? supabase
          .from("addon_orders")
          .select("id, payment_id")
          .eq("customer_profile_id", profile.id)
          .in("payment_id", paymentIds)
      : Promise.resolve({ data: [] as any[] }),
    subscriptionIds.length
      ? supabase
          .from("subscriptions")
          .select("id")
          .in("id", subscriptionIds as string[])
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const addonPaymentIdSet = new Set(
    (addonOrders ?? []).map((order: any) => order.payment_id),
  );
  const subscriptionIdSet = new Set(
    (subscriptions ?? []).map((s: any) => s.id),
  );

  const unifiedPayments = (payments ?? []).map((p: any) => {
    const isAddon = addonPaymentIdSet.has(p.id);
    const isSubscription =
      p.subscription_id && subscriptionIdSet.has(p.subscription_id);

    return {
      ...p,
      invoice_type: isAddon ? "ADDON" : isSubscription ? "SUBSCRIPTION" : null,
    };
  });

  return (
    <BillingClient
      payments={unifiedPayments || []}
      activeSub={activeSub || null}
    />
  );
}
