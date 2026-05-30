import { NextResponse } from "next/server";
import { generateDailyOrders } from "@/actions/system-actions/orderGeneration";
import { getISTDateString, getTomorrowISTDateString } from "@/lib/dates/ist";

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
  const expectedSecret = process.env.CRON_SECRET || "arogya-demo-123";

  if (secret !== expectedSecret) {
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
