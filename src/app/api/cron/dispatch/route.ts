import { NextResponse } from "next/server";
import { executeAutomatedDispatch } from "@/actions/system-actions/routeEngine";
import { getISTDateString } from "@/lib/dates/ist";

/**
 * GET /api/cron/dispatch?secret=<CRON_SECRET>&date=YYYY-MM-DD
 *
 * Scheduled at ~12:10 AM IST daily (via external cron / Supabase pg_cron).
 * Assigns riders and creates batches for today's delivery_date unless an explicit date is passed.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET || "arogya-demo-123";

  if (secret !== expectedSecret) {
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

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error: unknown) {
    console.error("Cron Dispatch Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
