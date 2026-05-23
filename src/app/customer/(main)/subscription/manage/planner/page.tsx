import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { MealPlannerClient } from "@/shared/components/customer/subscription/manage/meal-planner-client";

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
    .select("id, effective_end_on")
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

  // 3. Fetch Meal Categories (to map names to UUIDs)
  const { data: categories } = await supabase
    .from("meal_categories")
    .select("id, code");
  const categoryMap: Record<string, string> = {};

  // Map our UI labels back to DB codes
  categories?.forEach((c) => {
    if (c.code === "VEG") categoryMap["Veg"] = c.id;
    if (c.code === "CHICKEN") categoryMap["Non-Veg"] = c.id;
    if (c.code === "EGG") categoryMap["Egg"] = c.id;
    if (c.code === "MIXED") categoryMap["Mixed"] = c.id;
  });

  // 4. Fetch the Daily Roster (From today until end date)
  const todayStr = format(new Date(), "yyyy-MM-dd");

  const { data: dailyPrefs } = await supabase
    .from("subscription_daily_preferences")
    .select("preference_date, is_paused, meal_categories(code)")
    .eq("subscription_id", activeSub.id)
    .gte("preference_date", todayStr)
    .lte("preference_date", activeSub.effective_end_on)
    .order("preference_date", { ascending: true });

  // 5. Format Data for the Client
  const scheduleDays: string[] = [];
  const initialOverrides: Record<string, string> = {};
  const pausedDates: string[] = [];

  // Re-map DB codes back to UI labels
  const reverseMap: Record<string, string> = {
    VEG: "Veg",
    CHICKEN: "Non-Veg",
    EGG: "Egg",
    MIXED: "Mixed",
  };

  const baseFoodType = profile.dietary_preference || "Veg";

  dailyPrefs?.forEach((pref) => {
    scheduleDays.push(pref.preference_date);

    if (pref.is_paused) {
      pausedDates.push(pref.preference_date);
    } else {
      // Safely handle Supabase returning either an array or a single object
      const category = Array.isArray(pref.meal_categories)
        ? pref.meal_categories[0]
        : pref.meal_categories;

      if (category?.code) {
        const uiLabel = reverseMap[category.code] || baseFoodType;
        // Only add to overrides if it differs from the base preference
        if (uiLabel !== baseFoodType) {
          initialOverrides[pref.preference_date] = uiLabel;
        }
      }
    }
  });

  return (
    <MealPlannerClient
      subscriptionId={activeSub.id}
      baseFoodType={baseFoodType}
      scheduleDays={scheduleDays}
      initialOverrides={initialOverrides}
      pausedDates={pausedDates}
      categoryMap={categoryMap}
    />
  );
}
