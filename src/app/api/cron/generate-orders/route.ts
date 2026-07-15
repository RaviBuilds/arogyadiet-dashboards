import { NextResponse, after } from "next/server";
import { generateDailyOrders } from "@/actions/system-actions/orderGeneration";
import { getISTDateString, getTomorrowISTDateString } from "@/lib/dates/ist";
import { buildPushPayload, notifyAdmins } from "@/lib/notifications";
import { notifyCustomersMealsOrderCreated } from "@/lib/notifications/orderNotifications";
import { persistWorkloadSnapshots } from "@/lib/clinic/workload";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  initAutomationSubTasks,
  updateAutomationSubTask,
} from "@/lib/automation/logging";

// Allow the follow-up pipeline (snapshots + notifications) time to finish
// after the response is sent.
export const maxDuration = 60;

const AUTOMATION_TYPE = "ORDER_GEN";

/**
 * GET /api/cron/generate-orders?secret=<CRON_SECRET>&date=YYYY-MM-DD
 *
 * Scheduled at ~5:15 PM IST daily (via Supabase pg_cron).
 * Generates delivery_orders for tomorrow unless an explicit date is passed.
 *
 * MAIN TASK  : order creation. Returns HTTP 200 as soon as this succeeds — this
 *              is the authoritative status of the automation.
 * FOLLOW-UPS : workload snapshots + admin/customer notifications run AFTER the
 *              response via `after()`. Each is tracked as an independent
 *              sub-task; a failure there never fails order creation.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
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

    // ── MAIN TASK ────────────────────────────────────────────────────────────
    const result = await generateDailyOrders(targetDate);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 500 },
      );
    }

    // Seed follow-up steps as "pending" so the dashboard shows them in-progress.
    const admin = createAdminClient();
    await initAutomationSubTasks(admin, {
      automationType: AUTOMATION_TYPE,
      targetDate,
      source: "cron",
      taskKeys: ["workload_snapshot", "notify_admins", "notify_customers"],
    });

    // ── FOLLOW-UP PIPELINE (runs after the 200 response) ──────────────────────
    after(async () => {
      const client = createAdminClient();

      await runSubTask(client, targetDate, "workload_snapshot", async () => {
        const snapshot = await persistWorkloadSnapshots(targetDate);
        return snapshot.errors.length
          ? { info: `${snapshot.clinicsProcessed} clinics, ${snapshot.errors.length} errors` }
          : { info: `${snapshot.clinicsProcessed} clinics` };
      });

      await runSubTask(client, targetDate, "notify_admins", async () => {
        const adminTitle = "Order Creation Automation Result!";
        const adminMessage =
          "Hi admin, please check the 5:15 pm automation result of order creation.";
        await notifyAdmins({
          title: adminTitle,
          message: adminMessage,
          actionUrl: "/admin/operations",
          sendEmail: true,
          emailStrategy: "shared",
          ...buildPushPayload(adminTitle, adminMessage, `order-gen-${targetDate}`),
        });
      });

      await runSubTask(client, targetDate, "notify_customers", async () => {
        const ids = result.affectedCustomerProfileIds ?? [];
        if (!ids.length) return { status: "skipped", info: "No affected customers" };
        await notifyCustomersMealsOrderCreated(ids, targetDate);
        return { info: `${ids.length} customers` };
      });
    });

    // ── RESPONSE (main task status) ───────────────────────────────────────────
    return NextResponse.json(
      {
        success: true,
        data: {
          targetDate,
          istToday: getISTDateString(),
          inserted: result.inserted ?? 0,
          skipped: result.skipped ?? 0,
          followUp: "scheduled",
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

/**
 * Runs a single follow-up step and records its outcome as a sub-task, without
 * ever throwing (a failed follow-up must not affect the main task result).
 * The step may return `{ status: "skipped", info }` to record a no-op.
 */
async function runSubTask(
  client: ReturnType<typeof createAdminClient>,
  targetDate: string,
  taskKey: string,
  fn: () => Promise<{ status?: "success" | "skipped"; info?: string } | void>,
): Promise<void> {
  try {
    const outcome = (await fn()) || {};
    await updateAutomationSubTask(client, {
      automationType: AUTOMATION_TYPE,
      targetDate,
      source: "cron",
      taskKey,
      status: outcome.status ?? "success",
      info: outcome.info,
    });
  } catch (error) {
    console.error(`[generate-orders] follow-up "${taskKey}" failed:`, error);
    await updateAutomationSubTask(client, {
      automationType: AUTOMATION_TYPE,
      targetDate,
      source: "cron",
      taskKey,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
