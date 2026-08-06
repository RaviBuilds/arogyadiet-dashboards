-- ============================================================================
-- STAY RECALCULATION — Recalculate Stay / Save Stay Details history, the
-- recalculation flag, and Refund_Invoice linkage (SAFE: Additive only)
-- ============================================================================
-- Spec: accommodation-payment-lifecycle (Revision 2) — Task 13.1
-- Requirements: 8.4, 12.8, 12.14, 12.15, 12.16, 13.1, 13.2, 13.5, 13.6, 13.7,
--               14.4, 14.5, 14.6, 14.7, 14.8, 14.9
--
-- Revision 2 decouples RECALCULATING a stay from CHECKING IT OUT. The shipped
-- "Early Checkout" took a typed night count and, when the recalculated amount
-- happened to equal Total_Paid, silently transitioned the stay to FINISHED and
-- generated the Final_Consolidated_Invoice in the same click. Save Stay Details
-- replaces it: nights are DERIVED from a calendar-picked end date, the write is
-- repeatable while the stay is ACTIVE, and it NEVER touches Stay_Status and
-- NEVER generates a Final_Consolidated_Invoice (Req 12.9, 12.10).
-- Mark_As_Checked_Out (finalize_stay_checkout, shipped) remains the sole path
-- to FINISHED.
--
-- NOTHING IS DROPPED. stay_entries.early_checkout_applied,
-- actual_nights_stayed, original_total_nights, and original_total_amount are
-- all RETAINED — only their roles narrow:
--   early_checkout_applied  keeps its literal meaning ("this stay ended earlier
--                           than originally booked") and is still WRITTEN by
--                           save_stay_details() whenever a submission shortens
--                           the stay; no gate reads it any more
--   actual_nights_stayed    still kept in sync (= total_nights) whenever
--                           early_checkout_applied is set, so it stays coherent
--                           with chk_stay_actual_nights and with historical
--                           rows; no consumer reads it, because recalculation
--                           now repeats and it can go stale between
--                           invocations
--   original_total_*        semantics WIDENED from "before the first Early
--                           Checkout" to "before the first Save Stay Details"
--                           (Req 12.15). Same write-once rule, same audit
--                           purpose, no data migration needed — for every
--                           existing row the two readings coincide
-- The new recalculation_applied flag is what "Save_Stay_Details has been
-- applied at least once" now means (Req 8.4).
--
-- Creates:
--   1. stay_entries.recalculation_applied (new column) + the ONE-TIME backfill
--      from early_checkout_applied, so already-shipped early-checkout stays
--      keep printing recalculated figures on their invoices (Req 8.4)
--   2. stay_recalculation_history table (new) — one row per Save Stay Details
--      submission that actually changed something, with its own
--      chk_stay_recalc_changed CHECK (Req 13.1, 13.2, 13.5)
--   3. Refund_Invoice linkage — payments.stay_payment_transaction_id,
--      stay_payment_transactions.refund_invoice_payment_id, the widened
--      invoice_type CHECK, idx_payments_stay_payment_tx, and the partial unique
--      index uniq_refund_invoice_per_transaction (Req 14.7, 14.9)
--   4. save_stay_details() — row-locked, one transaction for the stay update
--      AND its history insert (Req 12.8, 12.14, 12.15, 12.16, 13.1, 13.2)
--   5. record_stay_refund_with_invoice() — row-locked, one transaction for the
--      REFUND ledger row AND its Refund_Invoice (Req 14.4–14.9)
--
-- WHY A SEPARATE HISTORY TABLE rather than a `kind` discriminator on
-- stay_extension_history: Req 13.6 and 13.7 require that the two lists never
-- contaminate each other in EITHER direction. Two tables make that a structural
-- guarantee instead of a query filter someone can forget, and it matches the
-- precedent create-stay-extension-history.sql already set. Like that table,
-- stay_recalculation_history is purely informational — nothing derives a
-- balance or a night count from it. Total_Stay_Amount continues to live only on
-- stay_entries.payment_amount, and Total_Paid only in
-- stay_payment_transactions.
--
-- WHY REFUNDS MOVE TO THEIR OWN RPC: Req 14.8 demands that a Refund_Invoice
-- failure roll the REFUND ledger row back with it — the deliberate OPPOSITE of
-- the Final_Consolidated_Invoice policy, where the FINISHED transition is
-- preserved through an invoice failure (Req 8.8). The shipped
-- record_stay_payment_transaction() commits its ledger row on its own, so a
-- later invoice failure would leave Total_Paid permanently wrong. A
-- compensating delete from Node was rejected: the delete can itself fail, which
-- is precisely the case Req 14.8 is about. record_stay_refund_with_invoice()
-- writes both rows in one transaction instead. The old function's REFUND branch
-- is LEFT IN PLACE (removing it would be a non-additive change to a shipped
-- function, and it still guards direct/legacy invocation), but no application
-- refund path calls it any more.
--
-- Backfill: recalculation_applied = true WHERE early_checkout_applied = true is
-- the ONLY data write in this script, and it is a one-time, re-run-safe UPDATE
-- (the WHERE clause excludes rows already backfilled). No history rows are
-- backfilled — a stay early-checked-out before this migration has no
-- Recalculation_History entry, so its list renders the Req 13.4 empty state.
-- That matches create-stay-extension-history.sql's precedent, and it is honest:
-- the before/after figures for those historic operations were never captured.
--
-- RLS: This script does NOT enable or alter RLS. stay_recalculation_history
-- follows the stay_entries / stay_extension_history precedent — all access is
-- through Server Actions using the service-role admin client, with admin-group
-- authorisation enforced in the action layer (guardAdminGroup /
-- getCurrentAdminContext). Both new functions are SECURITY DEFINER with
-- SET search_path = public and are only ever invoked from those actions.
--
-- ORDERING: This script MUST run AFTER:
--   - create-accommodation-tables.sql (public.stay_entries, with start_date,
--     total_nights, status, payment_amount, base_amount, tax_amount,
--     tax_percentage, payment_host_profile_id, customer_profile_id)
--   - create-stay-payment-lifecycle.sql (public.stay_payment_transactions,
--     stay_entries.early_checkout_applied / actual_nights_stayed /
--     original_total_nights / original_total_amount, payments.stay_entry_id,
--     and payments_invoice_type_check already widened to admit
--     ACCOMMODATION_FINAL_INVOICE)
--   - create-stay-extension-history.sql (the history-table precedent this table
--     deliberately does NOT join)
--   - public.customer_profiles, public.payments, and public.users exist
--
-- Safety: One brand new table + additive ALTERs + two new functions. No table
-- is dropped, no column is removed, no existing row is rewritten apart from the
-- one-time recalculation_applied backfill. Idempotent (re-runnable) via
-- ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS (which carries
-- chk_stay_recalc_changed inline, so no DO guard is needed for it),
-- CREATE INDEX / CREATE UNIQUE INDEX IF NOT EXISTS,
-- DROP CONSTRAINT IF EXISTS ... ADD CONSTRAINT for the widened CHECK, a
-- self-excluding backfill WHERE clause, and CREATE OR REPLACE FUNCTION.
-- Running it twice leaves an identical schema and changes no data on the second
-- pass.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.record_stay_refund_with_invoice(uuid, numeric, date, text, text, uuid);
--   DROP FUNCTION IF EXISTS public.save_stay_details(uuid, date, numeric, numeric, numeric, date, uuid);
--   DROP INDEX IF EXISTS public.idx_payments_stay_payment_tx;
--   DROP INDEX IF EXISTS public.uniq_refund_invoice_per_transaction;
--   ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_invoice_type_check;
--   ALTER TABLE public.payments ADD CONSTRAINT payments_invoice_type_check
--     CHECK (invoice_type = ANY (ARRAY[
--       'SUBSCRIPTION'::text,'ADDON'::text,
--       'ACCOMMODATION_STAY'::text,'ACCOMMODATION_EXTENSION'::text,
--       'ACCOMMODATION_FINAL_INVOICE'::text]));
--   ALTER TABLE public.stay_payment_transactions DROP COLUMN IF EXISTS refund_invoice_payment_id;
--   ALTER TABLE public.payments DROP COLUMN IF EXISTS stay_payment_transaction_id;
--   DROP TABLE IF EXISTS public.stay_recalculation_history;
--   ALTER TABLE public.stay_entries DROP COLUMN IF EXISTS recalculation_applied;
-- ============================================================================

-- ============================================================================
-- 1. RECALCULATION FLAG (Req 8.4)
-- ============================================================================
-- Deliberately separate from early_checkout_applied: recalculation is now
-- REPEATABLE and may leave the stay length untouched (an amount-only
-- correction), so "the figures were recalculated" and "the stay ended early"
-- are two different facts. NOT NULL DEFAULT false, so every pre-existing stay
-- remains valid.

ALTER TABLE public.stay_entries
  ADD COLUMN IF NOT EXISTS recalculation_applied BOOLEAN NOT NULL DEFAULT false;

-- ONE-TIME BACKFILL — the only data write in this script. Every stay that had
-- an Early_Checkout applied under the shipped code DID have its figures
-- recalculated, so it must keep printing the recalculated total and nights on
-- its Final_Consolidated_Invoice (Req 8.4). The second predicate makes the
-- statement a no-op on every subsequent run.
UPDATE public.stay_entries
   SET recalculation_applied = true
 WHERE early_checkout_applied = true
   AND recalculation_applied = false;

-- ============================================================================
-- 2. RECALCULATION HISTORY (Req 13.1, 13.2, 13.5)
-- ============================================================================
-- One row per Save Stay Details submission THAT CHANGED SOMETHING, in the order
-- applied. Its own table, NOT a discriminator column on stay_extension_history
-- — see the header note (Req 13.6, 13.7). Purely informational: nothing reads
-- this table to derive a balance, a night count, or an end date.
--
-- end_date_before / end_date_after are stored explicitly rather than recomputed
-- from start_date + nights, so the history stays readable even though nights
-- and the end date are two views of the same change.

CREATE TABLE IF NOT EXISTS public.stay_recalculation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_entry_id UUID NOT NULL REFERENCES public.stay_entries(id) ON DELETE CASCADE,
  customer_profile_id UUID NOT NULL REFERENCES public.customer_profiles(id),
  nights_before INTEGER NOT NULL,
  nights_after INTEGER NOT NULL CHECK (nights_after >= 1),
  total_amount_before NUMERIC(10,2),
  total_amount_after NUMERIC(10,2) NOT NULL,
  end_date_before DATE NOT NULL,
  end_date_after DATE NOT NULL,
  recalculated_on DATE NOT NULL,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A row exists only when something actually changed (Req 13.2). Enforced in
  -- the database as well as inside save_stay_details(), so a future caller
  -- cannot write a meaningless "nothing changed" entry. IS DISTINCT FROM keeps
  -- a NULL-to-value amount change (a stay whose payment_amount was never set)
  -- correctly counted as a change.
  CONSTRAINT chk_stay_recalc_changed CHECK (
    nights_before <> nights_after
    OR total_amount_before IS DISTINCT FROM total_amount_after
  )
);

-- Ascending chronological history per stay (Req 13.5), matching the Payment
-- History and Extension History ordering convention
-- (idx_stay_payment_tx_stay / idx_stay_extension_history_stay).
CREATE INDEX IF NOT EXISTS idx_stay_recalc_history_stay
  ON public.stay_recalculation_history(stay_entry_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stay_recalc_history_customer
  ON public.stay_recalculation_history(customer_profile_id);

-- ============================================================================
-- 3. REFUND INVOICE LINKAGE (Req 14.7, 14.9)
-- ============================================================================

-- 3a. The REFUND transaction a payments row documents. Nullable — NULL for
--     every other invoice type, so no existing payments row is affected.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stay_payment_transaction_id UUID
    REFERENCES public.stay_payment_transactions(id);

-- 3b. Back-reference, so a ledger row can link straight to its Refund_Invoice
--     without a reverse scan of payments.
ALTER TABLE public.stay_payment_transactions
  ADD COLUMN IF NOT EXISTS refund_invoice_payment_id UUID
    REFERENCES public.payments(id);

-- 3c. Admit the Refund_Invoice type. EVERY pre-existing value stays
--     admissible, including ACCOMMODATION_FINAL_INVOICE added by
--     create-stay-payment-lifecycle.sql, so no existing payments row can be
--     invalidated. Idempotent via DROP CONSTRAINT IF EXISTS, following the
--     house convention (create-franchise-shop-stock-in-rpc.sql,
--     create-stay-payment-lifecycle.sql § 3b).
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_invoice_type_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_invoice_type_check
  CHECK (invoice_type = ANY (ARRAY[
    'SUBSCRIPTION'::text,
    'ADDON'::text,
    'ACCOMMODATION_STAY'::text,
    'ACCOMMODATION_EXTENSION'::text,
    'ACCOMMODATION_FINAL_INVOICE'::text,
    'ACCOMMODATION_REFUND_INVOICE'::text
  ]));

-- 3d. At most ONE Refund_Invoice per REFUND transaction — but ANY NUMBER per
--     stay (Req 14.9). Partial index keyed on the TRANSACTION, which is the
--     whole cardinality difference from uniq_final_stay_invoice_per_stay.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_refund_invoice_per_transaction
  ON public.payments(stay_payment_transaction_id)
  WHERE invoice_type = 'ACCOMMODATION_REFUND_INVOICE';

CREATE INDEX IF NOT EXISTS idx_payments_stay_payment_tx
  ON public.payments(stay_payment_transaction_id);

-- ============================================================================
-- 4. SAVE STAY DETAILS (Req 12.8, 12.14, 12.15, 12.16, 13.1, 13.2)
-- ============================================================================
-- ONE transaction, ONE row lock: the stay update and its history entry commit
-- together or not at all, which is exactly what Req 12.16 asks for — a
-- mid-operation failure leaves nights, amount, status, and end date fully
-- unchanged. Same lock discipline as record_stay_payment_transaction() and
-- finalize_stay_checkout().
--
-- What this function deliberately does NOT do: touch `status`, touch
-- `checked_out_at`, or write a payments row. Save Stay Details is not a checkout
-- (Req 12.9); Mark_As_Checked_Out remains the sole path to FINISHED.
--
-- GST is passed in rather than computed here, so the 18% breakup keeps coming
-- from the single gstFromTotal() path in AccommodationService that onboarding
-- and Stay_Extension already share (design decision: one GST truth).
--
-- Returns jsonb rather than raising, so the action layer can map each reason to
-- its pinned message:
--   NOT_FOUND             no such stay
--   NOT_ACTIVE + status   only ACTIVE stays may be recalculated (Req 12.14)
--   INVALID_END_DATE      + min_end_date / max_end_date, the authoritative
--                         inclusive bounds the form must show (Req 12.3, 12.5)
--   AMOUNT_OUT_OF_RANGE   non-integer, or outside 1–9,999,999 (Req 12.4, 12.5)

CREATE OR REPLACE FUNCTION public.save_stay_details(
  p_stay_entry_id         UUID,
  p_recalculated_end_date DATE,
  p_recalculated_amount   NUMERIC,
  p_base_amount           NUMERIC,
  p_tax_amount            NUMERIC,
  p_recalculated_on       DATE,
  p_created_by            UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stay         public.stay_entries;
  v_booked_end   DATE;
  v_min_end      DATE;
  v_nights_after INTEGER;
  v_changed      BOOLEAN;
  v_shortens     BOOLEAN;
  v_history      public.stay_recalculation_history;
  v_updated      public.stay_entries;
BEGIN
  -- Lock the stay row for the whole validate-update-insert (Req 12.16).
  SELECT * INTO v_stay
    FROM public.stay_entries
   WHERE id = p_stay_entry_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;

  -- Req 12.14 — only ACTIVE stays may be recalculated, the same gate
  -- Stay_Extension applies.
  IF v_stay.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ACTIVE',
                              'status', v_stay.status);
  END IF;

  -- Inclusive end-date convention, matching computeEndDate everywhere else:
  -- nights = end - start + 1.
  v_booked_end := v_stay.start_date + (v_stay.total_nights - 1);
  v_min_end    := v_stay.start_date;

  -- Req 12.3, 12.5 — bounds re-enforced server-side regardless of client-side
  -- field state. BOTH ends are inclusive and selectable: the start date itself
  -- is valid and yields exactly 1 night, the minimum stay length. The currently
  -- booked end date therefore sits inside the range BY CONSTRUCTION, so a no-op
  -- submission needs no carve-out (Req 12.6). For a 1-night stay
  -- v_min_end = v_booked_end, the single admissible date.
  IF p_recalculated_end_date IS NULL
     OR p_recalculated_end_date < v_min_end
     OR p_recalculated_end_date > v_booked_end THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_END_DATE',
                              'min_end_date', v_min_end,
                              'max_end_date', v_booked_end);
  END IF;

  -- Req 12.4 — whole-number amount in [1, 9,999,999].
  IF p_recalculated_amount IS NULL
     OR p_recalculated_amount < 1
     OR p_recalculated_amount > 9999999
     OR p_recalculated_amount <> trunc(p_recalculated_amount) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'AMOUNT_OUT_OF_RANGE');
  END IF;

  -- Req 12.8 — Recalculated_Total_Nights is DERIVED, never typed.
  v_nights_after := (p_recalculated_end_date - v_stay.start_date) + 1;

  v_changed  := v_nights_after <> v_stay.total_nights
                OR v_stay.payment_amount IS DISTINCT FROM p_recalculated_amount;
  v_shortens := p_recalculated_end_date < v_booked_end;

  UPDATE public.stay_entries
     SET total_nights           = v_nights_after,
         payment_amount         = p_recalculated_amount,
         base_amount            = p_base_amount,
         tax_amount             = p_tax_amount,
         recalculation_applied  = true,
         -- Retained legacy columns, written only for the Early_Checkout case.
         -- Bare column references read the PRE-UPDATE values, so the flag is
         -- sticky once set.
         early_checkout_applied = early_checkout_applied OR v_shortens,
         actual_nights_stayed   = CASE
             WHEN early_checkout_applied OR v_shortens THEN v_nights_after
             ELSE actual_nights_stayed
           END,
         -- Req 12.15 — captured on the FIRST application only. COALESCE is the
         -- whole mechanism: once set, a later invocation cannot overwrite it.
         original_total_nights  = COALESCE(original_total_nights, v_stay.total_nights),
         original_total_amount  = COALESCE(original_total_amount, v_stay.payment_amount)
   WHERE id = p_stay_entry_id
  RETURNING * INTO v_updated;

  -- Req 13.1 / 13.2 — exactly one entry when nights or amount changed, and NO
  -- entry otherwise. chk_stay_recalc_changed backs this up at the DB level.
  IF v_changed THEN
    INSERT INTO public.stay_recalculation_history (
      stay_entry_id, customer_profile_id,
      nights_before, nights_after,
      total_amount_before, total_amount_after,
      end_date_before, end_date_after,
      recalculated_on, created_by
    ) VALUES (
      p_stay_entry_id, v_stay.customer_profile_id,
      v_stay.total_nights, v_nights_after,
      v_stay.payment_amount, p_recalculated_amount,
      v_booked_end, p_recalculated_end_date,
      p_recalculated_on, p_created_by
    )
    RETURNING * INTO v_history;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'stay', to_jsonb(v_updated),
    'history_recorded', v_changed,
    'recalculation', CASE WHEN v_changed THEN to_jsonb(v_history) ELSE NULL END
  );
END;
$$;

-- ============================================================================
-- 5. REFUND + REFUND INVOICE, ATOMIC (Req 14.4, 14.5, 14.6, 14.7, 14.8, 14.9)
-- ============================================================================
-- The ledger row and its Refund_Invoice are inserted in ONE transaction, so a
-- failure at the invoice step rolls the REFUND row back with it and Total_Paid
-- is left untouched (Req 14.8). This is the deliberate opposite of the
-- Final_Consolidated_Invoice policy, where the FINISHED transition is preserved
-- through an invoice failure (Req 8.8) — see the header note.
--
-- Like record_stay_payment_transaction(), Total_Paid is DERIVED from the ledger
-- inside the row lock (Req 6.3), never read from a stored column, so the excess
-- the checks use is authoritative even with two admins acting at once.
--
-- Reasons:
--   NOT_FOUND               no such stay
--   SHARED_PAYMENT          a Shared_Payment stay has no total and no ledger
--   NOT_ACTIVE + status     Req 14.1 scopes Mark as refunded to an ACTIVE stay
--   AMOUNT_NOT_POSITIVE     Req 14.4
--   NO_EXCESS_TO_REFUND     Total_Paid no longer exceeds the total (Req 14.5)
--   REFUND_EXCEEDS_EXCESS   + excess, the live figure the form must show
--                           (Req 14.4)
--   REMARK_INVALID          missing/blank or over-long remark, or an over-long
--                           comment (Req 14.3)
-- On success: the inserted ledger row, the Refund_Invoice payment id, and the
-- new totals, so the caller re-renders without a second round trip. Stay_Status
-- is NOT touched (Req 14.10).

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

  IF v_stay.status <> 'ACTIVE' THEN
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

-- ============================================================================
-- DONE.
-- Recalculating a stay is now fully decoupled from checking it out.
-- stay_recalculation_history is a purely informational record of every Save
-- Stay Details submission that changed something; it never mixes with
-- stay_extension_history in either direction, and nothing derives a balance,
-- night count, or end date from it. Total_Stay_Amount continues to live only on
-- stay_entries.payment_amount and Total_Paid only in
-- stay_payment_transactions, unchanged by this migration.
--
-- Recalculate a stay only through
--   createAdminClient().rpc("save_stay_details", { ... })
-- and record a refund only through
--   createAdminClient().rpc("record_stay_refund_with_invoice", { ... })
-- from the Server Action layer, after admin-group authorisation and Zod
-- validation. save_stay_details() never transitions Stay_Status — that stays
-- exclusively finalize_stay_checkout()'s job. Run only AFTER
-- create-accommodation-tables.sql, create-stay-payment-lifecycle.sql, and
-- create-stay-extension-history.sql.
-- ============================================================================
