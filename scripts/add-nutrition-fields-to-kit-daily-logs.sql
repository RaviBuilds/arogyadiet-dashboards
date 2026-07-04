-- Migration: Add nutrition tracking fields to kit_daily_logs
-- These fields capture daily food/drink intake details when customer marks "Food Taken"

ALTER TABLE kit_daily_logs
  ADD COLUMN IF NOT EXISTS fat_consumption text,
  ADD COLUMN IF NOT EXISTS water_intake_liters numeric(4,2),
  ADD COLUMN IF NOT EXISTS buttermilk_intake text,
  ADD COLUMN IF NOT EXISTS soup_name_qty text,
  ADD COLUMN IF NOT EXISTS protein_curry text,
  ADD COLUMN IF NOT EXISTS main_dish text,
  ADD COLUMN IF NOT EXISTS veg_curry text,
  ADD COLUMN IF NOT EXISTS eggs_count integer,
  ADD COLUMN IF NOT EXISTS salads_qty text,
  ADD COLUMN IF NOT EXISTS step_count integer;
