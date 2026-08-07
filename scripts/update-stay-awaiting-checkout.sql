-- ============================================================================
-- AWAITING_CHECKOUT — let an admin settle and close a stay the cron already
-- marked FINISHED (SAFE: replaces two functions, no schema or data change)
-- ============================================================================
-- Spec: accommodation-payment-lifecycle
--
-- THE PROBLEM
-- The daily cron (AccommodationService.transitionStays) flips ACTIVE →
-- FINISHED the moment a stay's inclusive end date passes. That transition is a
-- pure calendar fact: it stamps no `checked_out_at`, settles no money, and
-- generates no Final_Consolidated_Invoice. But every gate downstream read
-- FINISHED as "closed and done":
--   * finalize_stay_checkout()          rejected it with NOT_ACTIVE
--   * record_stay_refund_with_invoice() rejected it with NOT_ACTIVE
-- so a guest whose stay simply ran to its end date became unclosable: the
-- balance could not be refunded, and Mark as Checked Out could never fire. The
-- stay dropped off the Accommodation tab's Current Stay surface with its money
-- unsettled and no invoice, recoverable only by editing rows by hand.
--
-- AWAITING_CHECKOUT is that state, made addressable:
--     status = 'FINISHED' AND checked_out_at IS NULL AND is_backdated = false
-- `checked_out_at` is the authoritative "an admin closed this" marker — only
-- finalize_stay_checkout() ever writes it — which is why the state cannot be
-- expressed with `status` alone. `is_backdated` is excluded because a
-- Backdated_Stay is *born* FINISHED with a null `checked_out_at` and closes out
-- through Generate Final Invoice, never through checkout; excluding it keeps
-- the two paths disjoint exactly as before.
--
-- CHANGES
--   1. finalize_stay_checkout()          — accepts Awaiting_Checkout in
--      addition to ACTIVE, and stamps `checked_out_at` at the stay's END DATE
--      rather than blindly at now() (see CHECKOUT TIMESTAMP below).
--   2. record_stay_refund_with_invoice() — accepts Awaiting_Checkout in
--      addition to ACTIVE, so an over-payment can be refunded to reach the
--      exactly-zero balance that checkout demands.
--
-- CHECKOUT TIMESTAMP (the behavioural change to weigh)
-- Previously: `checked_out_at = now()`, unconditionally. For a stay closed days
-- after it ended that records a checkout that never happened on that date, and
-- for an Awaiting_Checkout stay it would be wrong by construction — the guest
-- left on the end date; only the paperwork is late.
-- Now: `checked_out_at = LEAST(now(), end-of-day IST on the inclusive end date)`
--   * Same-day checkout (the overwhelmingly common ACTIVE case): now() is still
--     before 23:59:59 IST on the end date, so now() wins and behaviour is
--     BIT-FOR-BIT UNCHANGED.
--   * Late checkout: clamps to the end date, so the recorded checkout date is
--     the date the stay actually ended.
-- The end date is derived the same way every other consumer derives it —
-- start_date + (total_nights - 1), inclusive — so a Save_Stay_Details
-- recalculation that shortened the stay is honoured automatically, with no
-- separate branch. IST because every stay date in this system is an IST
-- calendar date.
--
-- WHAT IS DELIBERATELY NOT CHANGED
--   * save_stay_details() keeps its ACTIVE-only gate. Recalculating nights and
--     amount stays an action on a live stay; an Awaiting_Checkout stay is
--     settled and closed, not re-priced.
--   * The cron's ACTIVE → FINISHED transition is untouched. FINISHED remains
--     the correct status for a stay past its end date — the fix is that
--     FINISHED no longer implies "closed".
--   * The exactly-zero balance requirement for checkout, the row locks, the
--     BALANCE_OUTSTANDING / NOT_FOUND reasons, and the "commit FINISHED before
--     attempting the invoice" policy (Req 8.7) all stand verbatim.
--   * No table, column, index, constraint, or data row is added, dropped, or
--     written. This script only replaces two function bodies.
--
-- ORDERING: run AFTER create-accommodation-tables.sql,
-- create-stay-payment-lifecycle.sql (defines finalize_stay_checkout) and
-- create-stay-recalculation.sql (defines record_stay_refund_with_invoice).
-- Re-runnable: both statements are CREATE OR REPLACE.
--
-- ROLLBACK: re-run create-stay-payment-lifecycle.sql § 5 and
-- create-stay-recalculation.sql § 5 to restore the ACTIVE-only bodies.
-- ============================================================================

-- ============================================================================
-- 1. CHECKOUT GATE (Req 7.3, 7.4, 7.5)
-- ============================================================================
-- Reasons (unchanged in shape, so no caller mapping breaks):
--   NOT_FOUND            no such stay
--   NOT_ACTIVE + status  the stay is not checkout-eligible — a PENDING stay, a
--                        Backdated_Stay, or one already checked out
--   BALANCE_OUTSTANDING  + remaining_balance. Still an EXACT-zero gate, so a
--                        refund still owed fails here too.

CREATE OR REPLACE FUNCTION public.finalize_stay_checkout(p_stay_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stay        public.stay_entries;
  v_total_paid  NUMERIC(12,2);
  v_remaining   NUMERIC(12,2);
  v_end_date    DATE;
  v_checkout_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_stay
    FROM public.stay_entries
   WHERE id = p_stay_entry_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;

  -- Checkout-eligible: a live stay, or one the cron finished on its end date
  -- that no admin has closed yet (Awaiting_Checkout). A Backdated_Stay is
  -- excluded — Generate Final Invoice is its close-out path.
  IF NOT (
       v_stay.status = 'ACTIVE'
    OR (v_stay.status = 'FINISHED'
        AND v_stay.checked_out_at IS NULL
        AND v_stay.is_backdated = false)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ACTIVE',
                              'status', v_stay.status);  -- Req 7.5
  END IF;

  -- Total_Paid derived from the ledger, same formula as the append RPC and the
  -- reporting view (Req 6.3).
  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'REFUND' THEN -amount ELSE amount END), 0)
    INTO v_total_paid
    FROM public.stay_payment_transactions
   WHERE stay_entry_id = p_stay_entry_id;

  v_remaining := COALESCE(v_stay.payment_amount, 0) - v_total_paid;

  IF v_remaining <> 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BALANCE_OUTSTANDING',
                              'remaining_balance', v_remaining);  -- Req 7.4
  END IF;

  -- Inclusive end date, derived exactly as computeEndDate() does.
  v_end_date := v_stay.start_date + (v_stay.total_nights - 1);

  -- Clamp to the end of the end date in IST: now() for an on-time checkout,
  -- the end date itself for a late one.
  v_checkout_at := LEAST(
    now(),
    ((v_end_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '1 second'
  );

  UPDATE public.stay_entries
     SET status         = 'FINISHED',
         checked_out_at = v_checkout_at
   WHERE id = p_stay_entry_id;  -- Req 7.3

  RETURN jsonb_build_object('ok', true, 'remaining_balance', 0,
                            'checked_out_at', v_checkout_at);
END;
$$;

-- ============================================================================
-- 2. REFUND + REFUND INVOICE (Req 14.1, 14.4 - 14.9)
-- ============================================================================
-- Identical to create-stay-recalculation.sql § 5 apart from the status gate.
-- Every other clause — the SHARED_PAYMENT check, the ledger-derived excess, the
-- AMOUNT_NOT_POSITIVE / NO_EXCESS_TO_REFUND / REFUND_EXCEEDS_EXCESS /
-- REMARK_INVALID reasons, the atomic ledger-row-plus-Refund_Invoice insert, and
-- leaving Stay_Status untouched (Req 14.10) — is unchanged.

CREATE OR REPLACE FUNCTION public.record_stay_refund_with_invoice(
  p_stay_entry_id    UUID,
  p_amount           NUMERIC,
  p_transaction_date DATE,
  p_remark           TEXT,
  p_comment          TEXT,
  p_created_by       UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stay       public.stay_entries;
  v_total_paid NUMERIC(12,2);
  v_excess     NUMERIC(12,2);
  v_tx         public.stay_payment_transactions;
  v_payment_id UUID;
BEGIN
  SELECT * INTO v_stay
    FROM public.stay_entries
   WHERE id = p_stay_entry_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;

  -- A Shared_Payment stay carries no Total_Stay_Amount, so it has no excess and
  -- no ledger.
  IF v_stay.payment_host_profile_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SHARED_PAYMENT');
  END IF;

  -- ACTIVE, or Awaiting_Checkout. The second case is not a courtesy: checkout
  -- demands an exactly-zero balance, so an over-paid stay the cron already
  -- finished MUST be refundable or it can never be closed.
  IF NOT (
       v_stay.status = 'ACTIVE'
    OR (v_stay.status = 'FINISHED'
        AND v_stay.checked_out_at IS NULL
        AND v_stay.is_backdated = false)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ACTIVE',
                              'status', v_stay.status);
  END IF;

  -- Same Total_Paid formula as every other consumer (Req 6.3).
  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'REFUND' THEN -amount ELSE amount END), 0)
    INTO v_total_paid
    FROM public.stay_payment_transactions
   WHERE stay_entry_id = p_stay_entry_id;

  v_excess := v_total_paid - COALESCE(v_stay.payment_amount, 0);

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'AMOUNT_NOT_POSITIVE');   -- Req 14.4
  END IF;

  IF v_excess <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_EXCESS_TO_REFUND');   -- Req 14.5
  END IF;

  IF p_amount > v_excess THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'REFUND_EXCEEDS_EXCESS',
                              'excess', v_excess);                            -- Req 14.4
  END IF;

  IF p_remark IS NULL OR btrim(p_remark) = '' OR length(p_remark) > 500
     OR (p_comment IS NOT NULL AND length(p_comment) > 500) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'REMARK_INVALID');        -- Req 14.3
  END IF;

  -- Req 14.6 — one REFUND Payment_Transaction with the amount, remark, optional
  -- comment, and the current date.
  INSERT INTO public.stay_payment_transactions (
    stay_entry_id, customer_profile_id, transaction_type, amount,
    transaction_date, comment, remark, created_by
  ) VALUES (
    p_stay_entry_id, v_stay.customer_profile_id, 'REFUND', p_amount,
    p_transaction_date, p_comment, p_remark, p_created_by
  )
  RETURNING * INTO v_tx;

  -- Req 14.7 — exactly one Refund_Invoice per REFUND transaction, shaped like
  -- the Final_Consolidated_Invoice row AccommodationService already writes
  -- (payment_method 'Manual', status 'PAID', tax_percent from the stay). ANY
  -- failure here — including uniq_refund_invoice_per_transaction — aborts the
  -- whole function, taking the ledger row with it (Req 14.8).
  INSERT INTO public.payments (
    customer_profile_id, stay_entry_id, stay_payment_transaction_id,
    payment_method, amount, base_amount, tax_percent, tax_amount,
    discount_amount, status, paid_at, invoice_type
  ) VALUES (
    v_stay.customer_profile_id, p_stay_entry_id, v_tx.id,
    'Manual', p_amount, NULL, v_stay.tax_percentage, NULL,
    0, 'PAID', now(), 'ACCOMMODATION_REFUND_INVOICE'
  )
  RETURNING id INTO v_payment_id;

  UPDATE public.stay_payment_transactions
     SET refund_invoice_payment_id = v_payment_id
   WHERE id = v_tx.id;

  v_total_paid := v_total_paid - p_amount;

  RETURN jsonb_build_object(
    'ok', true,
    'transaction', to_jsonb(v_tx),
    'refund_invoice_payment_id', v_payment_id,
    'total_paid', v_total_paid,
    'remaining_balance', COALESCE(v_stay.payment_amount, 0) - v_total_paid
  );
END;
$$;
