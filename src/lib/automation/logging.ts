/**
 * Shared automation_logs writer.
 *
 * Separates "cron" (scheduled, Supabase pg_cron triggered) runs from "manual"
 * (admin-triggered via the Operations UI) runs for the same
 * (automation_type, target_date) row. Cron runs increment run_count /
 * last_run_at / latest_stats. Manual runs increment manual_run_count /
 * last_manual_run_at / latest_manual_stats — independent counters on the
 * same row so the dashboard can show both at once.
 *
 * Requires the `manual_run_count`, `last_manual_run_at`, `latest_manual_stats`
 * columns (see scripts/add-manual-run-tracking-to-automation-logs.sql).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type AutomationRunSource = "cron" | "manual";

export async function upsertAutomationLog(
  client: SupabaseClient,
  params: {
    automationType: string;
    targetDate: string;
    source: AutomationRunSource;
    stats: Record<string, unknown>;
  },
): Promise<void> {
  const { automationType, targetDate, source, stats } = params;

  try {
    const { data: existing, error: existingError } = await client
      .from("automation_logs")
      .select("run_count")
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

    // Always write to the standard cron columns for backward compatibility.
    // The manual_run_count columns are additive — if they don't exist yet
    // (migration not yet run), the upsert on just the core columns still works.
    const patch: Record<string, unknown> = {
      automation_type: automationType,
      target_date: targetDate,
      run_count: ((existing as any)?.run_count ?? 0) + (source === "cron" ? 1 : 0),
      last_run_at: new Date().toISOString(),
      latest_stats: stats,
    };

    // Attempt to write manual columns if source is "manual".
    // If columns don't exist yet, this write will gracefully fail and we fall
    // back to just writing to the standard columns.
    if (source === "manual") {
      try {
        const { data: existingManual } = await client
          .from("automation_logs")
          .select("manual_run_count")
          .eq("automation_type", automationType)
          .eq("target_date", targetDate)
          .maybeSingle();

        patch.manual_run_count = ((existingManual as any)?.manual_run_count ?? 0) + 1;
        patch.last_manual_run_at = new Date().toISOString();
        patch.latest_manual_stats = stats;
      } catch {
        // manual_run_count column doesn't exist yet — skip manual columns
      }
    }

    const { error: upsertError } = await client
      .from("automation_logs")
      .upsert(patch, { onConflict: "automation_type,target_date" });

    if (upsertError) {
      // If it failed due to unknown column, retry with only core columns
      if (upsertError.message?.includes("manual_run_count") || upsertError.code === "42703") {
        const corePatch = {
          automation_type: automationType,
          target_date: targetDate,
          run_count: ((existing as any)?.run_count ?? 0) + 1,
          last_run_at: new Date().toISOString(),
          latest_stats: stats,
        };
        await client
          .from("automation_logs")
          .upsert(corePatch, { onConflict: "automation_type,target_date" });
      } else {
        console.error(
          `[automation_logs] upsert failed for ${automationType}/${targetDate}:`,
          upsertError,
        );
      }
    }
  } catch (error) {
    console.error(
      `[automation_logs] unexpected error for ${automationType}/${targetDate}:`,
      error,
    );
  }
}
