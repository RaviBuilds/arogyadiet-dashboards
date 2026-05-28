import { NextResponse } from "next/server";
import { runProductLinkingAction } from "@/actions/admin-actions/systemActions";
import { getISTDateString } from "@/lib/dates/ist";

/**
 * GET /api/cron/link-products?secret=<CRON_SECRET>&date=YYYY-MM-DD
 *
 * Scheduled at ~12:05 AM IST daily (via external cron / Supabase pg_cron).
 * Links paid addon shop products to today's delivery_orders unless an explicit date is passed.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET || "arogya-demo-123";

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const today = getISTDateString(0);
    const queryDate = searchParams.get("date");
    const targetDate = queryDate || today;

    const result = await runProductLinkingAction(targetDate);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 },
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          targetDate: result.targetDate,
          linked: result.count,
          istToday: today,
        },
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("Link Products Cron Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
