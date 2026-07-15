-- ============================================================================
-- Enhance automation_logs for run-date visibility + pipeline sub-task tracking.
--
-- WHY:
--   1. The Automation Logs dashboard previously filtered by `target_date`
--      (the delivery date an automation runs *for*). Because ORDER_GEN runs the
--      evening BEFORE its delivery date, its scheduled run never appeared on the
--      day it actually ran — making it look like the 5:15 PM cron "didn't run".
--      We now also track `run_date` (the IST calendar date the automation
--      actually executed) and the dashboard groups by that instead.
--
--   2. Each automation now returns HTTP 200 as soon as its MAIN task completes
--      (e.g. order creation) and runs follow-up work (notifications, dispatch)
--      as a separate pipeline. We record each follow-up step's status so the UI
--      can show e.g. "order creation succeeded, customer notification failed"
--      independently.
--
-- All columns are additive and IF NOT EXISTS — safe to re-run.
-- ============================================================================

ALTER TABLE public.automation_logs
  -- IST calendar date the automation actually executed (YYYY-MM-DD).
  ADD COLUMN IF NOT EXISTS run_date DATE,
  -- Status of the MAIN task for the scheduled (cron) run.
  ADD COLUMN IF NOT EXISTS main_status TEXT DEFAULT 'success',
  -- Per-step status map for follow-up pipeline tasks of the cron run, e.g.
  -- { "notify_admins": { "status": "success", "at": "..." },
  --   "notify_customers": { "status": "failed", "at": "...", "error": "..." } }
  ADD COLUMN IF NOT EXISTS sub_tasks JSONB DEFAULT '{}'::jsonb,
  -- Same as above, but for admin-triggered manual runs.
  ADD COLUMN IF NOT EXISTS manual_main_status TEXT,
  ADD COLUMN IF NOT EXISTS manual_sub_tasks JSONB;

COMMENT ON COLUMN public.automation_logs.run_date IS
  'IST calendar date the automation actually executed. Dashboard groups by this. For ORDER_GEN this is target_date - 1 (runs the evening before delivery).';
COMMENT ON COLUMN public.automation_logs.main_status IS
  'Status of the main task for the last scheduled (cron) run: success | failed | running.';
COMMENT ON COLUMN public.automation_logs.sub_tasks IS
  'Per-step status map for follow-up pipeline tasks of the last cron run (notifications, snapshots, dispatch).';
COMMENT ON COLUMN public.automation_logs.manual_main_status IS
  'Status of the main task for the last admin-triggered manual run.';
COMMENT ON COLUMN public.automation_logs.manual_sub_tasks IS
  'Per-step status map for follow-up pipeline tasks of the last manual run.';

-- Backfill run_date from the ACTUAL run timestamp (IST calendar date), which is
-- the true "day it ran". This is more accurate than deriving from target_date:
-- e.g. product linking for tomorrow's delivery runs late tonight, so its run
-- day is today — not the delivery date. Falls back to a target-date heuristic
-- only when no timestamp exists (should not happen — upsert always sets one).
--
-- Idempotent: recomputes every row from its timestamps, so it is safe to re-run
-- even after an earlier target-date-based backfill.
UPDATE public.automation_logs
SET run_date = COALESCE(
  (COALESCE(last_run_at, last_manual_run_at) AT TIME ZONE 'Asia/Kolkata')::date,
  CASE
    WHEN automation_type = 'ORDER_GEN' THEN target_date - INTERVAL '1 day'
    ELSE target_date
  END
)
WHERE COALESCE(last_run_at, last_manual_run_at) IS NOT NULL
   OR run_date IS NULL;

-- Backfill main_status from prior run activity (all historical rows that ran
-- are treated as succeeded since only successful runs were logged).
UPDATE public.automation_logs
SET main_status = 'success'
WHERE main_status IS NULL AND run_count > 0;

-- Index to support the day-wise dashboard query (filter by run_date).
CREATE INDEX IF NOT EXISTS idx_automation_logs_run_date
  ON public.automation_logs (run_date);

-- ============================================================================
-- Verification:
--   SELECT automation_type, target_date, run_date, main_status, sub_tasks
--   FROM automation_logs ORDER BY run_date DESC, automation_type LIMIT 20;
-- ============================================================================
