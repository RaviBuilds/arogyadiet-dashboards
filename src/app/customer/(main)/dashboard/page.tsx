import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format, parseISO, addDays } from "date-fns";
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

export default async function CustomerDashboard() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser, error: userError } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!appUser) redirect("/login");

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
              You don't have an active meal plan yet. Subscribe today to get
              healthy, chef-prepared meals delivered daily.
            </p>
            <Button
              asChild
              size="lg"
              className="mt-6 font-bold bg-primary hover:bg-primary/90 text-white"
            >
              <Link href="/subscription/checkout">
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
  const pausePercentage = Math.round(
    (activeSub.pause_credits_used / safeTotal) * 100,
  );

  // --- NEW: Fetch Next 7 Days Deliveries ---
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
                {activeSub.pause_credits_used}
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
              {activeSub.pause_credits_total - activeSub.pause_credits_used}{" "}
              credits remaining. Pausing a delivery automatically extends your
              end date.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* NEW: Next 7 Days Roster */}
      <div className="pt-6">
        <h2 className="text-xl font-bold text-zinc-900 mb-4 flex items-center gap-2">
          Upcoming Deliveries
          <span className="bg-zinc-100 text-zinc-600 text-xs px-2 py-1 rounded-full font-semibold">
            Next 7 Days
          </span>
        </h2>

        <div className="bg-white border rounded-xl shadow-sm overflow-hidden">
          {upcomingMeals?.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No upcoming deliveries found.
            </div>
          ) : (
            <div className="divide-y">
              {upcomingMeals?.map((meal, idx) => {
                const mealDate = parseISO(meal.preference_date);
                const address = Array.isArray(meal.addresses)
                  ? meal.addresses[0]
                  : meal.addresses;
                const category = Array.isArray(meal.meal_categories)
                  ? meal.meal_categories[0]
                  : meal.meal_categories;

                return (
                  <div
                    key={idx}
                    className={cn(
                      "p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors",
                      meal.is_paused ? "bg-zinc-50" : "hover:bg-zinc-50/50",
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          "w-14 h-14 rounded-lg flex flex-col items-center justify-center shrink-0 border",
                          meal.is_paused
                            ? "bg-zinc-100 border-zinc-200"
                            : "bg-primary/5 border-primary/20 text-primary",
                        )}
                      >
                        <span className="text-[10px] font-bold uppercase">
                          {format(mealDate, "EEE")}
                        </span>
                        <span className="text-lg font-black leading-none">
                          {format(mealDate, "dd")}
                        </span>
                      </div>
                      <div>
                        {meal.is_paused ? (
                          <p className="font-bold text-zinc-500 flex items-center gap-2">
                            <PauseCircle className="h-4 w-4" /> Delivery Paused
                          </p>
                        ) : (
                          <>
                            <p className="font-bold text-zinc-900">
                              {category?.code || "Standard Meal"}
                            </p>
                            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                              <MapPin className="h-3 w-3" /> {address?.tag}:{" "}
                              {address?.street_1}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
