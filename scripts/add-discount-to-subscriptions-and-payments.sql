-- ============================================================================
-- ADD discount_amount TO SUBSCRIPTIONS + BOUND payments.discount_amount
-- (SAFE: additive, idempotent)
-- ============================================================================
-- Feature: admin-manual-onboarding-discount
--
-- An admin onboarding a MEAL or KIT customer may grant a manual rupee discount
-- at the Payment & Review step. The discount is absorbed ENTIRELY by the
-- subscription charge and its GST — delivery_charge and misc_charge are never
-- reduced.
--
-- STORAGE MODEL (the reason no new payments column is needed)
--   payments.discount_amount = the GROSS concession the admin typed (e.g. 2000)
--   payments.base_amount     = taxable value AFTER the discount
--   payments.tax_amount      = GST AFTER the discount
--   payments.amount          = Total_Payable AFTER the discount
--
-- Two identities therefore hold for every discounted onboarding row, which is
-- what lets the invoice rebuild the "before discount" figures with no extra
-- column:
--   base_amount + tax_amount + delivery_charge + misc_charge = amount
--   base_amount + tax_amount + discount_amount              = original gross
--
-- Worked example — MEAL plan Rs.14,333 (GST-inclusive), delivery Rs.1,000,
-- misc Rs.5,000, discount Rs.2,000:
--   discounted gross = 14333 - 2000 = 12333
--   base_amount      = round(12333 / 1.05, 2) = 11745.71
--   tax_amount       = 12333 - 11745.71       =   587.29
--   amount           = 12333 + 1000 + 5000    = 18333.00
--
-- Adds:
--   - subscriptions.discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0
--   - chk_subscriptions_discount_amount_range  CHECK 0 .. 9999999.99
--   - chk_payments_discount_amount_range       CHECK 0 .. 9999999.99 (NULL ok)
--
-- payments.discount_amount ALREADY EXISTS (numeric, nullable, DEFAULT 0) and is
-- already written by onboard_customer() and the add-on order RPCs. This script
-- only bounds it. The CHECK deliberately tolerates NULL so it validates without
-- rewriting a single legacy row — verified: zero rows currently hold a NULL or
-- non-zero discount_amount, so the constraint is satisfied on creation.
--
-- WHY NO "discount <= total_payable" CROSS-CHECK
--   total_payable is stored POST-discount, so a full-plan discount legitimately
--   leaves total_payable = delivery + misc, which is SMALLER than the discount.
--   Such a constraint would reject a valid free-subscription case. The real
--   bound (discount <= subscription gross) lives in the service layer, which is
--   the only place that knows the plan / kit price.
--
-- Safety: One new column with a DEFAULT that back-fills existing rows to 0, plus
-- two CHECK constraints. No existing column altered, no row rewritten, nothing
-- dropped. Idempotent via ADD COLUMN IF NOT EXISTS and DO-guarded ADD
-- CONSTRAINT.
--
-- RLS: not enabled or altered here, following the additive precedent of
-- add-misc-charge-columns.sql and add-delivery-charge-to-subscriptions.sql.
--
-- Rollback:
--   ALTER TABLE public.payments      DROP CONSTRAINT IF EXISTS chk_payments_discount_amount_range;
--   ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS chk_subscriptions_discount_amount_range;
--   ALTER TABLE public.subscriptions DROP COLUMN     IF EXISTS discount_amount;
-- ============================================================================

-- 1) SUBSCRIPTIONS -----------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.subscriptions.discount_amount IS
  'Gross manual discount granted by an admin at onboarding, absorbed by the subscription charge + GST only (never delivery_charge or misc_charge). MEAL and KIT only; always 0 for ACCOMMODATION. total_payable is stored NET of this amount. Cleared to 0 by recalculate_subscription_tenure(), which re-prices from scratch. Defaults to 0.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_subscriptions_discount_amount_range'
       AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT chk_subscriptions_discount_amount_range
      CHECK (discount_amount >= 0 AND discount_amount <= 9999999.99);
  END IF;
END $$;

-- 2) PAYMENTS ----------------------------------------------------------------
-- The column already exists; only bound it. NULL is tolerated so no legacy row
-- needs rewriting to satisfy the constraint.
COMMENT ON COLUMN public.payments.discount_amount IS
  'Gross discount applied to this invoice. For subscription onboarding this is the admin-entered concession absorbed by base_amount + tax_amount (both stored POST-discount), so base_amount + tax_amount + discount_amount reconstructs the original GST-inclusive subscription charge. Never reduces delivery_charge or misc_charge. Defaults to 0.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_payments_discount_amount_range'
       AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT chk_payments_discount_amount_range
      CHECK (
        discount_amount IS NULL
        OR (discount_amount >= 0 AND discount_amount <= 9999999.99)
      );
  END IF;
END $$;

-- ============================================================================
-- DONE. Run scripts/add-discount-to-onboard-rpc.sql next so onboard_customer()
-- persists subscriptions.discount_amount, then
-- scripts/add-discount-clearing-to-recalculation.sql so early-closure
-- recalculation clears a stale discount instead of leaving the invoice printing
-- a concession that no longer relates to the re-priced figures.
-- ============================================================================
