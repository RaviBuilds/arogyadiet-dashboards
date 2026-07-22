import { NextResponse, after } from "next/server";
import { runProductLinkingAction } from "@/actions/admin-actions/systemActions";
import { executeAutomatedDispatch } from "@/actions/system-actions/routeEngine";
import { getISTDateString } from "@/lib/dates/ist";
import { notifyAdmins } from "@/lib/notifications";
import { persistWorkloadSnapshots } from "@/lib/clinic/workload";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  initAutomationSubTasks,
  updateAutomationSubTask,
} from "@/lib/automation/logging";

// Dispatch/routing + notifications run after the response — give them time.
export const maxDuration = 60;

const AUTOMATION_TYPE = "PRODUCT_LINK";

type DispatchResult = {
  error?: string;
  success?: boolean;
  message?: string;
  stats?: { batchesCreated?: number; ordersAssigned?: number };
};

/**
 * GET /api/cron/link-products?secret=<CRON_SECRET>&date=YYYY-MM-DD
 *
 * Scheduled at ~12:05 AM IST daily.
 *
 * MAIN TASK  : link paid addon shop products to today's delivery_orders.
 *              Returns HTTP 200 as soon as linking succeeds.
 * FOLLOW-UPS : admin notification, then the dispatch/routing step (which logs
 *              its own ROUTING automation entry), workload snapshots, and the
 *              dispatch notification — all run AFTER the response via `after()`
 *              and are tracked as independent sub-tasks.
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

    // ── MAIN TASK: link products ──────────────────────────────────────────────
    const result = await runProductLinkingAction(targetDate);

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 },
      );
    }

    const admin = createAdminClient();
    await initAutomationSubTasks(admin, {
      automationType: AUTOMATION_TYPE,
      targetDate,
      source: "cron",
      taskKeys: ["notify_link", "dispatch_routing", "workload_snapshot", "notify_dispatch"],
    });

    // ── FOLLOW-UP PIPELINE (runs after the 200 response) ──────────────────────
    after(async () => {
      const client = createAdminClient();

      await runSubTask(client, targetDate, "notify_link", async () => {
        await notifyAdmins({
          title: "Product Link Automation",
          message: `Hi Admin, we have linked ${result.count ?? 0} of the products with tomorrow's delivery.`,
          actionUrl: "/admin/operations",
          sendEmail: true,
          emailStrategy: "shared",
          skipInApp: true,
        });
        return { info: `${result.count ?? 0} linked` };
      });

      // Dispatch/routing is a distinct automation and logs its own ROUTING row;
      // here we only track a pointer to its success/failure.
      const dispatchResult = await runSubTask(
        client,
        targetDate,
        "dispatch_routing",
        async () => {
          const dispatch = (await executeAutomatedDispatch(targetDate)) as DispatchResult;
          if (dispatch.error) {
            throw new Error(dispatch.error);
          }
          const stats = dispatch.stats;
          return {
            value: dispatch,
            info: `${stats?.batchesCreated ?? 0} batches, ${stats?.ordersAssigned ?? 0} orders`,
          };
        },
      );

      // Refresh workload snapshots after ALL linking for the date completes
      // (including roll-forward links performed inside runProductLinkingAction),
      // so kitchen shop-product counts always reflect the linked products
      // (Defect #5). This runs regardless of whether dispatch succeeded, since
      // the counts are derived from the linking result (addon_orders.
      // delivery_order_id) and not from dispatch; gating it on dispatch success
      // would leave counts stale/undercounted whenever dispatch fails.
      await runSubTask(client, targetDate, "workload_snapshot", async () => {
        const snapshot = await persistWorkloadSnapshots(targetDate);
        return { info: `${snapshot.clinicsProcessed} clinics` };
      });

      if (!dispatchResult.ok) return;

      await runSubTask(client, targetDate, "notify_dispatch", async () => {
        const stats = dispatchResult.value?.stats ?? {};
        await notifyAdmins({
          title: "Dispatch Automation",
          message: `Hi Admin, we have created ${stats.batchesCreated ?? 0} batches and assigned ${stats.ordersAssigned ?? 0} orders for today's delivery.`,
          actionUrl: "/admin/operations",
          sendEmail: true,
          emailStrategy: "shared",
          skipInApp: true,
        });
      });
    });

    // ── RESPONSE (main task status) ───────────────────────────────────────────
    return NextResponse.json(
      {
        success: true,
        data: {
          targetDate: result.targetDate,
          linked: result.count,
          istToday: today,
          followUp: "scheduled",
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

type SubTaskOutcome<T> = { value?: T; status?: "success" | "skipped"; info?: string } | void;

/**
 * Runs a follow-up step and records its status as a sub-task without throwing.
 * Returns `{ ok, value }` so dependent steps (e.g. notify after dispatch) can
 * decide whether to proceed.
 */
async function runSubTask<T = unknown>(
  client: ReturnType<typeof createAdminClient>,
  targetDate: string,
  taskKey: string,
  fn: () => Promise<SubTaskOutcome<T>>,
): Promise<{ ok: boolean; value?: T }> {
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
    return { ok: true, value: outcome.value };
  } catch (error) {
    console.error(`[link-products] follow-up "${taskKey}" failed:`, error);
    await updateAutomationSubTask(client, {
      automationType: AUTOMATION_TYPE,
      targetDate,
      source: "cron",
      taskKey,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false };
  }
}
