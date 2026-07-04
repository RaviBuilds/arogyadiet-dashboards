-- Migration: Create received_date lock trigger for KIT Tracker
-- Requirements: 2.7, 2.8
-- Once any kit_daily_logs row exists for a subscription, kit_received_date becomes immutable.

CREATE OR REPLACE FUNCTION public.kit_received_date_lock_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.kit_received_date IS NOT NULL AND NEW.kit_received_date IS DISTINCT FROM OLD.kit_received_date THEN
    IF EXISTS (SELECT 1 FROM public.kit_daily_logs WHERE subscription_id = NEW.id) THEN
      RAISE EXCEPTION 'kit_received_date is locked once a Daily_Log exists for subscription %', NEW.id
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_subscriptions_kit_received_date_lock
  BEFORE UPDATE OF kit_received_date ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.kit_received_date_lock_guard();
