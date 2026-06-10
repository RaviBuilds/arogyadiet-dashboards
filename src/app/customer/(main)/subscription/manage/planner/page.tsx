import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { MealPlannerClient } from "@/shared/components/customer/subscription/manage/meal-planner-client";
import { repairOverLimitPauseCredits } from "@/actions/manageMealActions";
import { fetchHolidaysInRange } from "@/actions/admin-actions/holidayActions";

export const revalidate = 0;

export default async function ManageMealPlannerPage() {
  const supabase = await createClient();

  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("id, dietary_preference")
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

  // 2. Fetch Active Subscription
  const { data: activeSub } = await supabase
    .from("subscriptions")
    .select(
      "id, effective_end_on, starts_on, pause_credits_total, pause_credits_used, subscription_plans(duration_days)",
    )
    .eq("customer_profile_id", profile.id)
    .eq("status", "ACTIVE")
    .single();

  if (!activeSub) {
    return (
      <div className="p-8 text-center mt-10">
        <h2 className="text-xl font-bold">No Active Subscription</h2>
        <p className="text-muted-foreground">
          You need an active subscription to manage meals.
        </p>
      </div>
    );
  }

  let totalPausesUsed = 0;
  const { count: initialPauseCount } = await supabase
    .from("subscription_daily_preferences")
    .select("*", { count: "exact", head: true })
    .eq("subscription_id", activeSub.id)
    .eq("is_paused", true);

  totalPausesUsed = initialPauseCount ?? 0;

  if (totalPausesUsed > (activeSub.pause_credits_total ?? 0)) {
    await repairOverLimitPauseCredits(activeSub.id);
    const { count: repairedCount } = await supabase
      .from("subscription_daily_preferences")
      .select("*", { count: "exact", head: true })
      .eq("subscription_id", activeSub.id)
      .eq("is_paused", true);
    totalPausesUsed = repairedCount ?? totalPausesUsed;
  }

  const { data: mealCategories } = await supabase
    .from("meal_categories")
    .select("id, code, name")
    .order("code", { ascending: true });

  // 4. Fetch the Daily Roster (From subscription start until end date)
  const startDate = activeSub.starts_on || format(new Date(), "yyyy-MM-dd");
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const { data: dailyPrefs } = await supabase
    .from("subscription_daily_preferences")
    .select("preference_date, is_paused, meal_categories(code)")
    .eq("subscription_id", activeSub.id)
    .gte("preference_date", startDate)
    .lte("preference_date", activeSub.effective_end_on)
    .order("preference_date", { ascending: true });

  // 5. Format Data for the Client
  const scheduleDays: string[] = [];
  const initialOverrides: Record<string, string> = {};
  const pausedDates: string[] = [];

  const rawPref = profile.dietary_preference || "Veg";
  const baseFoodType =
    rawPref === "Non-Veg"
      ? "CHICKEN"
      : rawPref === "Egg"
        ? "EGG"
        : "VEG";

  dailyPrefs?.forEach((pref) => {
    scheduleDays.push(pref.preference_date);

    if (pref.is_paused) {
      pausedDates.push(pref.preference_date);
    } else {
      const category = Array.isArray(pref.meal_categories)
        ? pref.meal_categories[0]
        : pref.meal_categories;

      if (category?.code && category.code !== baseFoodType) {
        initialOverrides[pref.preference_date] = category.code;
      }
    }
  });

  const holidaysByDate = await fetchHolidaysInRange(
    startDate,
    activeSub.effective_end_on,
  );

  const planData = Array.isArray(activeSub.subscription_plans)
    ? activeSub.subscription_plans[0]
    : activeSub.subscription_plans;
  const planDuration = planData?.duration_days ?? scheduleDays.length;

  return (
    <MealPlannerClient
      subscriptionId={activeSub.id}
      baseFoodType={baseFoodType}
      scheduleDays={scheduleDays}
      initialOverrides={initialOverrides}
      initialPausedDates={pausedDates}
      mealCategories={mealCategories || []}
      maxPauses={activeSub.pause_credits_total}
      totalPausesUsed={totalPausesUsed ?? 0}
      holidaysByDate={holidaysByDate}
      planDuration={planDuration}
      subscriptionStartDate={startDate}
    />
  );
}
