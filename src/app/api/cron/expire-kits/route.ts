import { NextResponse } from "next/server";
import { runKitExpiration } from "@/services/FallbackAutomationService";

/**
 * GET /api/cron/expire-kits?secret=<CRON_SECRET>
 *
 * Scheduled daily at ~18:00 UTC (approximately 23:30 IST) via Supabase pg_cron.
 * Identifies all ACTIVE KIT subscriptions past their tracker_end_date
 * and transitions them to EXPIRED atomically.
 *
 * Requirements: 1.1, 1.4, 1.5, 1.6, 1.8
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await runKitExpiration("cron");
    return NextResponse.json({ success: true, expired: result.expired }, { status: 200 });
  } catch (error: any) {
    console.error("Expire KITs Cron Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
