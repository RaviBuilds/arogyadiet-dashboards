-- Category Guard Triggers for KIT Tracker
-- Requirements: 12.1, 12.2
-- Ensures kit_daily_logs rows and kit_received_date can only be written for KIT subscriptions.
-- The FOR UPDATE lock on subscriptions prevents concurrent category change + Daily_Log insert from interleaving.

-- 1. Guard for kit_daily_logs: BEFORE INSERT OR UPDATE, verify subscription is KIT
CREATE OR REPLACE FUNCTION public.kit_tracker_category_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_category TEXT;
BEGIN
  SELECT customer_category INTO v_category
    FROM public.subscriptions
   WHERE id = NEW.subscription_id
   FOR UPDATE;

  IF v_category IS DISTINCT FROM 'KIT' THEN
    RAISE EXCEPTION 'kit_daily_logs rows may only be created for KIT subscriptions (subscription % has category %)',
      NEW.subscription_id, v_category
      USING ERRCODE = '23514'; -- check_violation
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_kit_daily_logs_category_guard
  BEFORE INSERT OR UPDATE ON public.kit_daily_logs
  FOR EACH ROW EXECUTE FUNCTION public.kit_tracker_category_guard();

-- 2. Guard for kit_received_date on subscriptions: BEFORE INSERT OR UPDATE OF kit_received_date
CREATE OR REPLACE FUNCTION public.kit_received_date_category_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.kit_received_date IS NOT NULL AND NEW.customer_category IS DISTINCT FROM 'KIT' THEN
    RAISE EXCEPTION 'kit_received_date may only be set for KIT subscriptions (subscription % has category %)',
      NEW.id, NEW.customer_category
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_subscriptions_kit_received_date_guard
  BEFORE INSERT OR UPDATE OF kit_received_date ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.kit_received_date_category_guard();
