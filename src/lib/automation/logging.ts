/**
 * Shared automation_logs writer + pipeline sub-task tracker.
 *
 * TWO-PHASE MODEL
 * ---------------
 * 1. MAIN TASK: `upsertAutomationLog` records the primary outcome of an
 *    automation (e.g. order creation) and returns immediately so the cron
 *    endpoint can respond with HTTP 200. `main_status` reflects this task.
 *
 * 2. FOLLOW-UP PIPELINE: after the main task, endpoints run non-critical
 *    follow-up work (notifications, workload snapshots, dispatch) via Next's
 *    `after()`. Each step is tracked independently in the `sub_tasks` JSONB
 *    map through `initAutomationSubTasks` (marks them "pending") and
 *    `updateAutomationSubTask` (marks them "success"/"failed"). A failed
 *    follow-up NEVER downgrades the main task — the dashboard shows, e.g.,
 *    "order creation succeeded, customer notification failed".
 *
 * SOURCE SEPARATION
 * -----------------
 * Scheduled ("cron") runs write run_count / last_run_at / latest_stats /
 * main_status / sub_tasks. Admin ("manual") runs additionally write
 * manual_run_count / last_manual_run_at / latest_manual_stats /
 * manual_main_status / manual_sub_tasks — independent columns on the same
 * (automation_type, target_date) row so the dashboard can show both at once.
 *
 * RUN DATE
 * --------
 * `run_date` is the IST calendar date the automation actually executed and
 * defaults to today-IST. The dashboard groups by this (not target_date) so a
 * 5:15 PM run that generates *tomorrow's* orders still shows up on *today's*
 * automation view.
 *
 * Columns come from:
 *   - scripts/add-manual-run-tracking-to-automation-logs.sql
 *   - scripts/enhance-automation-logs-run-tracking.sql
 * All writes degrade gracefully (retry with a reduced patch) if a newer column
 * doesn't exist yet.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getISTDateString } from "@/lib/dates/ist";

export type AutomationRunSource = "cron" | "manual";
export type SubTaskStatus = "pending" | "success" | "failed" | "skipped";

export type SubTaskState = {
  status: SubTaskStatus;
  at?: string;
  error?: string;
  info?: string;
};

const UNKNOWN_COLUMN_CODE = "42703";

function isUnknownColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === UNKNOWN_COLUMN_CODE ||
    /column .* does not exist/i.test(error.message ?? "") ||
    /run_date|main_status|sub_tasks|manual_main_status|manual_sub_tasks|manual_run_count/i.test(
      error.message ?? "",
    )
  );
}

/**
 * Upserts the MAIN-task result for an automation run.
 *
 * `runDate` defaults to today-IST. `mainStatus` defaults to "success".
 * `subTasks`, when provided, seeds the follow-up pipeline step map (typically
 * as { step: { status: "pending" } }).
 */
export async function upsertAutomationLog(
  client: SupabaseClient,
  params: {
    automationType: string;
    targetDate: string;
    source: AutomationRunSource;
    stats: Record<string, unknown>;
    runDate?: string;
    mainStatus?: SubTaskStatus | "running";
    subTasks?: Record<string, SubTaskState>;
  },
): Promise<void> {
  const {
    automationType,
    targetDate,
    source,
    stats,
    runDate = getISTDateString(0),
    mainStatus = "success",
    subTasks,
  } = params;

  try {
    const { data: existing, error: existingError } = await client
      .from("automation_logs")
      .select("run_count, manual_run_count")
      .eq("automation_type", automationType)
      .eq("target_date", targetDate)
      .maybeSingle();

    if (existingError) {
      console.error(
        `[automation_logs] fetch failed for ${automationType}/${targetDate}:`,
        existingError,
      );
      return;
    }

    const prevRunCount = (existing as { run_count?: number } | null)?.run_count ?? 0;
    const prevManualCount =
      (existing as { manual_run_count?: number } | null)?.manual_run_count ?? 0;

    // Full patch (all columns). We progressively strip columns on retry if a
    // migration hasn't been applied yet.
    const patch: Record<string, unknown> = {
      automation_type: automationType,
      target_date: targetDate,
      run_date: runDate,
      run_count: prevRunCount + (source === "cron" ? 1 : 0),
      last_run_at: new Date().toISOString(),
      latest_stats: stats,
      main_status: mainStatus,
    };
    if (subTasks) patch.sub_tasks = subTasks;

    if (source === "manual") {
      patch.manual_run_count = prevManualCount + 1;
      patch.last_manual_run_at = new Date().toISOString();
      patch.latest_manual_stats = stats;
      patch.manual_main_status = mainStatus;
      if (subTasks) patch.manual_sub_tasks = subTasks;
    }

    await upsertWithColumnFallback(client, patch);
  } catch (error) {
    console.error(
      `[automation_logs] unexpected error for ${automationType}/${targetDate}:`,
      error,
    );
  }
}

/**
 * Seeds the follow-up pipeline step map with "pending" entries for the given
 * task keys. Call this right before returning HTTP 200 so the dashboard shows
 * the follow-up work as in-progress. Preserves the main-task columns.
 */
export async function initAutomationSubTasks(
  client: SupabaseClient,
  params: {
    automationType: string;
    targetDate: string;
    source: AutomationRunSource;
    taskKeys: string[];
  },
): Promise<void> {
  const { taskKeys } = params;
  const pending: Record<string, SubTaskState> = {};
  for (const key of taskKeys) pending[key] = { status: "pending" };
  await writeSubTasks(client, params, pending);
}

/**
 * Marks a single follow-up pipeline step's status, merging into the existing
 * sub-task map. Used from inside `after()` callbacks once each step settles.
 */
export async function updateAutomationSubTask(
  client: SupabaseClient,
  params: {
    automationType: string;
    targetDate: string;
    source: AutomationRunSource;
    taskKey: string;
    status: SubTaskStatus;
    error?: string;
    info?: string;
  },
): Promise<void> {
  const { taskKey, status, error, info } = params;
  const state: SubTaskState = { status };
  if (status !== "pending") state.at = new Date().toISOString();
  if (error) state.error = error.slice(0, 500);
  if (info) state.info = info.slice(0, 500);

  await writeSubTasks(client, params, { [taskKey]: state }, /* merge */ true);
}

// ─── internals ───────────────────────────────────────────────────────────────

const subTasksColumn = (source: AutomationRunSource) =>
  source === "manual" ? "manual_sub_tasks" : "sub_tasks";

/**
 * Reads (optionally) and writes the sub_tasks / manual_sub_tasks map. When
 * `merge` is true, the incoming entries are merged over the existing map;
 * otherwise the provided map replaces it.
 */
async function writeSubTasks(
  client: SupabaseClient,
  params: { automationType: string; targetDate: string; source: AutomationRunSource },
  entries: Record<string, SubTaskState>,
  merge = false,
): Promise<void> {
  const { automationType, targetDate, source } = params;
  const column = subTasksColumn(source);

  try {
    let nextMap: Record<string, SubTaskState> = entries;

    if (merge) {
      const { data: current, error: readError } = await client
        .from("automation_logs")
        .select(column)
        .eq("automation_type", automationType)
        .eq("target_date", targetDate)
        .maybeSingle();

      if (readError) {
        if (isUnknownColumnError(readError)) return; // column not migrated yet
        console.error(
          `[automation_logs] sub-task read failed for ${automationType}/${targetDate}:`,
          readError,
        );
        return;
      }

      const existingMap =
        ((current as Record<string, unknown> | null)?.[column] as
          | Record<string, SubTaskState>
          | null) ?? {};
      nextMap = { ...existingMap, ...entries };
    }

    const patch: Record<string, unknown> = {
      automation_type: automationType,
      target_date: targetDate,
      [column]: nextMap,
    };

    const { error: upsertError } = await client
      .from("automation_logs")
      .upsert(patch, { onConflict: "automation_type,target_date" });

    if (upsertError && !isUnknownColumnError(upsertError)) {
      console.error(
        `[automation_logs] sub-task write failed for ${automationType}/${targetDate}:`,
        upsertError,
      );
    }
  } catch (error) {
    console.error(
      `[automation_logs] sub-task unexpected error for ${automationType}/${targetDate}:`,
      error,
    );
  }
}

/**
 * Upserts the given patch, progressively dropping newer optional columns and
 * retrying if the database rejects an unknown column (migration not yet run).
 * Guarantees the core columns are always written.
 */
async function upsertWithColumnFallback(
  client: SupabaseClient,
  fullPatch: Record<string, unknown>,
): Promise<void> {
  // Ordered from newest/most-optional to oldest. On an unknown-column error we
  // strip the next group and retry.
  const optionalColumnGroups: string[][] = [
    ["manual_main_status", "manual_sub_tasks"],
    ["main_status", "sub_tasks"],
    ["run_date"],
    ["manual_run_count", "last_manual_run_at", "latest_manual_stats"],
  ];

  const patch = { ...fullPatch };
  let attempt = 0;

  // Try the full patch first, then strip one group per failed attempt.
  while (attempt <= optionalColumnGroups.length) {
    const { error } = await client
      .from("automation_logs")
      .upsert(patch, { onConflict: "automation_type,target_date" });

    if (!error) return;

    if (!isUnknownColumnError(error) || attempt === optionalColumnGroups.length) {
      console.error("[automation_logs] upsert failed:", error);
      return;
    }

    for (const col of optionalColumnGroups[attempt]) delete patch[col];
    attempt += 1;
  }
}
