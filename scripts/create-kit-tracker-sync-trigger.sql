-- Migration: Create skip-count and tracker end-date sync trigger for KIT Tracker
-- Requirements: 3.2, 8.1, 8.2, 8.4, 9.1, 9.2
-- 
-- This trigger recomputes kit_total_skipped_days and kit_tracker_end_date
-- on the subscriptions table whenever a kit_daily_logs row is inserted,
-- updated, or deleted. It uses COUNT(*) rather than increment/decrement
-- to be self-healing and guarantee the count can never go negative or drift.
--
-- Runs in the same transaction as the Daily_Log write — if the trigger fails,
-- Postgres rolls back the entire statement (atomicity for Req 8.4/9.1).
-- FOR UPDATE lock on the subscriptions row prevents concurrent race conditions.

CREATE OR REPLACE FUNCTION public.kit_tracker_sync_skip_count()
RETURNS TRIGGER AS $$
DECLARE
  v_subscription_id UUID := COALESCE(NEW.subscription_id, OLD.subscription_id);
  v_skipped_count INTEGER;
  v_received_date DATE;
  v_duration_days INTEGER;
BEGIN
  -- Recompute total skipped days by counting FOOD_SKIPPED rows
  SELECT COUNT(*) INTO v_skipped_count
    FROM public.kit_daily_logs
   WHERE subscription_id = v_subscription_id AND status = 'FOOD_SKIPPED';

  -- Lock the subscription row and fetch needed values
  SELECT kit_received_date, kit_duration_days INTO v_received_date, v_duration_days
    FROM public.subscriptions
   WHERE id = v_subscription_id
   FOR UPDATE;

  -- Update denormalized fields on the subscription
  UPDATE public.subscriptions
     SET kit_total_skipped_days = v_skipped_count,
         kit_tracker_end_date = CASE
           WHEN v_received_date IS NULL THEN NULL
           ELSE v_received_date + (v_duration_days - 1) + v_skipped_count
         END
   WHERE id = v_subscription_id;

  RETURN NULL; -- AFTER trigger, return value ignored
END;
$$ LANGUAGE plpgsql;

-- Trigger fires after any change to kit_daily_logs rows
CREATE TRIGGER trg_kit_daily_logs_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.kit_daily_logs
  FOR EACH ROW EXECUTE FUNCTION public.kit_tracker_sync_skip_count();
