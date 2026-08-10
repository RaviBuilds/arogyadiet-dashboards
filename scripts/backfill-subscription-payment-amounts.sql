-- ============================================================================
-- BACKFILL — subscriptions.total_payable + payments.amount_paid / balance_due
-- ============================================================================
-- Feature: meal-subscription-partial-payment
-- Plan:    docs/meal-partial-payment-plan.md (Phase 1.10)
--
--   ⚠️  DO NOT RUN YET.
--   Run this ONLY after the meal onboarding UI and business logic are complete
--   and verified, as agreed. It is the last step.
--
-- ---------------------------------------------------------------------------
-- THIS IS COSMETIC. Nothing depends on it. (plan finding 0.5)
-- ---------------------------------------------------------------------------
-- It was originally believed to be a hard prerequisite. It is not:
--
--   * Revenue reporting still sums `amount` for PAID / SUCCESS / CAPTURED rows
--     and reads `amount_paid` ONLY for PARTIALLY_PAID rows — a status that only
--     the new code writes, and it always populates amount_paid in the same
--     INSERT. So reporting never reads an un-backfilled amount_paid.
--
--   * The outstanding-balance gate is LEDGER-derived
--     (subscription_payment_balances INNER JOINs
--     subscription_payment_transactions). All pre-existing subscriptions have
--     zero ledger rows, so they can never register as outstanding and no
--     existing customer is blocked from buying a new subscription.
--
--   * Invoice rendering derives its state from `status` first, so a legacy PAID
--     row with amount_paid = 0 still renders "Total Paid" with no partial block.
--
-- What it actually buys: historical invoices report a truthful amount_paid, and
-- Customer 360's "Total Paid" card can read one column for every row instead of
-- special-casing legacy rows.
--
-- ---------------------------------------------------------------------------
-- SCOPE (as of the audit — re-verify counts before running)
--   payments, invoice_type = 'SUBSCRIPTION':  251 PAID + 5 SUCCESS + 28 PENDING
--   Settled rows (PAID / SUCCESS / CAPTURED) → amount_paid = amount, balance_due = 0
--   PENDING rows                             → left untouched (amount_paid = 0,
--                                              balance_due = 0) so they keep
--                                              rendering as Proforma exactly as
--                                              they do today
--
-- SAFETY
--   * Idempotent: the WHERE clauses exclude already-backfilled rows, so
--     re-running is a no-op.
--   * Never touches PARTIALLY_PAID rows — those are authoritative, written by
--     the new code path with correct figures.
--   * Never touches `amount`, `status`, or any invoice figure. Only the two new
--     columns and subscriptions.total_payable.
--   * Wrapped in a transaction with before/after counts raised as notices.
--
-- ROLLBACK
--   The pre-state is uniform and trivially restorable:
--     UPDATE public.payments SET amount_paid = 0, balance_due = 0
--      WHERE status <> 'PARTIALLY_PAID';
--     UPDATE public.subscriptions SET total_payable = 0
--      WHERE id NOT IN (SELECT DISTINCT subscription_id
--                         FROM public.subscription_payment_transactions);
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. Pre-flight: report what is about to change.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_payments_target integer;
  v_subs_target     integer;
  v_partial_rows    integer;
BEGIN
  SELECT count(*) INTO v_payments_target
    FROM public.payments
   WHERE status IN ('PAID', 'SUCCESS', 'CAPTURED')
     AND amount_paid = 0
     AND amount > 0;

  SELECT count(*) INTO v_subs_target
    FROM public.subscriptions s
   WHERE s.total_payable = 0
     AND NOT EXISTS (
       SELECT 1 FROM public.subscription_payment_transactions t
        WHERE t.subscription_id = s.id
     );

  SELECT count(*) INTO v_partial_rows
    FROM public.payments
   WHERE status = 'PARTIALLY_PAID';

  RAISE NOTICE 'Backfill pre-flight:';
  RAISE NOTICE '  settled payments rows to update : %', v_payments_target;
  RAISE NOTICE '  subscriptions to stamp          : %', v_subs_target;
  RAISE NOTICE '  PARTIALLY_PAID rows (untouched) : %', v_partial_rows;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Settled invoices: everything billed was collected.
-- ---------------------------------------------------------------------------
-- `amount_paid = 0 AND amount > 0` is the "not yet backfilled" marker, which is
-- what makes this re-runnable. PARTIALLY_PAID is excluded by the status filter.
UPDATE public.payments
   SET amount_paid = amount,
       balance_due = 0
 WHERE status IN ('PAID', 'SUCCESS', 'CAPTURED')
   AND amount_paid = 0
   AND amount > 0;

-- ---------------------------------------------------------------------------
-- 2. Subscriptions: Total_Payable = what the invoice billed.
-- ---------------------------------------------------------------------------
-- Only for subscriptions with NO ledger rows, i.e. historical full payments.
-- Subscriptions created by the new flow already carry an authoritative
-- total_payable written by onboard_customer and must not be recomputed.
--
-- Uses the largest SUBSCRIPTION invoice for the subscription rather than SUM():
-- a subscription can accumulate ADDON payments rows, and summing those would
-- inflate Total_Payable with add-on purchases that were never part of the plan.
UPDATE public.subscriptions s
   SET total_payable = sub.invoice_amount
  FROM (
    SELECT p.subscription_id,
           MAX(p.amount) AS invoice_amount
      FROM public.payments p
     WHERE p.subscription_id IS NOT NULL
       AND p.invoice_type = 'SUBSCRIPTION'
       AND p.status IN ('PAID', 'SUCCESS', 'CAPTURED')
     GROUP BY p.subscription_id
  ) AS sub
 WHERE s.id = sub.subscription_id
   AND s.total_payable = 0
   AND NOT EXISTS (
     SELECT 1 FROM public.subscription_payment_transactions t
      WHERE t.subscription_id = s.id
   );

-- ---------------------------------------------------------------------------
-- 3. Post-flight verification.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_mismatched  integer;
  v_still_zero  integer;
BEGIN
  -- Every settled row must now satisfy amount_paid + balance_due = amount.
  SELECT count(*) INTO v_mismatched
    FROM public.payments
   WHERE status IN ('PAID', 'SUCCESS', 'CAPTURED')
     AND amount > 0
     AND amount_paid + balance_due <> amount;

  SELECT count(*) INTO v_still_zero
    FROM public.payments
   WHERE status IN ('PAID', 'SUCCESS', 'CAPTURED')
     AND amount > 0
     AND amount_paid = 0;

  RAISE NOTICE 'Backfill post-flight:';
  RAISE NOTICE '  settled rows failing amount_paid + balance_due = amount : %', v_mismatched;
  RAISE NOTICE '  settled rows still at amount_paid = 0                   : %', v_still_zero;

  IF v_mismatched > 0 OR v_still_zero > 0 THEN
    RAISE EXCEPTION 'Backfill verification failed (mismatched=%, still_zero=%) — rolling back.',
      v_mismatched, v_still_zero;
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- DONE. Historical invoices now report a truthful amount_paid / balance_due,
-- and every pre-existing subscription carries the Total_Payable it was billed.
-- No ledger rows were created, so no existing customer becomes "outstanding".
-- ============================================================================
