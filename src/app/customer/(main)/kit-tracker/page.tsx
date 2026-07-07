import { getCustomerSession } from "@/lib/customer/get-session";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { PackageReceiptScreen } from "@/shared/components/customer/kit-tracker/PackageReceiptScreen";
import { DailyTrackerClient } from "@/shared/components/customer/kit-tracker/DailyTrackerClient";
import { getKitTrackerStateAction } from "@/actions/kitLifecycleActions";
import { StartNewKitFlow } from "@/shared/components/customer/kit-tracker/StartNewKitFlow";
import { NewKitArrivalBanner } from "@/shared/components/customer/kit-tracker/NewKitArrivalBanner";
import { KitExpirationMessage } from "@/shared/components/customer/kit-tracker/KitExpirationMessage";

export const revalidate = 0;

export default async function KitTrackerPage() {
  const { supabase, user, customerProfileId, error } = await getCustomerSession();
  if (error || !user) redirect("/login");
  if (!customerProfileId) redirect("/dashboard?msg=kit-tracker-unavailable");

  const todayServerDate = format(new Date(), "yyyy-MM-dd");

  // [Req 11.1, 11.2] The active-subscription-category check and
  // getKitTrackerStateAction() do not depend on each other's results — both
  // depend only on the already-resolved customerProfileId — so they run
  // concurrently instead of sequentially.
  const [activeSubResult, stateResult] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("id, customer_category")
      .eq("customer_profile_id", customerProfileId)
      .in("status", ["ACTIVE", "PENDING"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    getKitTrackerStateAction(),
  ]);
  const activeSub = activeSubResult.data;

  // If the customer has an active subscription but it's not KIT, redirect (Req 1.3)
  if (activeSub && activeSub.customer_category !== "KIT") {
    redirect("/dashboard?msg=kit-tracker-unavailable");
  }

  // ---------------------------------------------------------------------------
  // Determine KIT Tracker display state using lifecycle action (Req 7.3, 7.4, 7.5)
  // Priority: start_flow > receipt_flow > processing > expiration > active
  // ---------------------------------------------------------------------------

  if (stateResult.success) {
    const { state } = stateResult;

    switch (state.type) {
      // Priority 1: New KIT received (delivered_at set) → Start flow
      case "start_flow":
        return (
          <StartNewKitFlow
            subscriptionId={state.subscriptionId}
            deliveredAt={state.deliveredAt}
            kitDurationDays={state.kitDurationDays}
          />
        );

      // Priority 2: New KIT shipped but not received → Arrival banner
      case "receipt_flow":
        return (
          <NewKitArrivalBanner
            subscriptionId={state.subscriptionId}
            courierPartner={state.courierPartner}
            trackingNumber={state.trackingNumber}
            trackingUrl={state.trackingUrl}
            shippedAt={state.shippedAt}
          />
        );

      // Priority 3: New KIT exists but no shipping info yet → Processing banner
      case "processing":
        return (
          <NewKitArrivalBanner
            subscriptionId={state.subscriptionId}
            courierPartner={null}
            trackingNumber={null}
            trackingUrl={null}
            shippedAt={null}
          />
        );

      // Priority 4: Expired with no new KIT → Expiration message
      case "expiration":
        return <KitExpirationMessage />;

      // Priority 5: Active → fall through to existing daily tracker logic below
      case "active":
        break;
    }
  }

  // ---------------------------------------------------------------------------
  // Active KIT — Existing Daily Tracker logic
  // ---------------------------------------------------------------------------

  // Fetch the KIT subscription with tracker fields
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select(
      "id, customer_category, starts_on, kit_duration_days, kit_received_date, kit_tracker_end_date, kit_total_skipped_days"
    )
    .eq("customer_profile_id", customerProfileId)
    .eq("customer_category", "KIT")
    .in("status", ["ACTIVE", "PENDING"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // No KIT subscription found at all (Req 1.4)
  if (!subscription) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center space-y-2">
          <p className="text-lg font-medium text-muted-foreground">
            No KIT subscription found
          </p>
          <p className="text-sm text-muted-foreground">
            You need an active KIT subscription to use the tracker.
          </p>
        </div>
      </div>
    );
  }

  // Branch: kit_received_date IS NULL → Package Receipt Screen (Req 1.5)
  if (!subscription.kit_received_date) {
    const { count } = await supabase
      .from("kit_daily_logs")
      .select("id", { count: "exact", head: true })
      .eq("subscription_id", subscription.id);

    return (
      <PackageReceiptScreen
        subscriptionId={subscription.id}
        subscriptionStartDate={subscription.starts_on}
        initialReceivedDate={null}
        hasAnyDailyLog={(count ?? 0) > 0}
        todayServerDate={todayServerDate}
      />
    );
  }

  // Branch: kit_received_date IS NOT NULL → Daily Tracker Calendar (Req 1.6)
  const { data: dailyLogs } = await supabase
    .from("kit_daily_logs")
    .select("*")
    .eq("subscription_id", subscription.id)
    .order("log_date", { ascending: true });

  // Build dailyLogsByDate map (yyyy-MM-dd → log object)
  const dailyLogsByDate: Record<string, any> = {};
  for (const log of dailyLogs ?? []) {
    dailyLogsByDate[log.log_date] = log;
  }

  return (
    <DailyTrackerClient
      subscriptionId={subscription.id}
      receivedDate={subscription.kit_received_date}
      trackerEndDate={subscription.kit_tracker_end_date ?? todayServerDate}
      totalSkippedDays={subscription.kit_total_skipped_days ?? 0}
      dailyLogsByDate={dailyLogsByDate}
      todayServerDate={todayServerDate}
    />
  );
}
