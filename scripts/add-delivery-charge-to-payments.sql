-- ============================================================================
-- ADD delivery_charge TO PAYMENTS — (SAFE: additive, idempotent)
-- ============================================================================
-- Spec: delivery-charges-management — Task 1.3 — Requirements 6.1, 6.3
--
-- Stores the Total_Delivery_Charge recorded against a subscription's payment
-- as a distinct value, separate from base_amount, tax_amount, and
-- discount_amount (Req 6.3). payments.amount is expected to equal
-- Total_Payable (plan amount + delivery_charge) once this feature computes it
-- (Req 6.2).
--
-- Adds:
--   - payments.delivery_charge NUMERIC(10,2) NOT NULL DEFAULT 0
--       Existing payments default to 0 (no back-charging of historical
--       payments per design decision D5). Bounded to [0.00, 999999.99].
--
-- Adds constraint:
--   - chk_payments_delivery_charge_range
--       CHECK (delivery_charge >= 0 AND delivery_charge <= 999999.99)
--
-- Safety: Purely additive. The DEFAULT back-fills existing rows to 0, which
-- satisfies the CHECK for all pre-existing payments. No existing data is
-- dropped or rewritten. Idempotent (re-runnable) via ADD COLUMN IF NOT EXISTS /
-- DO-guarded ADD CONSTRAINT.
--
-- RLS: This script does NOT enable or alter RLS, following the established
-- additive pattern (add-delivery-charge-to-subscriptions.sql).
--
-- Rollback:
--   ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS chk_payments_delivery_charge_range;
--   ALTER TABLE public.payments DROP COLUMN IF EXISTS delivery_charge;
-- ============================================================================

-- 1) Additive column (defaults existing rows to 0) ----------------------------
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS delivery_charge NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payments.delivery_charge IS
  'Total_Delivery_Charge recorded for this payment (distance x delivery rate x plan days), rounded to 2 decimals, distinct from base_amount/tax_amount/discount_amount. Defaults to 0 for payments recorded before this feature.';

-- 2) Bound the value to [0.00, 999999.99] (Req 6.1) --------------------------
-- DO-guarded so the migration is idempotent (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_payments_delivery_charge_range'
       AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT chk_payments_delivery_charge_range
      CHECK (delivery_charge >= 0 AND delivery_charge <= 999999.99);
  END IF;
END $$;

-- ============================================================================
-- DONE. payments.delivery_charge is additive (NOT NULL DEFAULT 0) and bounded
-- to [0.00, 999999.99], matching the Rate_Config_Store and delivery charge
-- calculator bounds used throughout this feature.
-- ============================================================================
