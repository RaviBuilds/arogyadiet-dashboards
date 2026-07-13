-- ============================================================================
-- ADD delivery_charge TO SUBSCRIPTIONS — (SAFE: additive, idempotent)
-- ============================================================================
-- Spec: delivery-charges-management — Task 1.4 — Requirements 6.1
--
-- Stores the Total_Delivery_Charge associated with a subscription so
-- invoices/totals remain auditable even after rate configuration changes.
--
-- Adds:
--   - subscriptions.delivery_charge NUMERIC(10,2) NOT NULL DEFAULT 0
--       Existing subscriptions default to 0 (no back-charging of historical
--       subscriptions per design decision D5). Bounded to [0.00, 999999.99].
--
-- Adds constraint:
--   - chk_subscriptions_delivery_charge_range
--       CHECK (delivery_charge >= 0 AND delivery_charge <= 999999.99)
--
-- Safety: Purely additive. The DEFAULT back-fills existing rows to 0, which
-- satisfies the CHECK for all pre-existing subscriptions. No existing data is
-- dropped or rewritten. Idempotent (re-runnable) via ADD COLUMN IF NOT EXISTS /
-- DO-guarded ADD CONSTRAINT.
--
-- RLS: This script does NOT enable or alter RLS, following the established
-- additive pattern (add-customer-category-to-subscriptions.sql).
--
-- Rollback:
--   ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS chk_subscriptions_delivery_charge_range;
--   ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS delivery_charge;
-- ============================================================================

-- 1) Additive column (defaults existing rows to 0) ----------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS delivery_charge NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.subscriptions.delivery_charge IS
  'Total_Delivery_Charge for this subscription (distance x delivery rate x plan days), rounded to 2 decimals. Defaults to 0 for subscriptions created before this feature.';

-- 2) Bound the value to [0.00, 999999.99] (Req 6.1) --------------------------
-- DO-guarded so the migration is idempotent (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_subscriptions_delivery_charge_range'
       AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT chk_subscriptions_delivery_charge_range
      CHECK (delivery_charge >= 0 AND delivery_charge <= 999999.99);
  END IF;
END $$;

-- ============================================================================
-- DONE. subscriptions.delivery_charge is additive (NOT NULL DEFAULT 0) and
-- bounded to [0.00, 999999.99], matching the Rate_Config_Store and delivery
-- charge calculator bounds used throughout this feature.
-- ============================================================================
