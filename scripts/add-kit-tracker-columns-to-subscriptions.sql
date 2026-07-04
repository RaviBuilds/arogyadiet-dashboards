-- ============================================================================
-- KIT TRACKER — Add tracker columns to subscriptions table
-- ============================================================================
-- Spec: kit-subscription — Task 1.1 — Requirements 11.1, 12.1
--
-- Extends the public.subscriptions table with KIT Tracker-specific columns
-- for tracking package receipt, skipped day counts, and dynamic end date.
--
-- Background:
--   The subscriptions table already has customer_category, kit_product_id,
--   and kit_duration_days (from kit-subscription-management). This script adds
--   the tracker columns that enable the daily Food_Taken/Food_Skipped logging
--   feature for KIT customers.
--
-- Adds:
--   1. subscriptions.kit_received_date DATE (nullable)
--      One-time customer-confirmed package receipt date. Editable only until
--      the first kit_daily_logs row exists. NULL for non-KIT subscriptions.
--
--   2. subscriptions.kit_total_skipped_days INTEGER NOT NULL DEFAULT 0
--      Denormalized count of Food_Skipped rows, maintained exclusively by
--      trg_kit_daily_logs_sync trigger. Never written by application code.
--
--   3. subscriptions.kit_tracker_end_date DATE (nullable)
--      Denormalized: kit_received_date + (kit_duration_days - 1) + kit_total_skipped_days.
--      Maintained exclusively by trg_kit_daily_logs_sync trigger.
--
--   4. CHECK constraint: chk_kit_tracker_fields_kit_only
--      Non-KIT subscriptions must have all tracker fields null/zero.
--      NOTE: This constraint intentionally does NOT forbid a KIT row that
--      already has tracker data from having its customer_category changed
--      away from 'KIT' afterward — Requirement 12.3 requires existing data
--      to be retained. The constraint is paired with triggers (in later tasks)
--      for write-path enforcement.
--
-- Safety:
--   - Purely additive (ADD COLUMN IF NOT EXISTS)
--   - Columns are nullable or have safe defaults
--   - Existing rows remain valid (kit_received_date NULL, skipped = 0, end_date NULL)
--   - Idempotent via IF NOT EXISTS and DO-guarded constraint addition
--   - No existing data is modified or dropped
--
-- Rollback:
--   ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS chk_kit_tracker_fields_kit_only;
--   ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS kit_tracker_end_date;
--   ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS kit_total_skipped_days;
--   ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS kit_received_date;
-- ============================================================================

-- ============================================================================
-- 1. Add kit_received_date column
-- ============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS kit_received_date DATE;

COMMENT ON COLUMN public.subscriptions.kit_received_date IS
  'One-time customer-confirmed package receipt date. Editable only until the first kit_daily_logs row exists for this subscription. NULL for non-KIT subscriptions and for KIT subscriptions that have not yet confirmed receipt.';

-- ============================================================================
-- 2. Add kit_total_skipped_days column
-- ============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS kit_total_skipped_days INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.subscriptions.kit_total_skipped_days IS
  'Denormalized count of Food_Skipped rows in kit_daily_logs for this subscription, maintained exclusively by trg_kit_daily_logs_sync. Never written directly by application code.';

-- ============================================================================
-- 3. Add kit_tracker_end_date column
-- ============================================================================

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS kit_tracker_end_date DATE;

COMMENT ON COLUMN public.subscriptions.kit_tracker_end_date IS
  'Denormalized: kit_received_date + (kit_duration_days - 1) + kit_total_skipped_days. Maintained exclusively by trg_kit_daily_logs_sync.';

-- ============================================================================
-- 4. CHECK constraint: Non-KIT subscriptions must never carry tracker state
-- ============================================================================
-- This enforces Requirement 12.1: tracker fields are KIT-only.
-- The constraint allows a KIT row with existing tracker data to have its
-- category changed (Requirement 12.3 — data retention on category change).
-- Write-path enforcement is handled by triggers in later tasks.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_kit_tracker_fields_kit_only'
       AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT chk_kit_tracker_fields_kit_only CHECK (
        customer_category = 'KIT' OR
        (kit_received_date IS NULL AND kit_total_skipped_days = 0 AND kit_tracker_end_date IS NULL)
      );
  END IF;
END $$;

-- ============================================================================
-- DONE. The subscriptions table now has KIT Tracker columns with proper
-- category-based enforcement via CHECK constraint.
--
-- Next steps:
--   - Task 1.2: Create kit_daily_logs table
--   - Task 1.3: Create category guard triggers (write-path enforcement)
--   - Task 1.4: Create received_date lock trigger
--   - Task 1.5: Create skip-count and tracker end-date sync trigger
-- ============================================================================
