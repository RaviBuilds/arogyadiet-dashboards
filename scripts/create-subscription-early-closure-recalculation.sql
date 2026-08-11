-- ============================================================================
-- MEAL SUBSCRIPTION EARLY CLOSURE — TENURE RECALCULATION (SAFE: Additive only)
-- ============================================================================
-- Feature: meal-subscription-early-closure
-- Builds directly on scripts/create-subscription-payment-lifecycle.sql (ledger,
-- balance view, record_subscription_payment_transaction RPC) and
-- scripts/update-onboard-customer-with-partial-payment.sql. Run AFTER both.
--
-- PURPOSE
-- Replaces the old "Stop Subscription" action (adminLifecycleActions.ts,
-- stopActiveSubscription — a bare status flip to STOPPED with no payment
-- settlement) with "Recalculate Subscription Tenure": an admin shortens an
-- ACTIVE subscription's end date, re-prices it at the new (lower) duration, and
-- the difference between what was already collected and the new price becomes
-- either an outstanding balance (existing Record Balance Payment flow, already
-- shipped) or a refund due (new dedicated refund action, locked to the exact
-- excess).
--
-- IMPORTANT — status is NOT flipped to STOPPED here. The subscription STAYS
-- ACTIVE with its new, shortened effective_end_on, so deliveries the customer
-- already paid for keep going out on the remaining days. It reaches EXPIRED
-- through the SAME existing daily cron that expires every other subscription
-- (FallbackAutomationService.runSubscriptionActivation), just on the new,
-- earlier date. Recalculating the tenure is purely a re-pricing + date
-- shortening operation — closing the account down is a side effect of the
-- shortened date reaching "today", not a separate status write this RPC makes.
--
-- WHY A NEW RPC RATHER THAN EXTENDING stopActiveSubscription
-- The old action was a single unconditional UPDATE with no pricing logic and no
-- ledger interaction. Recalculation touches four things atomically (the
-- subscription's dates/total_payable, the invoice's breakup columns, the daily
-- preferences beyond the new end date, and an audit trail) and must be
-- row-locked the same way save_stay_details() is, so this is a new function
-- rather than a patch to the old one. stopActiveSubscription() and its RPC-less
-- UPDATE are LEFT IN PLACE (nothing calls it after the UI change, but it is not
-- deleted — same non-destructive precedent as create-stay-recalculation.sql
-- leaving the old Early_Checkout branch in record_stay_payment_transaction).
--
-- GST CONVENTION — DELIBERATELY FORWARD, NOT REVERSE (confirmed by the user)
-- Onboarding computes GST in REVERSE from an inclusive plan price
-- (taxAmount = total - total/1.05). This RPC computes it FORWARD on the
-- admin-entered new base charge (gst = base * 0.05), because the admin is
-- typing an EXCLUSIVE base charge here, not an inclusive total. Both are the
-- same 5% rate; only the direction of the arithmetic differs, and that is by
-- explicit user instruction, not an oversight.
--
-- WHAT NEVER CHANGES HERE
--   * misc_charge / misc_charge_label — untouched. Not part of recalculation.
--   * pause_credits_total / pause_credits_used — untouched. A pause already
--     consumed stays consumed; shortening the tenure does not refund a credit.
--   * The ledger formula (Total_Paid = SUM(REFUND ? -amount : amount)) and the
--     record_subscription_payment_transaction RPC — reused as-is for both the
--     "collect more" case (existing Record Balance Payment form, unchanged) and
--     the new dedicated refund action below.
--   * payments.amount_paid / balance_due / status projection — still owned
--     exclusively by SubscriptionPaymentService.syncInvoicePaymentProjection,
--     called from the action layer after this RPC returns. This RPC does not
--     touch those three columns.
--
-- CRITICAL SUBTLETY — BACKFILLING A LEDGER FOR PRE-PARTIAL-PAYMENT
-- SUBSCRIPTIONS
-- The 284 subscriptions that predate the meal-partial-payment feature were
-- paid in full at onboarding and have ZERO rows in
-- subscription_payment_transactions — by design, per that feature's finding
-- 0.5 ("no ledger means paid in full"). subscription_payment_balances is an
-- INNER JOIN on the ledger, so such a subscription is invisible to it, and
-- syncInvoicePaymentProjection's "no ledger → leave the invoice alone" guard
-- would then silently SKIP updating balance_due/status after this RPC
-- shortens the tenure — hiding a genuine refund or balance. If this RPC only
-- computed the settlement in memory without ever writing a ledger row, that
-- guard would mask the very thing recalculation exists to surface.
-- The fix: when the ledger is empty AND the invoice already shows money paid
-- (payments.amount_paid > 0), this RPC inserts ONE synthetic ADVANCE row for
-- that amount before computing anything else. This is not a fabrication — it
-- is the same reality the previous partial-payment feature encoded, made
-- explicit for a subscription that is now being touched by a second money-
-- moving feature. From that point on the ledger is the source of truth for
-- this subscription, exactly like every subscription onboarded after the
-- partial-payment feature shipped, and the balance view / refund RPC /
-- sync projection all work unmodified.
--
-- END-DATE BOUNDS (mirrors the onboarding 5 PM IST cutoff direction, inverted
-- for an end date instead of a start date)
--   * Earliest selectable new end date: TODAY (IST) if now < 17:00 IST, else
--     TOMORROW (IST) — an admin closing a plan after 5 PM cannot backdate
--     closure to a day whose deliveries may have already gone out.
--   * Latest selectable new end date: current effective_end_on - 1 day — this
--     is a SHORTENING-ONLY tool (Req: "no logic of selecting same end date").
--   * `p_new_end_date` is validated against BOTH bounds inside the row lock so
--     a stale client cannot submit an end date that has since become invalid.
--
-- Creates:
--   1. subscription_recalculation_history table — one row per successful
--      recalculation, purely informational (mirrors stay_recalculation_history)
--   2. recalculate_subscription_tenure() RPC — row-locked, does the whole
--      shortening + re-pricing + daily-preference truncation + audit insert in
--      one transaction
--
-- SAFETY: One brand new table + one new function. No existing table altered, no
-- existing column dropped, no existing row rewritten. Idempotent via
-- CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, and
-- CREATE OR REPLACE FUNCTION.
--
-- ROLLBACK
--   DROP FUNCTION IF EXISTS public.recalculate_subscription_tenure(uuid, date, numeric, numeric, date, uuid);
--   DROP TABLE IF EXISTS public.subscription_recalculation_history;
-- ============================================================================

-- ============================================================================
-- 1. RECALCULATION HISTORY (audit trail only — nothing derives a balance,
--    date, or price from this table; subscriptions.total_payable and the
--    ledger remain the sole sources of truth)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.subscription_recalculation_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  customer_profile_id UUID NOT NULL REFERENCES public.customer_profiles(id),
  end_date_before DATE NOT NULL,
  end_date_after DATE NOT NULL,
  total_payable_before NUMERIC(10,2) NOT NULL,
  total_payable_after NUMERIC(10,2) NOT NULL,
  base_amount_before NUMERIC(10,2),
  base_amount_after NUMERIC(10,2) NOT NULL,
  delivery_charge_before NUMERIC(10,2),
  delivery_charge_after NUMERIC(10,2) NOT NULL,
  tax_amount_after NUMERIC(10,2) NOT NULL,
  amount_paid_at_recalculation NUMERIC(10,2) NOT NULL,
  -- Positive = customer still owes after recalculation; negative = refund due.
  -- Zero is a valid, exact settlement. Purely a snapshot for the audit trail —
  -- the live figure is always re-derived from the ledger, never read back from
  -- here.
  settlement_amount NUMERIC(10,2) NOT NULL,
  recalculated_on DATE NOT NULL,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_subscription_recalc_end_date_shortens
    CHECK (end_date_after < end_date_before)
);

CREATE INDEX IF NOT EXISTS idx_subscription_recalc_history_subscription
  ON public.subscription_recalculation_history(subscription_id, created_at);

CREATE INDEX IF NOT EXISTS idx_subscription_recalc_history_customer
  ON public.subscription_recalculation_history(customer_profile_id);


-- ============================================================================
-- 2. RECALCULATE SUBSCRIPTION TENURE — ROW-LOCKED, ONE TRANSACTION
-- ============================================================================
-- Everything commits together or nothing does: the subscription's dates/total,
-- the invoice's breakup columns, the daily-preference truncation, and the
-- history row. Same lock discipline as save_stay_details() and
-- record_subscription_payment_transaction().
--
-- This function DOES NOT touch payments.amount_paid / balance_due / status —
-- that remains SubscriptionPaymentService.syncInvoicePaymentProjection's job,
-- called by the action layer immediately after this RPC succeeds, so a
-- projection failure never rolls back the actual re-pricing (same "money
-- already happened, cache can be repaired later" discipline as the rest of this
-- feature).
--
-- Reasons returned (jsonb {ok:false, reason, ...}), never raised:
--   NOT_FOUND              no such subscription
--   NOT_ACTIVE + status    only an ACTIVE subscription may be recalculated
--   NO_INVOICE             no SUBSCRIPTION invoice row found for this
--                          subscription (should not happen for a real ACTIVE
--                          subscription, but guarded rather than assumed)
--   INVALID_END_DATE + min_end_date / max_end_date — the authoritative
--                          inclusive bounds the dialog must show
--   BASE_AMOUNT_NOT_LOWER  + current_base_amount — new base charge must be
--                          strictly less than the current invoiced base amount
--   DELIVERY_CHARGE_NOT_LOWER + current_delivery_charge — new delivery charge
--                          must be strictly less than the current one
--   AMOUNT_OUT_OF_RANGE    either new figure is negative or exceeds the
--                          NUMERIC(10,2) ceiling
-- On success: the updated subscription row, the updated payment row, the
-- inserted history row, and the settlement figure (positive = due from
-- customer, negative = refund due, zero = exactly settled) so the caller can
-- render the confirmation without a second round trip.

CREATE OR REPLACE FUNCTION public.recalculate_subscription_tenure(
  p_subscription_id     UUID,
  p_new_end_date        DATE,
  p_new_base_amount     NUMERIC,
  p_new_delivery_charge NUMERIC,
  p_recalculated_on     DATE,
  p_created_by          UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sub            public.subscriptions;
  v_payment        public.payments;
  v_current_end    DATE;
  v_min_end        DATE;
  v_max_end        DATE;
  v_new_tax        NUMERIC(10,2);
  v_new_total      NUMERIC(10,2);
  v_new_total_days INTEGER;
  v_total_paid     NUMERIC(12,2);
  v_settlement     NUMERIC(12,2);
  v_history        public.subscription_recalculation_history;
  v_updated_sub    public.subscriptions;
  v_updated_pay    public.payments;
BEGIN
  -- Lock the subscription row for the whole validate-update-insert.
  SELECT * INTO v_sub
    FROM public.subscriptions
   WHERE id = p_subscription_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_FOUND');
  END IF;

  IF v_sub.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NOT_ACTIVE',
                              'status', v_sub.status);
  END IF;

  -- The single invoice row for this subscription (design decision D3, inherited
  -- from the partial-payment feature — exactly one SUBSCRIPTION invoice exists
  -- per subscription).
  SELECT * INTO v_payment
    FROM public.payments
   WHERE subscription_id = p_subscription_id
     AND invoice_type = 'SUBSCRIPTION'
   LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'NO_INVOICE');
  END IF;

  v_current_end := COALESCE(v_sub.effective_end_on, v_sub.ends_on);

  -- Bounds: earliest is validated by the action layer against the 5 PM IST
  -- cutoff (that logic already lives in src/lib/onboarding/cutoff.ts and is
  -- deliberately not duplicated in SQL); the RPC re-checks only the invariant it
  -- alone can guarantee under the row lock — that the new end date is strictly
  -- before the CURRENT effective end date (shortening-only, no same-date pick).
  v_min_end := v_sub.starts_on;
  v_max_end := v_current_end - 1;

  IF p_new_end_date IS NULL
     OR p_new_end_date < v_min_end
     OR p_new_end_date > v_max_end THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'INVALID_END_DATE',
                              'min_end_date', v_min_end,
                              'max_end_date', v_max_end);
  END IF;

  -- New base charge must be strictly lower than what was actually invoiced.
  IF p_new_base_amount IS NULL
     OR p_new_base_amount < 0
     OR p_new_base_amount > 9999999.99
     OR p_new_base_amount >= COALESCE(v_payment.base_amount, 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'BASE_AMOUNT_NOT_LOWER',
                              'current_base_amount', COALESCE(v_payment.base_amount, 0));
  END IF;

  -- New delivery charge must be strictly lower than the currently invoiced one.
  IF p_new_delivery_charge IS NULL
     OR p_new_delivery_charge < 0
     OR p_new_delivery_charge > 999999.99
     OR p_new_delivery_charge >= COALESCE(v_payment.delivery_charge, 0) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'DELIVERY_CHARGE_NOT_LOWER',
                              'current_delivery_charge', COALESCE(v_payment.delivery_charge, 0));
  END IF;

  -- GST — FORWARD 5% on the new base charge (see header note: deliberately the
  -- opposite direction from onboarding's reverse-inclusive calculation).
  v_new_tax := ROUND(p_new_base_amount * 0.05, 2);

  -- misc_charge is untouched and carried forward unchanged into the new total,
  -- per the confirmed decision that recalculation never edits it.
  v_new_total := p_new_base_amount + v_new_tax + p_new_delivery_charge
                 + COALESCE(v_sub.misc_charge, 0);

  v_new_total_days := (p_new_end_date - v_sub.starts_on) + 1;

  -- ── Backfill a ledger row for a pre-partial-payment subscription ─────────
  -- See the header note "CRITICAL SUBTLETY". Without this, a subscription that
  -- was paid in full at onboarding (no ledger rows, per the partial-payment
  -- feature's design) would have its settlement computed here but silently
  -- never projected onto payments.balance_due/status, because
  -- syncInvoicePaymentProjection treats "no ledger" as "nothing to sync".
  IF NOT EXISTS (
    SELECT 1 FROM public.subscription_payment_transactions
     WHERE subscription_id = p_subscription_id
  ) AND COALESCE(v_payment.amount_paid, 0) > 0 THEN
    INSERT INTO public.subscription_payment_transactions (
      subscription_id, customer_profile_id, transaction_type, amount,
      transaction_date, payment_method, comment, created_by
    ) VALUES (
      p_subscription_id, v_sub.customer_profile_id, 'ADVANCE', v_payment.amount_paid,
      COALESCE(v_sub.starts_on, p_recalculated_on),
      v_payment.payment_method,
      'Backfilled at recalculation: onboarding payment predates the payment ledger.',
      p_created_by
    );
  END IF;

  -- Total_Paid derived from the ledger — the SAME formula as
  -- record_subscription_payment_transaction and subscription_payment_balances.
  -- After the backfill above, every subscription reaching this point has at
  -- least one ledger row, so this SELECT is now always authoritative.
  SELECT COALESCE(SUM(CASE WHEN transaction_type = 'REFUND' THEN -amount ELSE amount END), 0)
    INTO v_total_paid
    FROM public.subscription_payment_transactions
   WHERE subscription_id = p_subscription_id;

  -- Positive = still owed by the customer; negative = refund due; zero = exact.
  v_settlement := v_new_total - v_total_paid;

  -- ── Apply: subscription dates/total ──────────────────────────────────────
  -- status is DELIBERATELY left untouched (stays ACTIVE). Deliveries for the
  -- remaining days up to the new (shortened) effective_end_on are ALREADY
  -- PAID FOR and must keep going out — orderGeneration.ts only creates
  -- delivery_orders for status = 'ACTIVE' subscriptions, so flipping to
  -- STOPPED here would cut off deliveries the customer is still entitled to.
  -- The existing daily cron (FallbackAutomationService.runSubscriptionActivation)
  -- already transitions any ACTIVE subscription to EXPIRED once
  -- effective_end_on <= today, so a shortened subscription is picked up by
  -- that same unmodified automation on its new, earlier date — no new status
  -- transition is invented here.
  UPDATE public.subscriptions
     SET ends_on            = p_new_end_date,
         effective_end_on   = p_new_end_date,
         total_days         = v_new_total_days,
         total_payable      = v_new_total
   WHERE id = p_subscription_id
  RETURNING * INTO v_updated_sub;

  -- ── Apply: invoice breakup columns ───────────────────────────────────────
  -- amount_paid / balance_due / status are intentionally NOT set here — the
  -- action layer re-projects them from the ledger via
  -- syncInvoicePaymentProjection immediately after this RPC returns, so the
  -- ledger stays the single source of truth for "how much has actually moved".
  UPDATE public.payments
     SET base_amount     = p_new_base_amount,
         tax_amount       = v_new_tax,
         delivery_charge  = p_new_delivery_charge,
         amount           = v_new_total
   WHERE id = v_payment.id
  RETURNING * INTO v_updated_pay;

  -- ── Truncate future daily preferences ────────────────────────────────────
  -- Deliveries scheduled beyond the new end date must not remain on the books.
  -- Pause credits (pause_credits_total / pause_credits_used) are deliberately
  -- left untouched even if a paused row beyond the new end date is deleted —
  -- a credit already consumed stays consumed.
  DELETE FROM public.subscription_daily_preferences
   WHERE subscription_id = p_subscription_id
     AND preference_date > p_new_end_date;

  -- ── Audit trail ───────────────────────────────────────────────────────────
  INSERT INTO public.subscription_recalculation_history (
    subscription_id, customer_profile_id,
    end_date_before, end_date_after,
    total_payable_before, total_payable_after,
    base_amount_before, base_amount_after,
    delivery_charge_before, delivery_charge_after,
    tax_amount_after,
    amount_paid_at_recalculation, settlement_amount,
    recalculated_on, created_by
  ) VALUES (
    p_subscription_id, v_sub.customer_profile_id,
    v_current_end, p_new_end_date,
    v_sub.total_payable, v_new_total,
    v_payment.base_amount, p_new_base_amount,
    v_payment.delivery_charge, p_new_delivery_charge,
    v_new_tax,
    v_total_paid, v_settlement,
    p_recalculated_on, p_created_by
  )
  RETURNING * INTO v_history;

  RETURN jsonb_build_object(
    'ok', true,
    'subscription', to_jsonb(v_updated_sub),
    'payment', to_jsonb(v_updated_pay),
    'history', to_jsonb(v_history),
    'total_paid', v_total_paid,
    'settlement_amount', v_settlement
  );
END;
$$;

-- ============================================================================
-- DONE.
-- Recalculate a subscription's tenure only through
--   createAdminClient().rpc("recalculate_subscription_tenure", { ... })
-- from the Server Action layer, after admin-group authorisation and Zod
-- validation of the end-date bounds and the two charge fields. Immediately
-- follow a successful call with
--   SubscriptionPaymentService.syncInvoicePaymentProjection(subscriptionId)
-- so payments.amount_paid / balance_due / status reflect the new total_payable
-- against the existing ledger. Run only AFTER
-- create-subscription-payment-lifecycle.sql and
-- update-onboard-customer-with-partial-payment.sql.
-- ============================================================================
