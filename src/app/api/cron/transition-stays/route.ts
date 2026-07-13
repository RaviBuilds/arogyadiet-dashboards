import { NextResponse } from "next/server";
import { runStayTransitions } from "@/services/FallbackAutomationService";

/**
 * GET /api/cron/transition-stays?secret=<CRON_SECRET>
 *
 * Scheduled daily via Supabase pg_cron.
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
    const { activated, finished } = await runStayTransitions("cron");

    return NextResponse.json(
      {
        success: true,
        data: {
          currentDate: new Date().toISOString().split("T")[0],
          activated,
          finished,
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Transition Stays Cron Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
