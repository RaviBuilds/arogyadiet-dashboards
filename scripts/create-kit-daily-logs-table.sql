-- Migration: Create kit_daily_logs table
-- Feature: KIT Tracker
-- Requirements: 11.1, 11.3, 11.4, 6.1, 6.2

CREATE TABLE public.kit_daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('FOOD_TAKEN', 'FOOD_SKIPPED')),
  physical_activity_minutes INTEGER CHECK (physical_activity_minutes IS NULL OR (physical_activity_minutes BETWEEN 0 AND 1440)),
  physical_activity_name TEXT CHECK (physical_activity_name IS NULL OR char_length(physical_activity_name) <= 100),
  weight_kg NUMERIC(5, 2) CHECK (weight_kg IS NULL OR (weight_kg >= 0 AND weight_kg <= 500)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Req 11.4 / 11.3: exactly one Daily_Log per subscription per calendar date
  CONSTRAINT uq_kit_daily_log_subscription_date UNIQUE (subscription_id, log_date),

  -- Req 6.1/6.2/6.4: Food_Skipped rows must never carry activity/weight data
  CONSTRAINT chk_skipped_has_no_optional_fields CHECK (
    status = 'FOOD_TAKEN' OR
    (physical_activity_minutes IS NULL AND physical_activity_name IS NULL AND weight_kg IS NULL)
  )
);

CREATE INDEX idx_kit_daily_logs_subscription ON public.kit_daily_logs(subscription_id);
CREATE INDEX idx_kit_daily_logs_subscription_date ON public.kit_daily_logs(subscription_id, log_date);
