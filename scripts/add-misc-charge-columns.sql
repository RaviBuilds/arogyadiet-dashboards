-- ============================================================================
-- ADD misc_charge / misc_charge_label TO SUBSCRIPTIONS + PAYMENTS
-- (SAFE: additive, idempotent)
-- ============================================================================
-- Feature: miscellaneous onboarding charge
--
-- Stores an optional, admin-entered Miscellaneous_Charge alongside the plan
-- amount and the Total_Delivery_Charge, so the invoice breakup reconciles:
--
--   payments.amount = plan amount + delivery_charge + misc_charge
--
-- The charge carries its own admin-supplied label (e.g. "Additional product
-- charges") which is what the invoice prints — the word "Miscellaneous" is
-- never shown to the customer.
--
-- Adds:
--   - subscriptions.misc_charge        NUMERIC(10,2) NOT NULL DEFAULT 0
--   - subscriptions.misc_charge_label  TEXT NULL
--   - payments.misc_charge             NUMERIC(10,2) NOT NULL DEFAULT 0
--   - payments.misc_charge_label       TEXT NULL
--
-- Adds constraints (per table):
--   - chk_<table>_misc_charge_range
--       CHECK (misc_charge >= 0 AND misc_charge <= 999999.99)
--   - chk_<table>_misc_charge_label
--       A non-zero misc_charge REQUIRES a non-blank label; any label present
--       is capped at 100 characters.
--
-- Safety: Purely additive. The DEFAULT back-fills existing rows to 0 with a
-- NULL label, which satisfies both CHECKs for every pre-existing row. No
-- existing data is dropped or rewritten. Idempotent (re-runnable) via
-- ADD COLUMN IF NOT EXISTS / DO-guarded ADD CONSTRAINT.
--
-- RLS: This script does NOT enable or alter RLS, following the established
-- additive pattern (add-delivery-charge-to-subscriptions.sql).
--
-- Rollback:
--   ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS chk_subscriptions_misc_charge_label;
--   ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS chk_subscriptions_misc_charge_range;
--   ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS misc_charge_label;
--   ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS misc_charge;
--   ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS chk_payments_misc_charge_label;
--   ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS chk_payments_misc_charge_range;
--   ALTER TABLE public.payments DROP COLUMN IF EXISTS misc_charge_label;
--   ALTER TABLE public.payments DROP COLUMN IF EXISTS misc_charge;
-- ============================================================================

-- 1) SUBSCRIPTIONS -----------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS misc_charge NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS misc_charge_label TEXT;

COMMENT ON COLUMN public.subscriptions.misc_charge IS
  'Optional admin-entered miscellaneous charge for this subscription (additional products, one-off services), rounded to 2 decimals, distinct from delivery_charge. Defaults to 0.';

COMMENT ON COLUMN public.subscriptions.misc_charge_label IS
  'Admin-supplied name for misc_charge (e.g. "Additional product charges"). Printed verbatim on the invoice. NULL when misc_charge is 0.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_subscriptions_misc_charge_range'
       AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT chk_subscriptions_misc_charge_range
      CHECK (misc_charge >= 0 AND misc_charge <= 999999.99);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_subscriptions_misc_charge_label'
       AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT chk_subscriptions_misc_charge_label
      CHECK (
        (misc_charge = 0 OR (misc_charge_label IS NOT NULL AND char_length(btrim(misc_charge_label)) >= 1))
        AND (misc_charge_label IS NULL OR char_length(misc_charge_label) <= 100)
      );
  END IF;
END $$;

-- 2) PAYMENTS ----------------------------------------------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS misc_charge NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS misc_charge_label TEXT;

COMMENT ON COLUMN public.payments.misc_charge IS
  'Optional admin-entered miscellaneous charge included in payments.amount, distinct from base_amount/tax_amount/discount_amount/delivery_charge. Defaults to 0.';

COMMENT ON COLUMN public.payments.misc_charge_label IS
  'Admin-supplied name for misc_charge (e.g. "Additional product charges"). Printed verbatim as an invoice line item. NULL when misc_charge is 0.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_payments_misc_charge_range'
       AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT chk_payments_misc_charge_range
      CHECK (misc_charge >= 0 AND misc_charge <= 999999.99);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_payments_misc_charge_label'
       AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT chk_payments_misc_charge_label
      CHECK (
        (misc_charge = 0 OR (misc_charge_label IS NOT NULL AND char_length(btrim(misc_charge_label)) >= 1))
        AND (misc_charge_label IS NULL OR char_length(misc_charge_label) <= 100)
      );
  END IF;
END $$;

-- ============================================================================
-- DONE. Run scripts/add-misc-charge-to-onboard-rpc.sql next so the atomic
-- onboard_customer() RPC actually persists these columns (and restores
-- delivery_charge, which the current production function body omits).
-- ============================================================================
