import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { BillingClient } from "@/shared/components/customer/subscription/manage/billing-client";

export const revalidate = 0;

export default async function ManageBillingPage() {
  const { supabase, user, customerProfileId, error } =
    await getCustomerSession();

  if (error || !user) redirect("/login");
  if (!customerProfileId) redirect("/profile");

  const { data: activeSub } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("customer_profile_id", customerProfileId)
    .eq("status", "ACTIVE")
    .maybeSingle();

  const { data: payments } = await supabase
    .from("payments")
    .select(
      "id, amount, payment_method, status, created_at, paid_at, subscription_id, base_amount, tax_percent, tax_amount, discount_amount, invoice_type, payment_reference, payment_notes",
    )
    .eq("customer_profile_id", customerProfileId)
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
          .eq("customer_profile_id", customerProfileId)
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
