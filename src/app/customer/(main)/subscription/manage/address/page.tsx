import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { AddressSwitcherClient } from "@/modules/subscription/components/manage/address-switcher-client";

export const revalidate = 0;

export default async function ManageAddressPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Fetch Profile & Active Sub
  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq(
      "user_id",
      (
        await supabase
          .from("users")
          .select("id")
          .eq("auth_user_id", user.id)
          .single()
      ).data?.id,
    )
    .single();
  const { data: activeSub } = await supabase
    .from("subscriptions")
    .select("id, effective_end_on")
    .eq("customer_profile_id", profile?.id)
    .eq("status", "ACTIVE")
    .single();

  if (!activeSub)
    return <div className="p-8 text-center">No active subscription found.</div>;

  // Fetch Addresses
  const { data: addresses } = await supabase
    .from("addresses")
    .select("*")
    .eq("customer_profile_id", profile?.id);

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
