-- ============================================================================
-- CLINIC SHOP STOCK — verify_clinic_stock_ledger_parity() (SAFE: Additive only)
-- ============================================================================
-- Spec: clinic-scoped-shop-inventory — Task 4.3
-- Requirements: 2.7
--
-- Requirement 2.7 states the invariant every writer in this feature must
-- maintain: for every (clinic_id, product_id) pair, clinic_product_settings
-- .stock_quantity equals the sum of that pair's IN clinic_product_ledger
-- quantities minus the sum of its OUT quantities. This function is the
-- DETECTOR for that invariant, not a repair tool — it never writes anything,
-- it only reports pairs where the invariant currently does not hold. It backs
-- the integration tests in Task 4.14 and is safe to run ad hoc for an
-- operational spot-check.
--
-- Mirrors the TypeScript reference model verifyLedgerParity() in
-- src/test/shop/clinicStockModel.ts exactly:
--   * A pair is considered if it appears in EITHER table — an overlay row
--     with no ledger history (balance 0) and ledger history with no overlay
--     row (stock 0) are both divergences worth surfacing, so the query is a
--     FULL OUTER JOIN across both tables, never an INNER JOIN.
--   * A missing overlay reads as stock_quantity 0 (Req 1.13); a pair with no
--     ledger entries reads as ledger_balance 0.
--   * Only pairs where the two values actually differ are returned.
--
-- Why LANGUAGE sql instead of the plpgsql SECURITY DEFINER house pattern used
-- by the mutation RPCs in this feature: SECURITY DEFINER exists to let a
-- caller perform a multi-table WRITE it would not otherwise be privileged to
-- perform (see clinic_shop_stock_in, clinic_shop_apply_sale). This function
-- does neither — it is a single read-only SELECT with no side effects, run by
-- integration tests and operators who already hold SELECT access (the
-- service-role client, or a direct database session), so there is no
-- privilege gap for SECURITY DEFINER to close. Running it as the invoker's
-- own privileges is the more conservative choice for a diagnostic query, and
-- STABLE (not VOLATILE) documents that it never modifies the database and
-- lets the planner treat repeated calls within one statement as cacheable.
--
-- ORDERING: This script MUST run AFTER:
--   - create-clinic-product-settings-table.sql (public.clinic_product_settings)
--   - create-clinic-product-ledger-table.sql (public.clinic_product_ledger)
--
-- Safety: Creates one new function. No table, trigger, or existing function is
-- read for writing, dropped, or altered. Idempotent via CREATE OR REPLACE.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.verify_clinic_stock_ledger_parity();
-- ============================================================================

-- ============================================================================
-- 1. VERIFY_CLINIC_STOCK_LEDGER_PARITY() — detector, no repair (Req 2.7)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.verify_clinic_stock_ledger_parity()
RETURNS TABLE (
  clinic_id      UUID,
  product_id     UUID,
  stock_quantity INTEGER,
  ledger_balance INTEGER
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH ledger_balances AS (
    SELECT
      l.clinic_id,
      l.product_id,
      SUM(CASE WHEN l.direction = 'IN' THEN l.quantity ELSE -l.quantity END)::INTEGER AS balance
    FROM public.clinic_product_ledger l
    GROUP BY l.clinic_id, l.product_id
  )
  SELECT
    COALESCE(s.clinic_id, lb.clinic_id)     AS clinic_id,
    COALESCE(s.product_id, lb.product_id)   AS product_id,
    COALESCE(s.stock_quantity, 0)           AS stock_quantity,
    COALESCE(lb.balance, 0)                 AS ledger_balance
  FROM public.clinic_product_settings s
  FULL OUTER JOIN ledger_balances lb
    ON lb.clinic_id = s.clinic_id
   AND lb.product_id = s.product_id
  WHERE COALESCE(s.stock_quantity, 0) IS DISTINCT FROM COALESCE(lb.balance, 0);
$$;

-- ============================================================================
-- DONE. Read-only diagnostic function, additive and isolated.
-- Run AFTER clinic_product_settings and clinic_product_ledger exist.
-- Used by: Task 4.14 integration tests, operational spot-checks.
-- ============================================================================
