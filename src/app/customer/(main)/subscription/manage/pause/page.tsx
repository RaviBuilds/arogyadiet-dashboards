import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { PauseClient } from "@/shared/components/customer/subscription/manage/pause-client";

export const revalidate = 0;

export default async function ManagePausePage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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

  if (!profile) redirect("/profile");

  const { data: activeSub } = await supabase
    .from("subscriptions")
    .select("id, effective_end_on, pause_credits_total, pause_credits_used")
    .eq("customer_profile_id", profile.id)
    .eq("status", "ACTIVE")
    .single();

  if (!activeSub) {
    return (
      <div className="p-8 text-center mt-10">
        <h2 className="text-xl font-bold">No Active Subscription</h2>
        <p className="text-muted-foreground">
          You need an active subscription to manage pauses.
        </p>
      </div>
    );
  }

  const todayStr = format(new Date(), "yyyy-MM-dd");

  const { data: dailyPrefs } = await supabase
    .from("subscription_daily_preferences")
    .select("preference_date, is_paused")
    .eq("subscription_id", activeSub.id)
    .gte("preference_date", todayStr)
    .lte("preference_date", activeSub.effective_end_on)
    .order("preference_date", { ascending: true });

  const { count: pausedCount } = await supabase
    .from("subscription_daily_preferences")
    .select("*", { count: "exact", head: true })
    .eq("subscription_id", activeSub.id)
    .eq("is_paused", true);

  const scheduleDays: string[] = [];
  const initialPausedDates: string[] = [];

  dailyPrefs?.forEach((pref) => {
    scheduleDays.push(pref.preference_date);
    if (pref.is_paused) {
      initialPausedDates.push(pref.preference_date);
    }
  });

  return (
    <PauseClient
      subscriptionId={activeSub.id}
      scheduleDays={scheduleDays}
      initialPausedDates={initialPausedDates}
      maxPauses={activeSub.pause_credits_total}
      initialPausesUsed={pausedCount ?? activeSub.pause_credits_used}
    />
  );
}
