import { NextResponse } from "next/server";
import { executeAutomatedDispatch } from "@/actions/system-actions/routeEngine";
import { getISTDateString } from "@/lib/dates/ist";
import { notifyAdmins } from "@/lib/notifications";

/**
 * GET /api/cron/dispatch?secret=<CRON_SECRET>&date=YYYY-MM-DD
 *
 * Scheduled at ~12:10 AM IST daily (via external cron / Supabase pg_cron).
 * Assigns riders and creates batches for today's delivery_date unless an explicit date is passed.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const queryDate = searchParams.get("date");
    const targetDate = queryDate || getISTDateString(0);

    const result = await executeAutomatedDispatch(targetDate);

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 },
      );
    }

    try {
      const stats = result.stats as { batchesCreated?: number; ordersAssigned?: number } | undefined;
      const batchesCreated = stats?.batchesCreated ?? 0;
      const ordersAssigned = stats?.ordersAssigned ?? 0;
      await notifyAdmins({
        title: "Dispatch Automation",
        message: `Hi Admin, we have created ${batchesCreated} batches and assigned ${ordersAssigned} orders for today's delivery.`,
        actionUrl: "/admin/operations",
        sendEmail: true,
        emailStrategy: "shared",
        skipInApp: true,
      });
    } catch (notifyError) {
      console.error("Dispatch notification error:", notifyError);
    }

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error: unknown) {
    console.error("Cron Dispatch Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
