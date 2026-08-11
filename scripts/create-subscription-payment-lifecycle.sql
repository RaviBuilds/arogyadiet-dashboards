-- ============================================================================
-- MEAL SUBSCRIPTION PARTIAL PAYMENT LIFECYCLE
-- ============================================================================
-- Feature: meal-subscription-partial-payment
-- Plan:    docs/meal-partial-payment-plan.md (Phase 1.1–1.8)
--
-- PURPOSE
-- Lets an admin onboard a MEAL customer against an ADVANCE payment instead of
-- the full Total_Payable, then collect the remainder over any number of partial
-- payments, while keeping ONE invoice per subscription.
--
-- This is a deliberate mirror of scripts/create-stay-payment-lifecycle.sql,
-- which already solved the same problem for accommodation. Same idioms on
-- purpose: an append-only ledger, a balance that is DERIVED and never stored,
-- SELECT ... FOR UPDATE on the parent row to serialise concurrent appends, and
-- RPCs that RETURN jsonb {ok, reason} instead of raising so the action layer can
-- map each reason to a pinned user-facing message.
--
-- WHAT THIS DOES NOT DO (design decision D3 — one invoice per subscription)
--   * No new payments.invoice_type value. payments_invoice_type_check is NOT
--     touched. There is no separate "final invoice" row: the single
--     invoice_type='SUBSCRIPTION' row created at onboarding IS the invoice for
--     the whole life of the subscription, and its amount_paid / balance_due move
--     as money comes in.
--   * No is_final_invoice column. "Final invoice" is a DERIVED label
--     (balance_due <= 0). A stored boolean alongside a ledger is a second source
--     of truth that can drift.
--   * No change to the invoice pricing breakup (base + GST + delivery + misc).
--     payments.amount remains Total_Payable, exactly as today, so every existing
--     invoice renders unchanged.
--
-- SAFETY
--   * Idempotent / re-runnable: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT
--     EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE, and DO-guarded
--     CHECK constraints (Postgres has no ADD CONSTRAINT IF NOT EXISTS).
--   * Every new column is NOT NULL DEFAULT 0, so all 284 existing payments rows
--     stay valid and are left byte-identical. No UPDATE is issued here.
--   * Drops nothing and alters no existing constraint.
--
-- WHY NO BACKFILL IS NEEDED HERE (plan finding 0.5)
--   A legacy PAID row keeps amount_paid = 0 / balance_due = 0. The invoice
--   renderer derives its state from `status` first, so it still reads "Total
--   Paid"; revenue reporting still sums `amount` for PAID/SUCCESS/CAPTURED and
--   only reads amount_paid for the PARTIALLY_PAID rows that this feature's code
--   creates. And the outstanding-balance gate is LEDGER-derived (see the view
--   below), so a subscription with no ledger rows can never register as
--   outstanding. The cosmetic backfill is a separate script, run last.
--
-- ROLLBACK
--   DROP VIEW IF EXISTS public.subscription_payment_balances;
--   DROP FUNCTION IF EXISTS public.record_subscription_payment_transaction(uuid,text,numeric,date,text,text,text,uuid);
--   DROP TABLE IF EXISTS public.subscription_payment_transactions;
--   ALTER TABLE public.payments DROP COLUMN IF EXISTS amount_paid, DROP COLUMN IF EXISTS balance_due;
--   ALTER TABLE public.subscriptions DROP COLUMN IF EXISTS total_payable;
-- ============================================================================


-- ============================================================================
-- 1. SUBSCRIPTIONS.TOTAL_PAYABLE (Plan 1.1, design decision D2)
-- ============================================================================
-- The authoritative Total_Payable snapshot = plan/kit amount + delivery charge
-- + miscellaneous charge, frozen at creation.
--
-- Deliberately SNAPSHOT, not derived from subscription_plans.price at read
-- time: plan prices change, and re-deriving would silently re-price a
-- subscription that was already settled months ago. Mirrors the role of
-- stay_entries.payment_amount on the accommodation side.
--
-- DEFAULT 0 keeps every existing row valid. Legacy rows therefore report
-- total_payable = 0, which is harmless because the balance view only considers
-- subscriptions that actually have ledger rows.

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS total_payable NUMERIC(10,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_subscriptions_total_payable_range'
       AND conrelid = 'public.subscriptions'::regclass
  ) THEN
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT chk_subscriptions_total_payable_range
      CHECK (total_payable >= 0 AND total_payable <= 9999999.99);
  END IF;
END $$;


-- ============================================================================
-- 2. PAYMENTS: AMOUNT_PAID + BALANCE_DUE (Plan 1.4)
-- ============================================================================
-- The single invoice row carries how much has actually been collected against
-- it and how much is still owed. `amount` is untouched and remains
-- Total_Payable, so the existing itemised breakup still reconciles.
--
--   amount_paid   cash collected so far against this invoice
--   balance_due   still owed; 0 means fully paid, which is what makes this row
--                 the FINAL invoice
--
-- Invariant maintained by the application/RPC layer, not a CHECK, because
-- amount is nullable-free but legacy rows have amount_paid = 0 while amount > 0:
--   amount_paid + balance_due = amount   (for rows this feature writes)
-- A CHECK would reject all 284 legacy rows.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_due NUMERIC(10,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_payments_amount_paid_range'
       AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT chk_payments_amount_paid_range
      CHECK (amount_paid >= 0 AND amount_paid <= 9999999.99);
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'chk_payments_balance_due_range'
       AND conrelid = 'public.payments'::regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT chk_payments_balance_due_range
      CHECK (balance_due >= 0 AND balance_due <= 9999999.99);
  END IF;
END $$;

-- Finding a customer's part-paid invoices cheaply (Customer 360 banner, the
-- outstanding-balance gate's fast path).
CREATE INDEX IF NOT EXISTS idx_payments_balance_due
  ON public.payments(customer_profile_id)
  WHERE balance_due > 0;


-- ============================================================================
-- 3. THE LEDGER (Plan 1.2, 1.3, design decision D1)
-- ============================================================================
-- Append-only record of every money movement against a subscription:
--   ADVANCE                  the one payment collected at onboarding
--   PARTIAL_BALANCE_PAYMENT  a later instalment against the balance
--   REFUND                   money returned (kept for symmetry with the
--                            accommodation ledger; no meal flow issues one yet)
--
-- amount is ALWAYS POSITIVE; direction comes from transaction_type. So
--   Total_Paid = SUM(CASE WHEN type = 'REFUND' THEN -amount ELSE amount END)
-- which is the ONE formula used by the RPC below, the view below, and
-- SubscriptionPaymentService.deriveSubscriptionBalance(). A parity test pins
-- the SQL and the TypeScript to each other.
--
-- Each row is separately addressable, which is what makes a per-instalment
-- receipt possible later if wanted. It is NOT an invoice: D3 keeps exactly one
-- invoice per subscription.

CREATE TABLE IF NOT EXISTS public.subscription_payment_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL
    REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  customer_profile_id UUID NOT NULL
    REFERENCES public.customer_profiles(id),
  transaction_type TEXT NOT NULL
    CHECK (transaction_type IN ('ADVANCE', 'PARTIAL_BALANCE_PAYMENT', 'REFUND')),
  amount NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  transaction_date DATE NOT NULL,
  -- How the money arrived. Free text rather than a CHECK so it can track
  -- payments.payment_method (COUNTER / MANUAL / CASH / UPI / ...) without a
  -- second migration every time that vocabulary grows.
  payment_method TEXT,
  payment_reference TEXT,
  comment VARCHAR(500),
  remark VARCHAR(500),
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chronological history per subscription, and the RPC's balance scan.
CREATE INDEX IF NOT EXISTS idx_subscription_payment_tx_subscription
  ON public.subscription_payment_transactions(subscription_id, created_at);

CREATE INDEX IF NOT EXISTS idx_subscription_payment_tx_customer
  ON public.subscription_payment_transactions(customer_profile_id);

-- At most ONE ADVANCE per subscription — the onboarding advance, and only that.
-- Partial index, so PARTIAL_BALANCE_PAYMENT and REFUND rows stay unrestricted
-- in number.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_subscription_advance_transaction
  ON public.subscription_payment_transactions(subscription_id)
  WHERE transaction_type = 'ADVANCE';

CREATE OR REPLACE FUNCTION public.update_subscription_payment_tx_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_subscription_payment_tx_updated_at
  ON public.subscription_payment_transactions;
CREATE TRIGGER trg_subscription_payment_tx_updated_at
  BEFORE UPDATE ON public.subscription_payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_subscription_payment_tx_updated_at();


-- ============================================================================
-- 4. BALANCE VIEW (Plan 1.7, finding 0.5)
-- ============================================================================
-- Total_Paid and Remaining_Balance are DERIVED here, never stored.
--
-- CRITICAL: this is an INNER JOIN on the ledger, not a LEFT JOIN. That is the
-- opposite of the accommodation view (stay_payment_balances), and it is
-- deliberate.
--
-- The accommodation flow created a ledger for every stay from day one, so a
-- LEFT JOIN was correct there. Here, all 284 pre-existing subscriptions were
-- full single-shot payments and have NO ledger rows, and their total_payable
-- defaults to 0. A LEFT JOIN would surface every one of them with
-- remaining_balance = 0 - 0 = 0 (harmless), but any future change to how
-- total_payable is populated could make legacy rows look outstanding and
-- silently block existing customers from buying a new subscription.
--
-- Restricting the view to subscriptions that actually have a ledger makes that
-- class of bug impossible: "no ledger" means "paid in full at onboarding",
-- full stop. It is also what removes any dependency on the cosmetic backfill.
--
-- remaining_balance can go negative if a REFUND overshoots; callers treat
-- negative as "refund due", never as "outstanding".

CREATE OR REPLACE VIEW public.subscription_payment_balances AS
SELECT s.id                             AS subscription_id,
       s.customer_profile_id,
       s.customer_category,
       s.status                         AS subscription_status,
       COALESCE(s.total_payable, 0)     AS total_payable,
       SUM(CASE WHEN t.transaction_type = 'REFUND' THEN -t.amount ELSE t.amount END)
                                        AS total_paid,
       COALESCE(s.total_payable, 0)
         - SUM(CASE WHEN t.transaction_type = 'REFUND' THEN -t.amount ELSE t.amount END)
                                        AS remaining_balance
  FROM public.subscriptions s
  JOIN public.subscription_payment_transactions t
    ON t.subscription_id = s.id
 GROUP BY s.id, s.customer_profile_id, s.customer_category, s.status, s.total_payable;


-- ============================================================================
-- 5. ROW-LOCKED LEDGER APPEND (Plan 1.8)
-- ============================================================================
-- The ONLY sanctioned way to append to the ledger. SELECT ... FOR UPDATE on the
-- subscription row serialises concurrent appends per subscription, so two
-- admins each recording an instalment that individually fits the remaining
-- balance cannot both pass the "amount <= remaining balance" check.
--
-- Total_Paid is derived from the ledger INSIDE the lock, never read from a
-- stored column, so the balance the check uses is authoritative.
--
-- Returns jsonb rather than raising, so the action layer maps each reason to a
-- pinned message and echoes the authoritative balance back to the form:
--   NOT_FOUND              no such subscription
--   NO_TOTAL_PAYABLE       total_payable is 0 — a legacy/full-payment
--                          subscription has no balance to pay down
--   AMOUNT_NOT_POSITIVE    amount <= 0
--   AMOUNT_EXCEEDS_BALANCE + remaining_balance (the authoritative figure)
--   REFUND_EXCEEDS_EXCESS  + excess = max(-remaining, 0)
--   DUPLICATE_ADVANCE      an ADVANCE already exists for this subscription
-- On success: the inserted row plus the new total_paid / remaining_balance, so
-- the caller re-renders without a second round trip.
--
-- NOTE: this function appends to the ledger only. Syncing the invoice row's
-- payments.amount_paid / balance_due is the service layer's job, so that an
-- invoice-write failure cannot roll back a recorded collection. Consumed by the
-- Customer 360 balance-collection UI (deferred phase); built now because the
-- onboarding path needs the same balance formula and the parity test needs the
-- SQL to exist.

CREATE OR REPLACE FUNCTION public.record_subscription_payment_transaction(
  p_subscription_id   UUID,
  p_transaction_type  TEXT,
  p_amount            NUMERIC,
  p_transaction_date  DATE,
  p_payment_method    TEXT,
  p_payment_reference TEXT,
  p_comment           TEXT,
  p_remark            TEXT,
  p_created_by        UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub        public.subscriptions;
  v_total_paid NUMERIC(12,2);
  v_remaining  NUMERIC(12,2);
  v_new_tx     public.subscription_payment_transactions;
BEGIN
  -- Lock the subscription row for the whole check-then-insert.
  SELECT * INTO v_sub
    FROM public.subscriptions
   WHERE id = p_subscription_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;

  -- A subscription with no Total_Payable was a full single-shot payment (or a
  -- legacy row); it has no balance to pay down.
  IF COALESCE(v_sub.total_payable, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_TOTAL_PAYABLE');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'AMOUNT_NOT_POSITIVE');
  END IF;

  -- Total_Paid derived from the ledger — the one formula.
  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'REFUND' THEN -amount ELSE amount END), 0)
    INTO v_total_paid
    FROM public.subscription_payment_transactions
   WHERE subscription_id = p_subscription_id;

  v_remaining := COALESCE(v_sub.total_payable, 0) - v_total_paid;

  IF p_transaction_type = 'REFUND' THEN
    -- A refund may not exceed the excess already paid. With a non-negative
    -- remaining balance there is no excess, so any refund fails.
    IF p_amount > (-v_remaining) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'REFUND_EXCEEDS_EXCESS',
                                'excess', GREATEST(-v_remaining, 0));
    END IF;
  ELSE
    -- A payment may not exceed the remaining balance. The returned balance is
    -- the authoritative one the caller must display.
    IF p_amount > v_remaining THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'AMOUNT_EXCEEDS_BALANCE',
                                'remaining_balance', v_remaining);
    END IF;
  END IF;

  -- Append. uniq_subscription_advance_transaction rejects a second ADVANCE;
  -- translate that into a typed reason instead of leaking a constraint error.
  BEGIN
    INSERT INTO public.subscription_payment_transactions (
      subscription_id, customer_profile_id, transaction_type, amount,
      transaction_date, payment_method, payment_reference, comment, remark,
      created_by
    ) VALUES (
      p_subscription_id, v_sub.customer_profile_id, p_transaction_type, p_amount,
      p_transaction_date, NULLIF(btrim(COALESCE(p_payment_method, '')), ''),
      NULLIF(btrim(COALESCE(p_payment_reference, '')), ''),
      NULLIF(btrim(COALESCE(p_comment, '')), ''),
      NULLIF(btrim(COALESCE(p_remark, '')), ''),
      p_created_by
    )
    RETURNING * INTO v_new_tx;
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'DUPLICATE_ADVANCE');
  END;

  v_total_paid := v_total_paid +
    CASE WHEN p_transaction_type = 'REFUND' THEN -p_amount ELSE p_amount END;

  RETURN jsonb_build_object(
    'ok', true,
    'transaction', to_jsonb(v_new_tx),
    'total_paid', v_total_paid,
    'remaining_balance', COALESCE(v_sub.total_payable, 0) - v_total_paid
  );
END;
$$;


-- ============================================================================
-- DONE.
--
-- subscription_payment_transactions is the source of truth for money movement
-- on a meal subscription. Total_Paid and Remaining_Balance are DERIVED
-- everywhere, never stored.
--
-- payments.amount_paid / balance_due are a denormalised projection of the ledger
-- onto the single invoice row, maintained by the service layer, so the invoice
-- can render "Total Amount Paid" and "Balance Remaining" in one read.
--
-- NEXT: scripts/update-onboard-customer-with-partial-payment.sql teaches the
-- onboard_customer RPC to write total_payable, the invoice's amount_paid /
-- balance_due / status, and the ADVANCE ledger row inside the SAME atomic
-- transaction.
-- ============================================================================
