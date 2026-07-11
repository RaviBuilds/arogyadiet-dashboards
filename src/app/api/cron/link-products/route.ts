import { NextResponse } from "next/server";
import { runProductLinkingAction } from "@/actions/admin-actions/systemActions";
import { executeAutomatedDispatch } from "@/actions/system-actions/routeEngine";
import { getISTDateString } from "@/lib/dates/ist";
import { notifyAdmins } from "@/lib/notifications";
import { persistWorkloadSnapshots } from "@/lib/clinic/workload";

/**
 * GET /api/cron/link-products?secret=<CRON_SECRET>&date=YYYY-MM-DD
 *
 * Scheduled at ~12:05 AM IST daily (via Vercel cron).
 * Links paid addon shop products to today's delivery_orders unless an explicit date is passed.
 * After successful linking, automatically triggers the dispatch/routing step.
 */


export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const today = getISTDateString(0);
    const queryDate = searchParams.get("date");
    const targetDate = queryDate || today;

    // Step 1: Link products
    const result = await runProductLinkingAction(targetDate);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 },
      );
    }

    try {
      await notifyAdmins({
        title: "Product Link Automation",
        message: `Hi Admin, we have linked ${result.count ?? 0} of the products with tomorrow's delivery.`,
        actionUrl: "/admin/operations",
        sendEmail: true,
        emailStrategy: "shared",
        skipInApp: true,
      });
    } catch (notifyError) {
      console.error("Product link notification error:", notifyError);
    }

    // Step 2: Trigger dispatch/routing after product linking completes
    let dispatchResult = null;
    try {
      dispatchResult = await executeAutomatedDispatch(targetDate);

      if (dispatchResult.error) {
        console.error("Dispatch failed after product linking:", dispatchResult.error);
      } else {
        // Persist workload snapshots after dispatch (finalized counts with products)
        try {
          await persistWorkloadSnapshots(targetDate);
        } catch (snapshotError) {
          console.error("Workload snapshot error after dispatch:", snapshotError);
        }

        try {
          const stats = dispatchResult.stats as { batchesCreated?: number; ordersAssigned?: number } | undefined;
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
      }
    } catch (dispatchError) {
      console.error("Dispatch execution error after product linking:", dispatchError);
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          targetDate: result.targetDate,
          linked: result.count,
          istToday: today,
          dispatch: dispatchResult?.error
            ? { success: false, error: dispatchResult.error }
            : { success: true, stats: dispatchResult?.stats },
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
