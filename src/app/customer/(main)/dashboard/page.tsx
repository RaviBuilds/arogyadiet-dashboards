import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format, parseISO, addDays, isToday, isTomorrow } from "date-fns";
import Link from "next/link";
import {
  CalendarDays,
  Utensils,
  PauseCircle,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  MapPin,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";
import { cn } from "@/lib/utils";

export const revalidate = 0;

// --- DYNAMIC MEAL THEMES ---
const MEAL_THEMES: Record<string, any> = {
  VEG: {
    bg: "bg-green-50",
    border: "border-green-200",
    text: "text-green-700",
    label: "Veg",
  },
  CHICKEN: {
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-700",
    label: "Chicken",
  },
  EGG: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-700",
    label: "Egg",
  },
  MIXED: {
    bg: "bg-purple-50",
    border: "border-purple-200",
    text: "text-purple-700",
    label: "Mixed",
  },
};

export default async function CustomerDashboard() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) redirect("/login");

  const { data: appUser, error: appUserError } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (appUserError || !appUser) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("customer_profiles")
    .select("id, dietary_preference")
    .eq("user_id", appUser.id)
    .maybeSingle();

  if (profileError || !profile) {
    return (
      <div className="p-8">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Profile Error</AlertTitle>
          <AlertDescription>Failed to load customer profile.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const { data: subscriptions, error: subError } = await supabase
    .from("subscriptions")
    .select(`*, subscription_plans ( name, duration_days )`)
    .eq("customer_profile_id", profile.id)
    .order("created_at", { ascending: false });

  if (subError) {
    return (
      <div className="max-w-4xl mx-auto mt-10 p-4">
        <Alert variant="destructive" className="bg-red-50 border-red-200">
          <AlertCircle className="h-4 w-4 stroke-red-600" />
          <AlertTitle className="font-bold text-red-900">
            Database Query Failed
          </AlertTitle>
          <AlertDescription className="text-red-800 mt-2">
            {subError.message}
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const activeSub = subscriptions?.find((s) => s.status === "ACTIVE");

  if (!activeSub) {
    return (
      <div className="max-w-4xl mx-auto mt-10 animate-in fade-in slide-in-from-bottom-4">
        <Card className="border-2 border-dashed border-zinc-200 bg-zinc-50/50 text-center py-16">
          <CardContent className="flex flex-col items-center space-y-4">
            <div className="h-20 w-20 bg-zinc-100 rounded-full flex items-center justify-center mb-4">
              <Utensils className="h-10 w-10 text-zinc-400" />
            </div>
            <h2 className="text-2xl font-bold text-zinc-900">
              No Active Subscription
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              You don&apos;t have an active meal plan yet. Subscribe today to
              get healthy, chef-prepared meals delivered daily.
            </p>
            <Button
              asChild
              size="lg"
              className="mt-6 font-bold bg-primary hover:bg-primary/90 text-white"
            >
              <Link href="/subscription">
                Explore Plans <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const planDetails = Array.isArray(activeSub.subscription_plans)
    ? activeSub.subscription_plans[0]
    : activeSub.subscription_plans;
  const planName = planDetails?.name || "Custom Plan";
  const safeTotal = activeSub.pause_credits_total || 1;
  const { count: actualPauseCreditsUsed } = await supabase
    .from("subscription_daily_preferences")
    .select("*", { count: "exact", head: true })
    .eq("subscription_id", activeSub.id)
    .eq("is_paused", true);
  const pauseCreditsUsed =
    actualPauseCreditsUsed ?? activeSub.pause_credits_used ?? 0;
  const pausePercentage = Math.round((pauseCreditsUsed / safeTotal) * 100);

  // --- Fetch Next 7 Days Deliveries ---
  const todayStr = format(new Date(), "yyyy-MM-dd");
  const nextWeekStr = format(addDays(new Date(), 7), "yyyy-MM-dd");

  const { data: upcomingMeals } = await supabase
    .from("subscription_daily_preferences")
    .select(
      `
      preference_date,
      is_paused,
      meal_categories ( code ),
      addresses ( tag, street_1, city )
    `,
    )
    .eq("subscription_id", activeSub.id)
    .gte("preference_date", todayStr)
    .lte("preference_date", nextWeekStr)
    .order("preference_date", { ascending: true });

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in fade-in slide-in-from-bottom-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-900">My Subscription</h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-green-600" /> ID:{" "}
            <span className="font-mono text-zinc-700 font-medium">
              {activeSub.subscription_code}
            </span>
          </p>
        </div>
        <div className="bg-green-100 text-green-800 px-4 py-1.5 rounded-full text-sm font-bold flex items-center gap-2 border border-green-200">
          <CheckCircle2 className="h-4 w-4" /> ACTIVE
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 border-2 shadow-sm">
          <CardHeader className="bg-zinc-50 border-b pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Plan Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-6">
              <div>
                <h3 className="text-2xl font-black text-zinc-900 mb-1">
                  {planName}
                </h3>
                <p className="text-sm text-zinc-500 font-medium">
                  {activeSub.total_days} Meals Total
                </p>
              </div>
              <div className="flex gap-6 sm:gap-8 text-sm">
                <div className="space-y-1">
                  <p className="text-zinc-500 font-medium uppercase tracking-wider text-[10px]">
                    Start Date
                  </p>
                  <p className="font-bold text-zinc-900">
                    {activeSub.starts_on
                      ? format(parseISO(activeSub.starts_on), "MMM do, yyyy")
                      : "N/A"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-zinc-500 font-medium uppercase tracking-wider text-[10px]">
                    Est. End Date
                  </p>
                  <p className="font-bold text-zinc-900">
                    {activeSub.effective_end_on
                      ? format(
                          parseISO(activeSub.effective_end_on),
                          "MMM do, yyyy",
                        )
                      : "N/A"}
                  </p>
                </div>
              </div>
            </div>
            <div className="mt-8 pt-6 border-t flex items-center gap-4">
              <div className="bg-orange-100 p-3 rounded-full text-orange-600 shrink-0">
                <Utensils className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-zinc-500 font-medium">
                  Base Diet Preference
                </p>
                <p className="font-bold text-zinc-900">
                  {profile.dietary_preference || "Standard"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 shadow-sm flex flex-col">
          <CardHeader className="bg-zinc-50 border-b pb-4">
            <CardTitle className="text-lg flex items-center gap-2">
              <PauseCircle className="h-5 w-5 text-blue-600" />
              Pause Credits
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 flex-1 flex flex-col justify-center">
            <div className="flex justify-between items-end mb-2">
              <span className="text-4xl font-black text-zinc-900">
                {pauseCreditsUsed}
              </span>
              <span className="text-sm font-bold text-zinc-500 mb-1">
                / {activeSub.pause_credits_total} Used
              </span>
            </div>
            <div className="w-full h-3 bg-zinc-100 rounded-full overflow-hidden mt-4">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${pausePercentage >= 100 ? "bg-red-500" : "bg-blue-500"}`}
                style={{ width: `${Math.min(pausePercentage, 100)}%` }}
              />
            </div>
            <p className="text-xs text-zinc-500 mt-4 leading-relaxed">
              {activeSub.pause_credits_total - pauseCreditsUsed} credits
              remaining. Pausing a delivery automatically extends your end date.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* NEW: Next 7 Days Roster - Upgraded to Premium Grid */}
      <div className="pt-8">
        <div className="mb-6 flex items-center gap-3">
          <h3 className="text-xl font-bold text-zinc-900">
            Upcoming Deliveries
          </h3>
          <span className="px-3 py-1 bg-zinc-100 text-zinc-600 text-xs font-bold rounded-full border border-zinc-200 shadow-sm">
            Next 7 Days
          </span>
        </div>

        {upcomingMeals?.length === 0 ? (
          <div className="bg-white border rounded-xl shadow-sm p-8 text-center text-muted-foreground">
            No upcoming deliveries found.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-5">
            {upcomingMeals?.map((meal: any, idx: number) => {
              const date = parseISO(meal.preference_date);
              const isPaused = meal.is_paused;

              const address = Array.isArray(meal.addresses)
                ? meal.addresses[0]
                : meal.addresses;
              const category = Array.isArray(meal.meal_categories)
                ? meal.meal_categories[0]
                : meal.meal_categories;

              const mealCode = category?.code || "VEG";
              const theme = MEAL_THEMES[mealCode] || MEAL_THEMES["VEG"];

              // Temporal Context Badges
              const showToday = isToday(date);
              const showTomorrow = isTomorrow(date);

              return (
                <div
                  key={idx}
                  className={cn(
                    "flex flex-col relative overflow-hidden rounded-2xl border-2 transition-all p-5",
                    isPaused
                      ? "bg-zinc-50 border-zinc-200 border-dashed"
                      : cn(
                          "bg-white hover:shadow-md hover:-translate-y-1",
                          theme.border,
                        ),
                  )}
                >
                  {/* Top Header: Date & Status Badge */}
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
                        {format(date, "EEEE")}
                      </p>
                      <p
                        className={cn(
                          "text-2xl font-black",
                          isPaused ? "text-zinc-500" : "text-zinc-900",
                        )}
                      >
                        {format(date, "dd MMM")}
                      </p>
                    </div>

                    {!isPaused && showToday && (
                      <span className="bg-blue-100 text-blue-700 text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider shadow-sm">
                        Today
                      </span>
                    )}
                    {!isPaused && showTomorrow && (
                      <span className="bg-indigo-50 text-indigo-600 text-[10px] font-bold px-2 py-1 rounded-md uppercase tracking-wider shadow-sm">
                        Tomorrow
                      </span>
                    )}
                  </div>

                  {/* Middle: Meal Details or Paused State */}
                  <div className="flex-grow flex flex-col justify-center py-2">
                    {isPaused ? (
                      <div className="flex items-center gap-2 text-zinc-400">
                        <AlertCircle className="h-5 w-5" />
                        <span className="font-bold">Delivery Paused</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "px-3 py-1.5 rounded-lg border font-black text-sm tracking-wide",
                            theme.bg,
                            theme.text,
                            theme.border,
                          )}
                        >
                          {theme.label}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Bottom: Address Details */}
                  <div className="mt-4 pt-4 border-t border-zinc-100">
                    {isPaused ? (
                      <p className="text-xs text-zinc-400 font-medium">
                        No meal will be prepared.
                      </p>
                    ) : (
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 text-zinc-400 shrink-0 mt-0.5" />
                        <div className="overflow-hidden">
                          <p className="text-xs font-bold text-zinc-700 truncate">
                            {address?.tag || "Delivery Address"}
                          </p>
                          <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                            {address?.street_1 || "Address pending"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
