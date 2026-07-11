import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAutoOffDutySweep } from "@/lib/delivery/auto-off-duty-sweep";
import { propagateOffDuty } from "@/lib/delivery/duty-lifecycle";

/**
 * GET /api/cron/auto-off-duty?secret=<CRON_SECRET>
 *
 * Scheduled every 5 minutes via Vercel cron.
 * Detects riders whose deliveries have finished (past grace period)
 * and flips them Off Duty, then propagates the off-duty signal.
 *
 * Requirements: 10.1, 10.3, 10.7, 10.8, 14.7
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET;

  // Req 10.3: Unauthorized if secret does not match — no writes performed
  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const adminClient = createAdminClient();

    // Run the sweep: detect eligible riders and flip is_online=false
    const sweepResult = await runAutoOffDutySweep(adminClient);

    // Req 10.8: Propagate off-duty per flipped rider.
    // If propagation fails, log the error but retain is_online=false.
    const propagationErrors: { riderId: string; error: string }[] = [];

    for (const riderId of sweepResult.flipped) {
      try {
        await propagateOffDuty(riderId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(
          `[auto-off-duty] propagation failed for rider ${riderId}:`,
          message,
        );
        propagationErrors.push({ riderId, error: message });
      }
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          flippedCount: sweepResult.flipped.length,
          flipped: sweepResult.flipped,
          skippedCount: sweepResult.skipped.length,
          errors: sweepResult.errors,
          propagationErrors,
        },
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    console.error("[auto-off-duty] Cron Error:", error);
    return NextResponse.json(
      { success: false, error: "Internal Server Error" },
      { status: 500 },
    );
  }
}
