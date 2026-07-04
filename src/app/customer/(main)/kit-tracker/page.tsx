import { getCustomerSession } from "@/lib/customer/get-session";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { format } from "date-fns";
import { PackageReceiptScreen } from "@/shared/components/customer/kit-tracker/PackageReceiptScreen";
import { DailyTrackerClient } from "@/shared/components/customer/kit-tracker/DailyTrackerClient";

export const revalidate = 0;

export default async function KitTrackerPage() {
  const { user, profile, error } = await getCustomerSession();
  if (error || !user) redirect("/login");

  const supabase = await createClient();
  const todayServerDate = format(new Date(), "yyyy-MM-dd");

  // Resolve customer_profile_id from the users table
  const { data: cpRow } = await supabase
    .from("customer_profiles")
    .select("id")
    .eq("user_id", profile?.id ?? "")
    .maybeSingle();

  if (!cpRow) redirect("/dashboard?msg=kit-tracker-unavailable");

  // Check the customer's active subscription category
  const { data: activeSub } = await supabase
    .from("subscriptions")
    .select("id, customer_category")
    .eq("customer_profile_id", cpRow.id)
    .in("status", ["ACTIVE", "PENDING"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // If the customer has an active subscription but it's not KIT, redirect (Req 1.3)
  if (activeSub && activeSub.customer_category !== "KIT") {
    redirect("/dashboard?msg=kit-tracker-unavailable");
  }

  // Fetch the KIT subscription with tracker fields
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select(
      "id, customer_category, starts_on, kit_duration_days, kit_received_date, kit_tracker_end_date, kit_total_skipped_days"
    )
    .eq("customer_profile_id", cpRow.id)
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
