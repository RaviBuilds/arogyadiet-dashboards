-- ============================================================================
-- ACCOMMODATION PAYMENT LIFECYCLE — payment ledger, backdated stays,
-- early checkout, and final consolidated invoicing (SAFE: Additive only)
-- ============================================================================
-- Spec: accommodation-payment-lifecycle — Task 1.1
-- Requirements: 3.1, 4.5, 5.5, 5.6, 5.8, 6.1, 6.2, 7.3, 7.4, 7.5, 8.1, 8.6,
--               8.7, 10.1, 12.6, 12.9, 12.11, 12.15
--
-- Introduces the append-only payment ledger that becomes the single source of
-- truth for money movement on a Stay_Entry, plus the stay-level lifecycle
-- columns for backdated stays, early checkout, and final invoice linkage.
--
-- Total_Paid and Remaining_Balance are NEVER stored. They are derived from the
-- ledger — in the two RPCs below for gating decisions, in
-- AccommodationService.deriveStayBalance() for the application, and in the
-- stay_payment_balances view for reporting — so no update path can leave a
-- stored balance stale (design decision 3).
--
-- NOTE: stay_entries.payment_amount is REPURPOSED as Total_Stay_Amount
-- (onboarding total + Stay_Extension costs, replaced by the recalculated
-- amount after an Early_Checkout). No parallel total column is introduced, so
-- there is exactly one truth (design decision 2). Its shape is unchanged, so
-- every existing stay keeps its current value.
--
-- Creates:
--   1. stay_payment_transactions table (new) — the ADVANCE /
--      PARTIAL_BALANCE_PAYMENT / REFUND ledger, with at most one ADVANCE per
--      stay (Req 4.5, 6.1, 6.2, 10.1)
--   2. ALTER stay_entries — backdated, early-checkout, checkout, and
--      final-invoice columns + chk_stay_actual_nights (Req 3.1, 7.3, 8.1,
--      8.7, 12.6, 12.15)
--   3. ALTER payments — stay_entry_id linkage, the widened invoice_type CHECK,
--      idx_payments_stay_entry, and the partial unique index guaranteeing at
--      most one Final_Consolidated_Invoice per stay (Req 8.1, 8.6)
--   4. record_stay_payment_transaction() — row-locked ledger append
--      (Req 5.5, 5.6, 5.8, 12.9, 12.11)
--   5. finalize_stay_checkout() — row-locked checkout gate (Req 7.3, 7.4, 7.5)
--   6. stay_payment_balances view — read-only reporting convenience
--
-- DELIBERATE ADDITION beyond design.md's SQL block: design.md specifies the
-- Final_Consolidated_Invoice as a payments row with
-- invoice_type = 'ACCOMMODATION_FINAL_INVOICE' (design decision 6, Req 8.1)
-- but does not widen payments_invoice_type_check, which currently admits only
-- SUBSCRIPTION / ADDON / ACCOMMODATION_STAY / ACCOMMODATION_EXTENSION. Section
-- 3b widens it following the house convention used by
-- create-franchise-shop-stock-in-rpc.sql (DROP CONSTRAINT IF EXISTS ... ADD
-- CONSTRAINT ...), ADDING the new value while keeping every pre-existing value
-- admissible. Without it no final invoice could ever be inserted.
--
-- Backfill: existing stay_entries keep is_backdated = false,
-- early_checkout_applied = false, and no ledger rows. Existing payments rows
-- with invoice_type IN ('ACCOMMODATION_STAY','ACCOMMODATION_EXTENSION') are
-- LEFT UNTOUCHED for historical accuracy — only stays created after this
-- migration follow the ledger model (design decision 7). This script writes no
-- data rows at all.
--
-- RLS: This script does NOT enable or alter RLS.
-- stay_payment_transactions follows the stay_entries precedent — all access is
-- through Server Actions using the service-role admin client, with admin-group
-- authorisation enforced in the action layer (guardAdminGroup /
-- getCurrentAdminContext). Both RPCs are SECURITY DEFINER with
-- SET search_path = public and are only ever invoked from those actions.
--
-- ORDERING: This script MUST run AFTER:
--   - create-accommodation-tables.sql (public.stay_entries, with
--     payment_amount, payment_host_profile_id, status, total_nights)
--   - public.customer_profiles, public.payments, and public.users exist
--     (payments already carries invoice_type and its CHECK constraint)
--
-- Safety: One brand new table + additive ALTERs + new functions/view. No table
-- is dropped, no column is removed, no existing row is read or rewritten.
-- Idempotent (re-runnable) via CREATE TABLE / ADD COLUMN / CREATE INDEX
-- IF NOT EXISTS, DO-guarded ADD CONSTRAINT (Postgres has no ADD CONSTRAINT
-- IF NOT EXISTS for CHECK constraints), DROP CONSTRAINT IF EXISTS ... ADD
-- CONSTRAINT for the widened CHECK, DROP TRIGGER IF EXISTS before CREATE
-- TRIGGER, and CREATE OR REPLACE FUNCTION / VIEW.
--
-- Rollback:
--   DROP VIEW IF EXISTS public.stay_payment_balances;
--   DROP FUNCTION IF EXISTS public.finalize_stay_checkout(uuid);
--   DROP FUNCTION IF EXISTS public.record_stay_payment_transaction(uuid, text, numeric, date, text, text, uuid);
--   DROP INDEX IF EXISTS public.idx_payments_stay_entry;
--   DROP INDEX IF EXISTS public.uniq_final_stay_invoice_per_stay;
--   ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_invoice_type_check;
--   ALTER TABLE public.payments ADD CONSTRAINT payments_invoice_type_check
--     CHECK (invoice_type = ANY (ARRAY[
--       'SUBSCRIPTION'::text,'ADDON'::text,
--       'ACCOMMODATION_STAY'::text,'ACCOMMODATION_EXTENSION'::text]));
--   ALTER TABLE public.payments DROP COLUMN IF EXISTS stay_entry_id;
--   ALTER TABLE public.stay_entries DROP CONSTRAINT IF EXISTS chk_stay_actual_nights;
--   ALTER TABLE public.stay_entries
--     DROP COLUMN IF EXISTS final_invoice_error,
--     DROP COLUMN IF EXISTS final_invoice_generated_at,
--     DROP COLUMN IF EXISTS final_invoice_payment_id,
--     DROP COLUMN IF EXISTS checked_out_at,
--     DROP COLUMN IF EXISTS original_total_amount,
--     DROP COLUMN IF EXISTS original_total_nights,
--     DROP COLUMN IF EXISTS actual_nights_stayed,
--     DROP COLUMN IF EXISTS early_checkout_applied,
--     DROP COLUMN IF EXISTS is_backdated;
--   DROP TABLE IF EXISTS public.stay_payment_transactions;
--   DROP FUNCTION IF EXISTS public.update_stay_payment_transactions_updated_at();
-- ============================================================================

-- ============================================================================
-- 1. PAYMENT LEDGER (Req 6.1, 6.2, 10.1)
-- ============================================================================
-- Append-only record of every money movement against a Stay_Entry: the
-- onboarding ADVANCE, every PARTIAL_BALANCE_PAYMENT during the stay, and any
-- REFUND recorded during an Early_Checkout (Req 6.1). Each row is addressable,
-- which is what gives a Payment_Receipt its identity (Req 10.1).
--
-- amount is always POSITIVE; direction comes from transaction_type. Total_Paid
-- is therefore SUM(CASE WHEN type = 'REFUND' THEN -amount ELSE amount END)
-- (Req 6.3) — the one formula used by both RPCs and the reporting view.

CREATE TABLE IF NOT EXISTS public.stay_payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_entry_id UUID NOT NULL REFERENCES public.stay_entries(id) ON DELETE CASCADE,
  customer_profile_id UUID NOT NULL REFERENCES public.customer_profiles(id),
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN ('ADVANCE', 'PARTIAL_BALANCE_PAYMENT', 'REFUND')),  -- Req 6.2
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),                                -- Req 5.6, 12.9
  transaction_date DATE NOT NULL,
  comment VARCHAR(500),                                                            -- Req 5.3
  remark VARCHAR(500),                                                             -- Req 5.4, 12.10
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chronological history per stay (Req 6.5) and the RPC's balance scan.
CREATE INDEX IF NOT EXISTS idx_stay_payment_tx_stay
  ON public.stay_payment_transactions(stay_entry_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stay_payment_tx_customer
  ON public.stay_payment_transactions(customer_profile_id);

-- At most one ADVANCE per stay — the onboarding advance, and only that
-- (Req 4.5, 6.1). Partial index, so PARTIAL_BALANCE_PAYMENT and REFUND rows
-- stay unrestricted in number.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_stay_advance_transaction
  ON public.stay_payment_transactions(stay_entry_id)
  WHERE transaction_type = 'ADVANCE';

-- updated_at trigger for stay_payment_transactions
CREATE OR REPLACE FUNCTION public.update_stay_payment_transactions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stay_payment_tx_updated_at ON public.stay_payment_transactions;
CREATE TRIGGER trg_stay_payment_tx_updated_at
  BEFORE UPDATE ON public.stay_payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_stay_payment_transactions_updated_at();

-- ============================================================================
-- 2. STAY_ENTRIES LIFECYCLE COLUMNS (Req 3.1, 7.3, 8.1, 8.7, 12.6, 12.15)
-- ============================================================================
-- All nullable or NOT NULL DEFAULT false, so every pre-existing stay remains
-- valid: is_backdated = false, early_checkout_applied = false, and no
-- checkout / invoice metadata.
--
--   is_backdated               a Past_Stay_Start whose Computed_End_Date had
--                              already passed at creation, so the stay was
--                              created FINISHED (Req 3.1). Drives the
--                              "Generate Final Invoice" action (Req 9.2).
--   early_checkout_applied     an Early_Checkout has replaced total_nights and
--                              payment_amount (Req 12.6)
--   actual_nights_stayed       nights actually stayed, set by Early_Checkout;
--                              the invoice's nights when the flag is set
--                              (Req 8.3, 12.6)
--   original_total_nights /    pre-Early_Checkout audit values, written on the
--   original_total_amount      FIRST application only (Req 12.15)
--   checked_out_at             set by finalize_stay_checkout (Req 7.3)
--   final_invoice_payment_id   the one Final_Consolidated_Invoice (Req 8.1)
--   final_invoice_generated_at when that invoice was produced
--   final_invoice_error        recorded when generation fails AFTER the
--                              FINISHED transition is already committed, so
--                              FINISHED survives and a manual retry is
--                              possible (Req 8.7)

ALTER TABLE public.stay_entries
  ADD COLUMN IF NOT EXISTS is_backdated BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS early_checkout_applied BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS actual_nights_stayed INTEGER,
  ADD COLUMN IF NOT EXISTS original_total_nights INTEGER,
  ADD COLUMN IF NOT EXISTS original_total_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS checked_out_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS final_invoice_payment_id UUID REFERENCES public.payments(id),
  ADD COLUMN IF NOT EXISTS final_invoice_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS final_invoice_error TEXT;

-- Actual_Nights_Stayed is at least 1 whenever it is set (Req 12.3, 12.6), so a
-- direct database write cannot bypass the application bound.
-- DO-guarded: Postgres has no ADD CONSTRAINT IF NOT EXISTS for CHECK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_stay_actual_nights'
       AND conrelid = 'public.stay_entries'::regclass
  ) THEN
    ALTER TABLE public.stay_entries
      ADD CONSTRAINT chk_stay_actual_nights
      CHECK (actual_nights_stayed IS NULL OR actual_nights_stayed >= 1);
  END IF;
END $$;

-- ============================================================================
-- 3. FINAL INVOICE LINKAGE ON PAYMENTS (Req 8.1, 8.6)
-- ============================================================================

-- 3a. The stay a payments row belongs to. Nullable — every existing
--     SUBSCRIPTION / ADDON / ACCOMMODATION_STAY / ACCOMMODATION_EXTENSION row
--     keeps NULL and is otherwise untouched.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stay_entry_id UUID REFERENCES public.stay_entries(id);

-- 3b. Admit the Final_Consolidated_Invoice type (Req 8.1). See the header's
--     DELIBERATE ADDITION note. Every pre-existing value stays admissible, so
--     no existing payments row can be invalidated; the statement is idempotent
--     via DROP CONSTRAINT IF EXISTS.
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_invoice_type_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_invoice_type_check
  CHECK (invoice_type = ANY (ARRAY[
    'SUBSCRIPTION'::text,
    'ADDON'::text,
    'ACCOMMODATION_STAY'::text,
    'ACCOMMODATION_EXTENSION'::text,
    'ACCOMMODATION_FINAL_INVOICE'::text
  ]));

-- 3c. Hard guarantee: at most ONE Final_Consolidated_Invoice per Stay_Entry
--     (Req 8.6). Partial index, so the historical ACCOMMODATION_STAY and
--     ACCOMMODATION_EXTENSION rows — and any future non-final row — are
--     unconstrained in number.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_final_stay_invoice_per_stay
  ON public.payments(stay_entry_id)
  WHERE invoice_type = 'ACCOMMODATION_FINAL_INVOICE';

CREATE INDEX IF NOT EXISTS idx_payments_stay_entry
  ON public.payments(stay_entry_id);

-- ============================================================================
-- 4. ROW-LOCKED LEDGER APPEND (Req 5.5, 5.6, 5.8, 12.9, 12.11)
-- ============================================================================
-- The ONLY sanctioned way to append to the ledger. SELECT ... FOR UPDATE on
-- the stay row serialises concurrent appends per stay, so two admins each
-- recording a payment that individually fits the remaining balance cannot both
-- pass the "amount <= remaining balance" check (design decision 5).
--
-- Total_Paid is derived from the ledger inside the lock, never read from a
-- stored column, so the balance the check uses is authoritative.
--
-- Returns jsonb rather than raising, so the action layer can map each reason to
-- its pinned message and echo the authoritative balance back to the form:
--   NOT_FOUND              no such stay
--   SHARED_PAYMENT         a Shared_Payment stay has no total and no ledger
--                          (Req 4.7)
--   AMOUNT_NOT_POSITIVE    amount <= 0 (Req 5.6)
--   AMOUNT_EXCEEDS_BALANCE + remaining_balance (Req 5.5)
--   REFUND_EXCEEDS_EXCESS  + excess = max(-remaining, 0) (Req 12.9)
-- On success: the inserted row plus the new total_paid / remaining_balance, so
-- the caller re-renders without a second round trip.

CREATE OR REPLACE FUNCTION public.record_stay_payment_transaction(
  p_stay_entry_id    UUID,
  p_transaction_type TEXT,
  p_amount           NUMERIC,
  p_transaction_date DATE,
  p_comment          TEXT,
  p_remark           TEXT,
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
  v_remaining  NUMERIC(12,2);
  v_new_tx     public.stay_payment_transactions;
BEGIN
  -- Lock the stay row for the whole check-then-insert (Req 5.5, 12.9).
  SELECT * INTO v_stay
    FROM public.stay_entries
   WHERE id = p_stay_entry_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;

  -- A Shared_Payment stay carries no Total_Stay_Amount, so it has no balance
  -- to pay down and no ledger (Req 4.7).
  IF v_stay.payment_host_profile_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'SHARED_PAYMENT');
  END IF;

  -- Total_Paid derived from the ledger (Req 6.3).
  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'REFUND' THEN -amount ELSE amount END), 0)
    INTO v_total_paid
    FROM public.stay_payment_transactions
   WHERE stay_entry_id = p_stay_entry_id;

  -- Remaining_Balance = Total_Stay_Amount - Total_Paid (Req 6.4). Negative
  -- while a refund is due after an Early_Checkout.
  v_remaining := COALESCE(v_stay.payment_amount, 0) - v_total_paid;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'AMOUNT_NOT_POSITIVE');  -- Req 5.6
  END IF;

  IF p_transaction_type = 'REFUND' THEN
    -- A refund may not exceed the excess already paid (Req 12.9). With a
    -- non-negative remaining balance there is no excess, so any refund fails.
    IF p_amount > (-v_remaining) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'REFUND_EXCEEDS_EXCESS',
                                'excess', GREATEST(-v_remaining, 0));
    END IF;
  ELSE
    -- A payment may not exceed the remaining balance (Req 5.5). The returned
    -- balance is the authoritative one the caller must display.
    IF p_amount > v_remaining THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'AMOUNT_EXCEEDS_BALANCE',
                                'remaining_balance', v_remaining);
    END IF;
  END IF;

  -- Append (Req 5.8, 12.11). uniq_stay_advance_transaction rejects a second
  -- ADVANCE for this stay (Req 4.5).
  INSERT INTO public.stay_payment_transactions (
    stay_entry_id, customer_profile_id, transaction_type, amount,
    transaction_date, comment, remark, created_by
  ) VALUES (
    p_stay_entry_id, v_stay.customer_profile_id, p_transaction_type, p_amount,
    p_transaction_date, p_comment, p_remark, p_created_by
  )
  RETURNING * INTO v_new_tx;

  v_total_paid := v_total_paid +
    CASE WHEN p_transaction_type = 'REFUND' THEN -p_amount ELSE p_amount END;

  RETURN jsonb_build_object(
    'ok', true,
    'transaction', to_jsonb(v_new_tx),
    'total_paid', v_total_paid,
    'remaining_balance', COALESCE(v_stay.payment_amount, 0) - v_total_paid
  );
END;
$$;

-- ============================================================================
-- 5. ROW-LOCKED CHECKOUT GATE (Req 7.3, 7.4, 7.5)
-- ============================================================================
-- The authoritative Mark_As_Checked_Out gate. Re-checks ACTIVE status and an
-- exactly-zero Remaining_Balance under the same row lock that a concurrent
-- ledger append would need, so the balance cannot move between the check and
-- the transition — and the gate holds regardless of any client-side button
-- state (Req 7.4).
--
-- Reasons:
--   NOT_FOUND            no such stay
--   NOT_ACTIVE + status  checkout applies only to ACTIVE stays (Req 7.5)
--   BALANCE_OUTSTANDING  + remaining_balance, so the caller can name the
--                        amount still owed (Req 7.4). A negative balance (a
--                        refund still due after an Early_Checkout) also fails
--                        here — the gate is exact zero, not "nothing owed".
-- On success: status = 'FINISHED', checked_out_at = now() (Req 7.3).
--
-- Invoice generation is deliberately NOT part of this function: Req 8.7
-- requires FINISHED to survive an invoice failure, so the transition commits
-- first and the invoice is written afterwards by the service layer
-- (design decision 8).

CREATE OR REPLACE FUNCTION public.finalize_stay_checkout(p_stay_entry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stay       public.stay_entries;
  v_total_paid NUMERIC(12,2);
  v_remaining  NUMERIC(12,2);
BEGIN
  SELECT * INTO v_stay
    FROM public.stay_entries
   WHERE id = p_stay_entry_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;

  IF v_stay.status <> 'ACTIVE' THEN
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

  UPDATE public.stay_entries
     SET status = 'FINISHED',
         checked_out_at = now()
   WHERE id = p_stay_entry_id;  -- Req 7.3

  RETURN jsonb_build_object('ok', true, 'remaining_balance', 0);
END;
$$;

-- ============================================================================
-- 6. REPORTING VIEW
-- ============================================================================
-- Read-only convenience for reporting and for the integration tests that pin
-- the SQL balance formula to AccommodationService.deriveStayBalance(). The
-- service layer remains the single source of truth for the balance math used in
-- gating decisions (money is compared in integer paise there); the two RPCs
-- above own every balance-mutating check.
--
-- LEFT JOIN, so a stay with no ledger rows reports total_paid = 0 and
-- remaining_balance = total_stay_amount (Req 6.7).

CREATE OR REPLACE VIEW public.stay_payment_balances AS
SELECT se.id AS stay_entry_id,
       se.customer_profile_id,
       COALESCE(se.payment_amount, 0) AS total_stay_amount,
       COALESCE(SUM(CASE WHEN t.transaction_type = 'REFUND' THEN -t.amount ELSE t.amount END), 0) AS total_paid,
       COALESCE(se.payment_amount, 0)
         - COALESCE(SUM(CASE WHEN t.transaction_type = 'REFUND' THEN -t.amount ELSE t.amount END), 0)
         AS remaining_balance
  FROM public.stay_entries se
  LEFT JOIN public.stay_payment_transactions t ON t.stay_entry_id = se.id
 GROUP BY se.id, se.customer_profile_id, se.payment_amount;

-- ============================================================================
-- DONE.
-- stay_payment_transactions is the source of truth for money movement on a
-- stay; Total_Paid and Remaining_Balance are derived everywhere, never stored.
-- Append only through
--   createAdminClient().rpc("record_stay_payment_transaction", { ... })
-- and gate checkout only through
--   createAdminClient().rpc("finalize_stay_checkout", { p_stay_entry_id })
-- from the Server Action layer, after admin-group authorisation and Zod
-- validation. Run only AFTER create-accommodation-tables.sql, and after
-- customer_profiles, payments, and users exist.
-- ============================================================================
