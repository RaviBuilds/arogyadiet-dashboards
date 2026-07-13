import { NextResponse } from "next/server";
import { runSubscriptionActivation } from "@/services/FallbackAutomationService";

/**
 * GET /api/cron/activate-subscriptions?secret=<CRON_SECRET>
 *
 * Run this at ~5:00 PM daily, BEFORE the 5:15 PM delivery-order generation automation.
 *
 * What it does:
 *  1. Activates PENDING subscriptions whose starts_on = tomorrow.
 *     This lets the 5:15 PM automation pick them up and create delivery orders for the first day.
 *  2. Marks ACTIVE subscriptions whose effective_end_on <= today as EXPIRED.
 *     This cleans up plans that have fully concluded (also catches missed days).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runSubscriptionActivation("cron");
    console.log("Subscription activation cron result:", summary);
    return NextResponse.json({ success: true, data: summary }, { status: 200 });
  } catch (error: any) {
    console.error("Activate Subscriptions Cron Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
