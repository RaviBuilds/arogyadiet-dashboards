-- Plan-keyed flat discounts (replaces hardcoded 30/60/90 day columns for new coupons)
ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS flat_discounts_by_plan jsonb NOT NULL DEFAULT '{}';

-- Backfill legacy columns into JSONB using subscription_plans.duration_days
UPDATE public.coupons c
SET flat_discounts_by_plan = (
  SELECT COALESCE(jsonb_object_agg(sp.id::text, v.discount), '{}'::jsonb)
  FROM public.subscription_plans sp
  CROSS JOIN LATERAL (
    SELECT CASE sp.duration_days
      WHEN 30 THEN COALESCE(c.discount_value_30_days, 0)
      WHEN 60 THEN COALESCE(c.discount_value_60_days, 0)
      WHEN 90 THEN COALESCE(c.discount_value_90_days, 0)
      ELSE 0
    END AS discount
  ) v
  WHERE v.discount > 0
)
WHERE flat_discounts_by_plan = '{}'::jsonb;
