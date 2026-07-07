import { redirect } from "next/navigation";
import { format } from "date-fns";
import { getCustomerSession } from "@/lib/customer/get-session";
import { AddressSwitcherClient } from "@/shared/components/customer/subscription/manage/address-switcher-client";

export const revalidate = 0;

export default async function ManageAddressPage() {
  const { supabase, user, customerProfileId, error } =
    await getCustomerSession();
  if (error || !user) redirect("/login");

  // Fetch Active Sub
  const { data: activeSub } = await supabase
    .from("subscriptions")
    .select("id, effective_end_on")
    .eq("customer_profile_id", customerProfileId)
    .eq("status", "ACTIVE")
    .single();

  if (!activeSub)
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
        <p className="text-sm font-medium text-slate-500">
          No active subscription found.
        </p>
      </div>
    );

  // Fetch Addresses
  const { data: addresses } = await supabase
    .from("addresses")
    .select("*")
    .eq("customer_profile_id", customerProfileId);

  // Fetch Daily Schedule Address IDs & Pause Status
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const { data: dailyPrefs } = await supabase
    .from("subscription_daily_preferences")
    .select("preference_date, delivery_address_id, is_paused") // Added is_paused here
    .eq("subscription_id", activeSub.id)
    .gte("preference_date", todayStr)
    .order("preference_date", { ascending: true });

  const scheduleDays = dailyPrefs?.map((p) => p.preference_date) || [];
  const initialAddressMap: Record<string, string> = {};
  const pausedDates: string[] = []; // Array to track paused dates

  dailyPrefs?.forEach((p) => {
    if (p.delivery_address_id)
      initialAddressMap[p.preference_date] = p.delivery_address_id;
    if (p.is_paused) pausedDates.push(p.preference_date);
  });

  return (
    <AddressSwitcherClient
      subscriptionId={activeSub.id}
      scheduleDays={scheduleDays}
      initialAddressMap={initialAddressMap}
      availableAddresses={addresses || []}
      pausedDates={pausedDates} // Pass the paused dates to the client
    />
  );
}
