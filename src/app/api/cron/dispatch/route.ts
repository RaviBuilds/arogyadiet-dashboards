import { NextResponse } from "next/server";
import { executeAutomatedDispatch } from "@/actions/system-actions/routeEngine";
import { format, addDays } from "date-fns";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 1. Basic Security Check
  // In production, set CRON_SECRET in your .env file
  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET || "arogya-demo-123";

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 2. Determine the date. If passing ?date=2026-05-06, use it.
    // Otherwise, default to tomorrow (since routing at 5:15 PM is usually for the next morning).
    // Note: If your demo test orders are for "today", just pass ?date=YYYY-MM-DD in the URL!
    const queryDate = searchParams.get("date");
    const targetDate =
      queryDate || format(addDays(new Date(), 1), "yyyy-MM-dd");

    // 3. Execute the Routing Engine
    const result = await executeAutomatedDispatch(targetDate);

    if (result.error) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error: any) {
    console.error("Cron Dispatch Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
