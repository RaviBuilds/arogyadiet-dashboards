import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { differenceInCalendarDays, format, parseISO } from "date-fns";

import { SubscriptionHero } from "@/shared/components/customer/subscription/plans/SubscriptionHero";
import {
  CurrentSubscriptionCard,
  NoSubscriptionCard,
} from "@/shared/components/customer/subscription/plans/CurrentSubscriptionCard";
import { ProfileGateBanner } from "@/shared/components/customer/subscription/plans/ProfileGateBanner";
import { OutstandingBalanceBanner } from "@/shared/components/customer/subscription/plans/OutstandingBalanceBanner";
import { SubscriptionPlansGrid } from "@/shared/components/customer/subscription/plans/SubscriptionPlansGrid";
import { getOutstandingBalanceForCustomer } from "@/services/SubscriptionPaymentService";

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
  total_days: number | null;
  plan_id: string | null;
  subscription_plans:
    | { name: string | null; duration_days: number | null }
    | { name: string | null; duration_days: number | null }[]
    | null;
};

export default async function StorefrontPage() {
  const { supabase, user, customerProfileId, error } =
    await getCustomerSession();
  if (error || !user) redirect("/login");

  // Parallelize independent queries: subscriptions, plans, profile data, and
  // the outstanding-balance check that gates new purchases
  // (meal-subscription-partial-payment, Phase 5.1).
  const [subscriptionsResult, plansResult, profileResult, outstanding] =
    await Promise.all([
    customerProfileId
      ? supabase
          .from("subscriptions")
          .select(
            "id, status, starts_on, effective_end_on, subscription_code, total_days, plan_id, subscription_plans ( name, duration_days )",
          )
          .eq("customer_profile_id", customerProfileId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null as AccountSubscription[] | null }),
    supabase
      .from("subscription_plans")
      .select("*")
      .eq("is_active", true)
      .order("price"),
    customerProfileId
      ? supabase
          .from("customer_profiles")
          .select("*")
          .eq("id", customerProfileId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Ledger-derived, so subscriptions paid in full at onboarding (which is all
    // of them before this feature) have no ledger rows and can never register
    // as outstanding.
    customerProfileId
      ? getOutstandingBalanceForCustomer(customerProfileId)
      : Promise.resolve(null),
  ]);

  const subscriptions = subscriptionsResult.data;
  const plans = plansResult.data;
  const profile = profileResult.data;
  const hasOutstandingBalance = outstanding?.hasOutstanding ?? false;

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

  // Journey-day math — identical derivation AND convention to the
  // Dashboard's JourneyHeader (differenceInCalendarDays from starts_on/
  // effective_end_on, progress driven by the current day-in-journey), so
  // "Day X of Y" / progress % / days remaining always agree with the
  // Dashboard. The `consumed_days` column is a legacy field that's never
  // incremented anywhere in the codebase, so it can't be used here.
  let journeyDay: number | null = null;
  let totalJourneyDays: number | null = null;
  if (currentSubscription?.starts_on) {
    const journeyStart = parseISO(currentSubscription.starts_on);
    const journeyEnd = currentSubscription.effective_end_on
      ? parseISO(currentSubscription.effective_end_on)
      : null;
    totalJourneyDays = journeyEnd
      ? Math.max(1, differenceInCalendarDays(journeyEnd, journeyStart) + 1)
      : currentSubscription.total_days || 1;
    const rawJourneyDay =
      differenceInCalendarDays(new Date(), journeyStart) + 1;
    journeyDay = Math.max(1, Math.min(rawJourneyDay, totalJourneyDays));
  }

  const isProfileComplete = !!profile?.dietary_preference;

  return (
    <div className="max-w-6xl mx-auto space-y-8 sm:space-y-10">
      {/* ========================================== */}
      {/* 1. HERO — the story opens                  */}
      {/* ========================================== */}
      <SubscriptionHero />

      {/* ========================================== */}
      {/* 2. CURRENT SUBSCRIPTION                    */}
      {/* ========================================== */}
      {currentSubscription ? (
        <CurrentSubscriptionCard
          planName={currentPlanName}
          status={currentStatus}
          startsOn={currentSubscription.starts_on}
          endsOn={currentSubscription.effective_end_on}
          subscriptionCode={currentSubscription.subscription_code}
          totalDays={totalJourneyDays}
          journeyDay={journeyDay}
          formatFn={(v) => format(parseISO(v), "MMM do, yyyy")}
        />
      ) : (
        <NoSubscriptionCard />
      )}

      {/* OUTSTANDING BALANCE GATE — rendered above the profile gate because it
          is the blocker the customer must resolve first; completing their
          profile would not unlock anything while a balance is owed. */}
      {hasOutstandingBalance && outstanding && (
        <OutstandingBalanceBanner
          outstandingAmount={outstanding.totalOutstanding}
        />
      )}

      {/* PROFILE GATE WARNING (unchanged business rule) */}
      {!isProfileComplete && <ProfileGateBanner />}

      {/* ========================================== */}
      {/* 3 & 4. AVAILABLE PLANS + COMPARISON        */}
      {/* ========================================== */}
      <section
        className="reveal-rise space-y-5"
        style={{ ["--reveal-delay" as string]: "300ms" }}
      >
        <div className="text-center">
          <h2 className="text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
            Available Plans
          </h2>
          <p className="mx-auto mt-1.5 max-w-xl text-sm text-slate-500">
            Every plan is built around the same wholesome standard — pick the
            duration that matches your goals.
          </p>
        </div>

        <SubscriptionPlansGrid
          plans={plans ?? []}
          currentPlanId={currentSubscription?.plan_id ?? null}
          isProfileComplete={isProfileComplete}
          hasOutstandingBalance={hasOutstandingBalance}
        />
      </section>
    </div>
  );
}
