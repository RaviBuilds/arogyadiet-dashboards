import { NextResponse } from "next/server";
import { generateDailyOrders } from "@/actions/system-actions/orderGeneration";
import { getISTDateString, getTomorrowISTDateString } from "@/lib/dates/ist";
import { buildPushPayload, notifyAdmins } from "@/lib/notifications";
import { notifyCustomersMealsOrderCreated } from "@/lib/notifications/orderNotifications";
import { persistWorkloadSnapshots } from "@/lib/clinic/workload";

/**
 * GET /api/cron/generate-orders?secret=<CRON_SECRET>&date=YYYY-MM-DD
 *
 * Scheduled at ~5:15 PM IST daily (via external cron / Supabase pg_cron).
 * Generates delivery_orders for tomorrow unless an explicit date is passed.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  console.log("generate-orders cron job started here");
  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const tomorrow = getTomorrowISTDateString();
    const queryDate = searchParams.get("date");
    const targetDate = queryDate || tomorrow;

    if (targetDate !== tomorrow) {
      return NextResponse.json(
        {
          success: false,
          error: `Only tomorrow's date (${tomorrow}) is allowed for order generation.`,
        },
        { status: 400 },
      );
    }

    const result = await generateDailyOrders(targetDate);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 },
      );
    }

    // Persist workload snapshots after order creation (initial meal counts)
    let snapshotResult = null;
    try {
      snapshotResult = await persistWorkloadSnapshots(targetDate);
    } catch (snapshotError) {
      console.error("Workload snapshot error after order generation:", snapshotError);
    }

    try {
      const adminTitle = "Order Creation Automation Result!";
      const adminMessage =
        "Hi admin, please check the 5:15 pm automation result of order creation.";

      await notifyAdmins({
        title: adminTitle,
        message: adminMessage,
        actionUrl: "/admin/operations",
        sendEmail: true,
        emailStrategy: "shared",
        ...buildPushPayload(adminTitle, adminMessage, `order-gen-${targetDate}`),
      });

      if (result.affectedCustomerProfileIds?.length) {
        await notifyCustomersMealsOrderCreated(
          result.affectedCustomerProfileIds,
          targetDate,
        );
      }
    } catch (notifyError) {
      console.error("Order creation notification error:", notifyError);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          targetDate,
          istToday: getISTDateString(),
          inserted: result.inserted ?? 0,
          skipped: result.skipped ?? 0,
        },
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("Generate Orders Cron Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
