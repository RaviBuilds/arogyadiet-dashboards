import { NextResponse } from "next/server";
import { getISTDateString } from "@/lib/dates/ist";
import { transitionStays } from "@/services/AccommodationService";

/**
 * GET /api/cron/transition-stays?secret=<CRON_SECRET>
 *
 * Scheduled daily (via Vercel cron).
 * Transitions stay statuses:
 * - PENDING → ACTIVE for stays whose date range includes today
 * - ACTIVE → FINISHED for stays past their end date
 *
 * Requirements: 4.2, 4.3, 4.7
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const currentDate = getISTDateString(0);

    const { activated, finished } = await transitionStays(currentDate);

    return NextResponse.json(
      {
        success: true,
        data: {
          currentDate,
          activated,
          finished,
        },
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("Transition Stays Cron Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
