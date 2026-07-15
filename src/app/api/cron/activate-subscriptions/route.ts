import { NextResponse, after } from "next/server";
import {
  runSubscriptionActivation,
  notifyActivatedSubscriptions,
  notifyExpiredSubscriptions,
} from "@/services/FallbackAutomationService";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  initAutomationSubTasks,
  updateAutomationSubTask,
} from "@/lib/automation/logging";

// Customer/admin notifications run after the response — give them room.
export const maxDuration = 60;

const AUTOMATION_TYPE = "SUB_ACTIVATE";

/**
 * GET /api/cron/activate-subscriptions?secret=<CRON_SECRET>
 *
 * Runs at ~2:00 PM IST, BEFORE the 5:15 PM order generation.
 *
 * MAIN TASK  : activate PENDING subscriptions starting tomorrow + expire ACTIVE
 *              subscriptions past their end date, then log SUB_ACTIVATE.
 *              Returns HTTP 200 as soon as this completes.
 * FOLLOW-UPS : customer/admin notifications run AFTER the response via
 *              `after()`, tracked as sub-tasks. Previously these ran inline and
 *              caused the cron's 5s pg_net call to time out before the log was
 *              ever written — which is why SUB_ACTIVATE had no logs.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get("secret");
  const expectedSecret = process.env.CRON_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // ── MAIN TASK (mutations + log) ───────────────────────────────────────────
    const summary = await runSubscriptionActivation("cron");
    const targetDate = summary.today;

    // ── FOLLOW-UP PIPELINE ────────────────────────────────────────────────────
    if (summary.activatedSubs.length || summary.stoppedSubs.length) {
      const admin = createAdminClient();
      await initAutomationSubTasks(admin, {
        automationType: AUTOMATION_TYPE,
        targetDate,
        source: "cron",
        taskKeys: ["notify_activated", "notify_expired"],
      });

      after(async () => {
        const client = createAdminClient();

        await runSubTask(client, targetDate, "notify_activated", async () => {
          if (!summary.activatedSubs.length) return { status: "skipped", info: "none" };
          await notifyActivatedSubscriptions(summary.activatedSubs);
          return { info: `${summary.activatedSubs.length} customers` };
        });

        await runSubTask(client, targetDate, "notify_expired", async () => {
          if (!summary.stoppedSubs.length) return { status: "skipped", info: "none" };
          await notifyExpiredSubscriptions(summary.stoppedSubs);
          return { info: `${summary.stoppedSubs.length} customers` };
        });
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          today: summary.today,
          tomorrow: summary.tomorrow,
          activated: summary.activated,
          stopped: summary.stopped,
          followUp:
            summary.activatedSubs.length || summary.stoppedSubs.length
              ? "scheduled"
              : "none",
        },
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("Activate Subscriptions Cron Error:", error);
    return NextResponse.json(
      { success: false, error: error?.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}

/** Runs a follow-up step and records its status as a sub-task without throwing. */
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
    console.error(`[activate-subscriptions] follow-up "${taskKey}" failed:`, error);
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
