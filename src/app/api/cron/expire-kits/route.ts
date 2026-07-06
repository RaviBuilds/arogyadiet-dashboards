import { NextResponse } from "next/server";
import { expireEligibleKits } from "@/services/KitLifecycleService";

/**
 * GET /api/cron/expire-kits?secret=<CRON_SECRET>
 *
 * Scheduled daily at ~18:00 UTC (approximately 23:30 IST) via Vercel cron.
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
    const result = await expireEligibleKits();

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, expired: result.expired },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("Expire KITs Cron Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 }
    );
  }
}
