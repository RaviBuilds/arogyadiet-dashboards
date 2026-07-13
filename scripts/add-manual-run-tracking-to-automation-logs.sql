-- Adds separate tracking columns for admin-triggered ("manual") automation runs,
-- distinct from the existing cron-triggered run tracking (run_count, last_run_at,
-- latest_stats). This lets the dashboard show both "last cron run" and
-- "last manual run" independently for the same automation_type + target_date row.

ALTER TABLE public.automation_logs
  ADD COLUMN IF NOT EXISTS manual_run_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_manual_run_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS latest_manual_stats JSONB;

COMMENT ON COLUMN public.automation_logs.run_count IS 'Count of scheduled (cron) runs for this automation_type + target_date.';
COMMENT ON COLUMN public.automation_logs.last_run_at IS 'Timestamp of the last scheduled (cron) run.';
COMMENT ON COLUMN public.automation_logs.latest_stats IS 'Stats payload from the last scheduled (cron) run.';
COMMENT ON COLUMN public.automation_logs.manual_run_count IS 'Count of admin-triggered manual runs for this automation_type + target_date.';
COMMENT ON COLUMN public.automation_logs.last_manual_run_at IS 'Timestamp of the last admin-triggered manual run.';
COMMENT ON COLUMN public.automation_logs.latest_manual_stats IS 'Stats payload from the last admin-triggered manual run.';
