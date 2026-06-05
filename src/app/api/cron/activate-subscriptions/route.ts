import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notifyAdmins, sendNotificationToUser } from "@/lib/notifications";
import { getCustomerNameByProfileId } from "@/lib/notifications/lookups";
import { notifySubscriptionStopped } from "@/lib/subscription/subscriptionNotifications";
import { format, addDays } from "date-fns";

/**
 * GET /api/cron/activate-subscriptions?secret=<CRON_SECRET>
 *
 * Run this at ~5:00 PM daily, BEFORE the 5:15 PM delivery-order generation automation.
 *
 * What it does:
 *  1. Activates PENDING subscriptions whose starts_on = tomorrow.
 *     This lets the 5:15 PM automation pick them up and create delivery orders for the first day.
 *  2. Marks ACTIVE subscriptions whose effective_end_on = today as STOPPED.
 *     This cleans up plans that have fully concluded.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET || "arogya-demo-123";

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseAdmin = createAdminClient();
  const today = format(new Date(), "yyyy-MM-dd");
  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");

  try {
    // 1. Activate pending subscriptions starting tomorrow
    const { data: activated, error: activateError } = await supabaseAdmin
      .from("subscriptions")
      .update({ status: "ACTIVE" })
      .eq("status", "PENDING")
      .eq("starts_on", tomorrow)
      .select("id, customer_profile_id, starts_on");

    if (activateError) {
      console.error("Error activating subscriptions:", activateError);
      return NextResponse.json(
        { success: false, error: activateError.message },
        { status: 500 },
      );
    }

    if (activated?.length) {
      for (const sub of activated) {
        const { data: profile } = await supabaseAdmin
          .from("customer_profiles")
          .select("user_id")
          .eq("id", sub.customer_profile_id)
          .maybeSingle();

        if (profile?.user_id) {
          await sendNotificationToUser(profile.user_id, {
            title: "Subscription Activated!",
            message:
              "Your upcoming pending subscription has been activated. See more info.",
            actionUrl: "/customer/dashboard",
            sendEmail: false,
          });
        }

        const customerName = await getCustomerNameByProfileId(
          sub.customer_profile_id,
        );

        await notifyAdmins({
          title: "Pending Subscription Activated!",
          message: `Hi Admin, Pending subscription has been activated for the customer ${customerName}.`,
          actionUrl: "/admin/customers",
          sendEmail: false,
        });
      }
    }

    // 2. Stop active subscriptions that ended today
    const { data: stopped, error: stopError } = await supabaseAdmin
      .from("subscriptions")
      .update({ status: "STOPPED" })
      .eq("status", "ACTIVE")
      .eq("effective_end_on", today)
      .select("id, customer_profile_id, effective_end_on");

    if (stopError) {
      console.error("Error stopping subscriptions:", stopError);
      return NextResponse.json(
        { success: false, error: stopError.message },
        { status: 500 },
      );
    }

    if (stopped?.length) {
      for (const sub of stopped) {
        await notifySubscriptionStopped(sub.customer_profile_id, sub.id);
      }
    }

    const summary = {
      today,
      tomorrow,
      activated: activated?.length ?? 0,
      activatedIds: activated?.map((s: any) => s.id) ?? [],
      stopped: stopped?.length ?? 0,
      stoppedIds: stopped?.map((s: any) => s.id) ?? [],
    };

    console.log("Subscription activation cron result:", summary);

    return NextResponse.json({ success: true, data: summary }, { status: 200 });
  } catch (error: any) {
    console.error("Activate Subscriptions Cron Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
