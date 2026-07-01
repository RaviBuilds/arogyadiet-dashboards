import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { format, parseISO } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  PackageX,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/shared/components/ui/card";
import { Button } from "@/shared/components/ui/button";
import { Badge } from "@/shared/components/ui/badge";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/shared/components/ui/alert";
import { cn } from "@/lib/utils";

// Prefer showing the live subscription first, then an upcoming one, then any
// terminal record, so the account view surfaces the most relevant subscription
// attached during onboarding (Req 11.1).
const SUBSCRIPTION_STATUS_PRIORITY: Record<string, number> = {
  ACTIVE: 0,
  PENDING: 1,
  STOPPED: 2,
  EXPIRED: 3,
  CANCELLED: 4,
};

type AccountSubscription = {
  id: string;
  status: string | null;
  starts_on: string | null;
  effective_end_on: string | null;
  subscription_code: string | null;
  subscription_plans:
    | { name: string | null; duration_days: number | null }
    | { name: string | null; duration_days: number | null }[]
    | null;
};

function formatDate(value: string | null): string {
  if (!value) return "N/A";
  try {
    return format(parseISO(value), "MMM do, yyyy");
  } catch {
    return "N/A";
  }
}

export default async function StorefrontPage() {
  const supabase = await createClient();

  // 1. Authenticate
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: appUser } = await supabase
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (!appUser) redirect("/login");

  // 2. Fetch Profile & Active Subscriptions
  const { data: profile } = await supabase
    .from("customer_profiles")
    .select("*")
    .eq("user_id", appUser.id)
    .maybeSingle();

  // 2b. Fetch the subscription attached during onboarding (or any existing one).
  //     Access is NOT gated on email presence, so onboarded customers see this
  //     exactly like legacy customers (Req 11.1/11.5).
  const { data: subscriptions } = profile
    ? await supabase
        .from("subscriptions")
        .select(
          "id, status, starts_on, effective_end_on, subscription_code, subscription_plans ( name, duration_days )",
        )
        .eq("customer_profile_id", profile.id)
        .order("created_at", { ascending: false })
    : { data: null as AccountSubscription[] | null };

  // Pick the most relevant subscription to display (Req 11.1).
  const currentSubscription =
    (subscriptions as AccountSubscription[] | null)
      ?.slice()
      .sort(
        (a, b) =>
          (SUBSCRIPTION_STATUS_PRIORITY[a.status ?? ""] ?? 9) -
          (SUBSCRIPTION_STATUS_PRIORITY[b.status ?? ""] ?? 9),
      )[0] ?? null;

  const currentPlan = currentSubscription
    ? Array.isArray(currentSubscription.subscription_plans)
      ? currentSubscription.subscription_plans[0]
      : currentSubscription.subscription_plans
    : null;
  const currentPlanName = currentPlan?.name || "Custom Plan";
  const currentStatus = currentSubscription?.status ?? "";
  const isActiveStatus = currentStatus === "ACTIVE";
  const isPendingStatus = currentStatus === "PENDING";

  // 3. Fetch Plans
  const { data: plans } = await supabase
    .from("subscription_plans")
    .select("*")
    .eq("is_active", true)
    .order("price");

    // const customOrder = [30, 90, 60];

    // const plans = plansData?.sort((a, b) => {
    //   return (
    //     customOrder.indexOf(a.duration_days) -
    //     customOrder.indexOf(b.duration_days)
    //   );
    // });

  const isProfileComplete = !!profile?.dietary_preference;

  return (
    <div className="max-w-6xl mx-auto space-y-10 animate-in fade-in slide-in-from-bottom-4">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 tracking-tight">
          Choose Your Plan
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Select a meal plan that fits your lifestyle. Healthy, chef-prepared
          meals delivered daily.
        </p>
      </div>

      {/* CURRENT SUBSCRIPTION SUMMARY (Req 11.1) or NO-SUBSCRIPTION STATE (Req 11.2) */}
      {currentSubscription ? (
        <Card className="border border-slate-200 bg-white shadow-sm overflow-hidden">
          <CardHeader className="border-b border-slate-100 bg-slate-50/50 px-6 py-4 flex flex-row items-center justify-between gap-4">
            <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              Your Subscription
            </CardTitle>
            <Badge
              variant="outline"
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wider",
                isActiveStatus
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : isPendingStatus
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : "border-slate-200 bg-slate-50 text-slate-600",
              )}
            >
              {isActiveStatus ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <Clock className="h-3.5 w-3.5" />
              )}
              {currentStatus || "UNKNOWN"}
            </Badge>
          </CardHeader>
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
              <div className="min-w-0">
                <h3 className="text-xl font-semibold text-slate-900 mb-1 truncate">
                  {currentPlanName}
                </h3>
                {currentSubscription.subscription_code && (
                  <p className="text-sm text-slate-500 font-mono">
                    {currentSubscription.subscription_code}
                  </p>
                )}
              </div>
              <div className="flex gap-6 sm:gap-8 text-sm">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Start Date
                  </p>
                  <p className="font-semibold text-slate-900">
                    {formatDate(currentSubscription.starts_on)}
                  </p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
                    Est. End Date
                  </p>
                  <p className="font-semibold text-slate-900">
                    {formatDate(currentSubscription.effective_end_on)}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
          <CardFooter className="px-6 py-4 border-t border-slate-100 bg-slate-50/50">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard">
                View Subscription Details{" "}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Alert className="bg-slate-50 border-slate-200 text-slate-800 shadow-sm">
          <PackageX className="h-5 w-5 stroke-slate-500" />
          <AlertTitle className="font-semibold text-slate-900">
            No subscription found
          </AlertTitle>
          <AlertDescription className="mt-1 text-sm text-slate-600 leading-relaxed">
            We couldn&apos;t find a subscription attached to your account. Choose
            a plan below to get started, or contact the clinic if you believe
            this is a mistake.
          </AlertDescription>
        </Alert>
      )}

      {/* THE PROFILE GATE WARNING */}
      {!isProfileComplete && (
        <Alert className="bg-amber-50/80 border-amber-200 text-amber-900 shadow-sm">
          <AlertCircle className="h-5 w-5 stroke-amber-600" />
          <AlertTitle className="font-semibold text-amber-900">
            Profile Incomplete
          </AlertTitle>
          <AlertDescription className="mt-2 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <p className="text-sm text-amber-800/90 leading-relaxed">
              Please update your dietary preferences in your profile before
              initiating a plan customization and purchase.
            </p>
            <Button
              asChild
              size="sm"
              className="bg-amber-600 hover:bg-amber-700 text-white shrink-0 transition-all duration-200"
            >
              <Link href="/profile">
                Update Profile Now <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* RENDER PLANS */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {plans?.map((plan) => {
          // Highlight the middle plan as "Popular" automatically if there are 3 plans
          const isPopular = plan.recommended; // Adjust based on your strategy

          return (
            <Card
              key={plan.id}
              className={`border border-slate-200 bg-white shadow-sm flex flex-col relative overflow-hidden transition-all duration-200 hover:shadow-md hover:border-slate-300 ${isPopular ? "border-secondary border-2 shadow-lg z-10 md:scale-[1.02]" : ""}`}
            >
              {isPopular && (
                <div className="absolute top-0 left-0 right-0 bg-secondary/10 text-secondary border-b border-secondary/20 text-xs font-semibold uppercase tracking-wider py-2 text-center pointer-events-none">
                  Best Value
                </div>
              )}
              <CardHeader
                className={`border-b border-slate-100 bg-slate-50/50 px-6 py-4 ${isPopular ? "pt-10" : ""}`}
              >
                <CardTitle className="text-lg font-semibold text-slate-900 tracking-tight">
                  {plan.name}
                </CardTitle>
                <CardDescription className="text-sm text-slate-500">
                  Perfect for {plan.duration_days} days of healthy meals
                </CardDescription>
              </CardHeader>
              <CardContent className="flex-1 p-6 space-y-6">
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-slate-900 tracking-tight">
                    ₹{plan.price.toLocaleString("en-IN")}
                  </span>
                  <span className="text-sm text-slate-500">
                    /{plan.duration_days} days
                  </span>
                </div>

                <ul className="space-y-3.5 text-sm text-slate-600">
                  <li className="flex items-center gap-2 transition-colors duration-200">
                    <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>{plan.duration_days} Premium Meals</span>
                  </li>
                  <li className="flex items-center gap-2 transition-colors duration-200">
                    <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>{plan.pause_credits} Pause Credits</span>
                  </li>
                  <li className="flex items-center gap-2 transition-colors duration-200">
                    <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Dedicated Delivery Team</span>
                  </li>
                  <li className="flex items-center gap-2 transition-colors duration-200">
                    <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>Customizable Planner</span>
                  </li>
                </ul>
              </CardContent>
              <CardFooter className="p-6 pt-0 border-0 bg-transparent">
                <Button
                  className="w-full font-bold h-11 text-base transition-all duration-200"
                  variant={isPopular ? "default" : "outline"}
                  disabled={!isProfileComplete}
                  asChild={isProfileComplete}
                >
                  {isProfileComplete ? (
                    <Link href={`/subscription/checkout?plan=${plan.id}`}>
                      Subscribe Now
                    </Link>
                  ) : (
                    <span>Subscribe Now</span>
                  )}
                </Button>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
