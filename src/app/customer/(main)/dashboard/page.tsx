import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { format, parseISO, addDays, isToday, isTomorrow } from "date-fns";
import Link from "next/link";
import Image from "next/image";
import {
  CalendarDays,
  Utensils,
  PauseCircle,
  CheckCircle2,
  ArrowRight,
  ShieldCheck,
  AlertCircle,
  MapPin,
  ShoppingBag,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";
import { cn } from "@/lib/utils";
import { repairOverLimitPauseCredits } from "@/actions/manageMealActions";
import { DashboardFixedBackgroundLogoLazy } from "@/shared/components/customer/DashboardFixedBackgroundLogoLazy";

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
  const { supabase, user, profile: appUser, error } =
    await getCustomerSession();
  if (error || !user) redirect("/login");
  if (!appUser) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("customer_profiles")
    .select("id, dietary_preference")
    .eq("user_id", appUser.id)
    .maybeSingle();

  if (profileError || !profile) {
    return (
      <div className="p-6">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Profile Error</AlertTitle>
          <AlertDescription>Failed to load customer profile.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const customerProfileId = profile.id;

  const [
    { data: addonOrders },
    { data: subscriptions, error: subError },
    { data: upcomingSubscriptions },
  ] = await Promise.all([
    supabase
      .from("addon_orders")
      .select(`id, delivery_order_id, delivery_orders(status)`)
      .eq("customer_profile_id", customerProfileId)
      .eq("status", "PAID"),
    supabase
      .from("subscriptions")
      .select(`*, subscription_plans ( name, duration_days )`)
      .eq("customer_profile_id", profile.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("subscriptions")
      .select(
        `id, starts_on, effective_end_on, status, subscription_code, subscription_plans ( name, duration_days )`,
      )
      .eq("customer_profile_id", customerProfileId)
      .in("status", ["PENDING"])
      .order("starts_on", { ascending: true }),
  ]);

  // Filter for active/pending shop deliveries
  const activeAddonOrders =
    addonOrders?.filter((order) => {
      const delivery = Array.isArray(order.delivery_orders)
        ? order.delivery_orders[0]
        : order.delivery_orders;

      return (
        !order.delivery_order_id ||
        (delivery &&
          delivery.status !== "DELIVERED" &&
          delivery.status !== "CANCELLED")
      );
    }) || [];

  const pendingSubscriptions = upcomingSubscriptions ?? [];

  if (subError) {
    return (
      <>
        <DashboardFixedBackgroundLogoLazy />
        <div className="relative z-10 max-w-4xl mx-auto mt-1 p-4">
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
      </>
    );
  }

  const activeSub = subscriptions?.find((s) => s.status === "ACTIVE");

  if (!activeSub) {
    return (
      <>
        <DashboardFixedBackgroundLogoLazy />
        <div className="relative z-10 max-w-4xl mx-auto mt-1 animate-in fade-in slide-in-from-bottom-4">
          <Card className="border border-dashed border-slate-200 bg-white shadow-sm text-center py-16">
            <CardContent className="flex flex-col items-center space-y-4">
              <div className="h-20 w-20 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <Utensils className="h-10 w-10 text-slate-400" />
              </div>
              <h2 className="text-xl font-semibold text-slate-900 tracking-tight">
                No Active Subscription
              </h2>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                You don&apos;t have an active meal plan yet. Subscribe today to
                get healthy, chef-prepared meals delivered daily.
              </p>
              <Button asChild size="lg" className="mt-6">
                <Link href="/subscription">
                  Explore Plans <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </>
    );
  }

  const planDetails = Array.isArray(activeSub.subscription_plans)
    ? activeSub.subscription_plans[0]
    : activeSub.subscription_plans;
  const planName = planDetails?.name || "Custom Plan";
  const safeTotal = activeSub.pause_credits_total || 1;

  const todayStr = format(new Date(), "yyyy-MM-dd");
  const nextWeekStr = format(addDays(new Date(), 7), "yyyy-MM-dd");

  const [{ count: initialPauseCount }, { data: upcomingMeals }] =
    await Promise.all([
      supabase
        .from("subscription_daily_preferences")
        .select("*", { count: "exact", head: true })
        .eq("subscription_id", activeSub.id)
        .eq("is_paused", true),
      supabase
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
        .order("preference_date", { ascending: true }),
    ]);

  let actualPauseCreditsUsed = initialPauseCount;

  if ((actualPauseCreditsUsed ?? 0) > safeTotal) {
    await repairOverLimitPauseCredits(activeSub.id);
    const { count: repairedCount } = await supabase
      .from("subscription_daily_preferences")
      .select("*", { count: "exact", head: true })
      .eq("subscription_id", activeSub.id)
      .eq("is_paused", true);
    actualPauseCreditsUsed = repairedCount;
  }

  const rawPauseCreditsUsed =
    actualPauseCreditsUsed ?? activeSub.pause_credits_used ?? 0;
  const pauseCreditsUsed = Math.min(rawPauseCreditsUsed, safeTotal);
  const pausePercentage = Math.round((pauseCreditsUsed / safeTotal) * 100);
  const pauseCreditsRemaining = Math.max(
    0,
    activeSub.pause_credits_total - pauseCreditsUsed,
  );

  return (
    <>
      <DashboardFixedBackgroundLogoLazy />
      <div className="relative z-10 max-w-5xl mx-auto space-y-10">
      <div className="relative w-full h-40 sm:h-48 md:h-56 rounded-xl overflow-hidden border border-slate-200 shadow-sm">
        <Image
          src="/banner.jpg"
          alt="Your Healthy Journey Starts Now"
          fill
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 90vw, 1024px"
          className="object-cover object-center"
          priority={true}
        />
        <div className="absolute inset-0 bg-linear-to-t from-slate-900/10 to-transparent pointer-events-none" />
      </div>

      {activeAddonOrders.length > 0 && (
        <Link href="/meals" className="block transition-all duration-200">
          <Card className="border border-amber-200 bg-amber-50/50 shadow-sm hover:shadow-md hover:border-amber-300 transition-all duration-200">
            <CardContent className="p-6 flex items-center gap-4">
              <div className="rounded-full bg-amber-100 text-amber-700 p-3 shrink-0">
                <ShoppingBag className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900">
                  Active Shop Orders
                </p>
                <p className="text-sm text-amber-800/90 mt-1 leading-relaxed">
                  You have {activeAddonOrders.length} pending shop order
                  {activeAddonOrders.length === 1 ? "" : "s"}. Tap to track in
                  <span className="font-bold"> My Meals</span>.
                </p>
              </div>
              <ArrowRight className="h-5 w-5 text-amber-700 shrink-0" />
            </CardContent>
          </Card>
        </Link>
      )}

      <div className="space-y-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
              My Subscription
            </h1>
            <p className="text-sm text-slate-500 mt-1 flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-green-600" /> ID:{" "}
              <span className="font-mono text-slate-700 font-medium">
                {activeSub.subscription_code}
              </span>
            </p>
          </div>
          <Badge
            variant="outline"
            className="shrink-0 rounded-full border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-700"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> ACTIVE
          </Badge>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="md:col-span-2 border border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Plan Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row justify-between sm:items-end gap-6">
              <div>
                <h3 className="text-xl font-semibold text-slate-900 mb-1">
                  {planName}
                </h3>
                <p className="text-sm text-slate-500">
                  {activeSub.total_days} Meals Total
                </p>
              </div>
              <div className="flex gap-6 sm:gap-8 text-sm">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Start Date
                  </p>
                  <p className="font-semibold text-slate-900">
                    {activeSub.starts_on
                      ? format(parseISO(activeSub.starts_on), "MMM do, yyyy")
                      : "N/A"}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Est. End Date
                  </p>
                  <p className="font-semibold text-slate-900">
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
            <div className="mt-8 pt-6 border-t border-slate-100 flex items-center gap-4">
              <div className="rounded-full bg-orange-50 p-3 text-orange-600 shrink-0">
                <Utensils className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm text-slate-500">
                  Base Diet Preference
                </p>
                <p className="font-semibold text-slate-900">
                  {profile.dietary_preference || "Standard"}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 bg-white shadow-sm flex flex-col">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-6 py-4">
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <PauseCircle className="h-5 w-5 text-blue-600" />
              Pause Credits
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 flex-1 flex flex-col justify-center">
            <div className="flex justify-between items-end mb-2">
              <span className="text-3xl font-semibold text-slate-900">
                {pauseCreditsUsed}
              </span>
              <span className="text-sm font-semibold text-slate-500 mb-1">
                / {activeSub.pause_credits_total} Used
              </span>
            </div>
            <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden mt-4">
              <div
                className={`h-full rounded-full transition-all duration-500 ${pausePercentage >= 100 ? "bg-red-500" : "bg-blue-500"}`}
                style={{ width: `${Math.min(pausePercentage, 100)}%` }}
              />
            </div>
            <p className="text-xs text-slate-500 mt-4 leading-relaxed">
              {pauseCreditsRemaining} credits remaining. Pausing a delivery
              automatically extends your end date.
            </p>
          </CardContent>
        </Card>
        </div>
      </div>

      {pendingSubscriptions.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900 tracking-tight">
            Upcoming Subscriptions
          </h3>
          <div className="grid grid-cols-1 gap-4">
            {pendingSubscriptions.map((sub) => {
              const upcomingPlan = Array.isArray(sub.subscription_plans)
                ? sub.subscription_plans[0]
                : sub.subscription_plans;
              const upcomingPlanName = upcomingPlan?.name || "Custom Plan";
              const durationLabel = upcomingPlan?.duration_days
                ? ` (${upcomingPlan.duration_days} Days)`
                : "";
              const isPending = sub.status === "PENDING";

              return (
                <Card
                  key={sub.id}
                  className="border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md"
                >
                  <CardContent className="p-6">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                      <div className="space-y-2 min-w-0">
                        <h4 className="font-semibold text-slate-900">
                          {upcomingPlanName}
                          {durationLabel}
                        </h4>
                        <p className="text-sm text-slate-500">
                          <span className="font-medium">Starts:</span>{" "}
                          {sub.starts_on
                            ? format(
                                parseISO(sub.starts_on),
                                "MMM do, yyyy",
                              )
                            : "N/A"}
                          <span className="text-slate-400 mx-2">→</span>
                          <span className="font-medium">Est. End:</span>{" "}
                          {sub.effective_end_on
                            ? format(
                                parseISO(sub.effective_end_on),
                                "MMM do, yyyy",
                              )
                            : "N/A"}
                        </p>
                        <p className="text-xs text-slate-500 leading-relaxed">
                          Activates automatically 1 day before the start date.
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className={cn(
                          "shrink-0 self-start rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                          isPending
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-slate-50 text-slate-700 border-slate-200",
                        )}
                      >
                        {sub.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}

      {/* NEW: Next 7 Days Roster - Upgraded to Premium Grid */}
      <div className="pt-8">
        <div className="mb-6 flex items-center gap-3">
          <h3 className="text-lg font-semibold text-slate-900 tracking-tight">
            Upcoming Deliveries
          </h3>
          <Badge
            variant="secondary"
            className="border border-slate-200 bg-slate-100 text-slate-600"
          >
            Next 7 Days
          </Badge>
        </div>

        {upcomingMeals?.length === 0 ? (
          <Card className="border border-slate-200 shadow-sm">
            <CardContent className="p-8 text-center text-sm text-slate-500">
              No upcoming deliveries found.
            </CardContent>
          </Card>
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
                <Card
                  key={idx}
                  className={cn(
                    "overflow-hidden transition-all duration-200",
                    isPaused
                      ? "border border-dashed border-slate-200 bg-slate-50/80 shadow-none"
                      : "border border-slate-200 bg-white shadow-sm hover:shadow-md hover:-translate-y-0.5",
                    !isPaused && theme.border,
                  )}
                >
                  <CardContent className="flex flex-col p-6 relative">
                  {/* Top Header: Date & Status Badge */}
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                        {format(date, "EEEE")}
                      </p>
                      <p
                        className={cn(
                          "text-xl font-semibold",
                          isPaused ? "text-slate-500" : "text-slate-900",
                        )}
                      >
                        {format(date, "dd MMM")}
                      </p>
                    </div>

                    {!isPaused && showToday && (
                      <Badge
                        variant="outline"
                        className="rounded-full border-blue-200 bg-blue-50 text-blue-700 text-[10px] font-semibold uppercase tracking-wider"
                      >
                        Today
                      </Badge>
                    )}
                    {!isPaused && showTomorrow && (
                      <Badge
                        variant="outline"
                        className="rounded-full border-indigo-200 bg-indigo-50 text-indigo-700 text-[10px] font-semibold uppercase tracking-wider"
                      >
                        Tomorrow
                      </Badge>
                    )}
                  </div>

                  {/* Middle: Meal Details or Paused State */}
                  <div className="grow flex flex-col justify-center py-2">
                    {isPaused ? (
                      <div className="flex items-center gap-2 text-slate-400">
                        <AlertCircle className="h-5 w-5" />
                        <span className="text-sm font-semibold">Delivery Paused</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "px-3 py-1.5 rounded-full border font-semibold text-sm tracking-wide",
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
                  <div className="mt-4 pt-4 border-t border-slate-100">
                    {isPaused ? (
                      <p className="text-sm text-slate-400">
                        No meal will be prepared.
                      </p>
                    ) : (
                      <div className="flex items-start gap-2">
                        <MapPin className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                        <div className="overflow-hidden">
                          <p className="text-xs font-semibold text-slate-700 truncate">
                            {address?.tag || "Delivery Address"}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                            {address?.street_1 || "Address pending"}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      </div>
    </>
  );
}
