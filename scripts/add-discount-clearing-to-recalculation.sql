-- ============================================================================
-- RECALCULATE SUBSCRIPTION TENURE — CLEAR A STALE MANUAL DISCOUNT
-- (SAFE: additive columns + CREATE OR REPLACE)
-- ============================================================================
-- Feature: admin-manual-onboarding-discount (Option 1)
-- Builds on scripts/create-subscription-early-closure-recalculation.sql.
-- Run AFTER scripts/add-discount-to-subscriptions-and-payments.sql.
--
-- THE PROBLEM THIS FIXES
-- Recalculation is a MANUAL re-pricing tool: the admin types a new subscription
-- charge and a new delivery charge, and this function overwrites
-- payments.base_amount / tax_amount / delivery_charge / amount and
-- subscriptions.total_payable from those figures. It has no notion of a
-- discount, so before this change a subscription onboarded with a manual
-- discount kept its discount_amount untouched after being re-priced — and
-- generateInvoiceData() would keep rendering a "Discount Applied" row derived
-- from a concession that no longer relates to any of the new numbers,
-- reconstructing a pre-discount base price that never existed in any
-- transaction. Concession reporting summing discount_amount would likewise
-- over-count a discount that had effectively been re-absorbed into the admin's
-- new figure.
--
-- THE DECISION (confirmed by the user)
-- Recalculation CLEARS the discount. The admin is re-pricing from scratch and
-- the charge they type IS the final agreed amount, with any concession already
-- reflected in their thinking. Carrying a discount forward — whether verbatim or
-- pro-rated — would either stop the total matching what they typed or leave a
-- purely decorative row on the invoice.
--
-- The original concession is NOT lost: it is captured in
-- subscription_recalculation_history.discount_amount_before, alongside every
-- other before/after figure this table already records.
--
-- THE MONEY IS UNAFFECTED
-- settlement_amount is v_new_total - v_total_paid. v_new_total comes from what
-- the admin typed; v_total_paid comes from the ledger. Neither reads
-- discount_amount, so clearing it cannot change a refund or an outstanding
-- balance by a paisa. This is a presentation-and-audit fix, not a financial one.
--
-- CATEGORY
-- This function has no category gate and never had one, so a discounted KIT
-- subscription is re-priced by exactly the same path as a MEAL one. Clearing the
-- discount is correct for both.
--
-- Adds:
--   - subscription_recalculation_history.discount_amount_before NUMERIC(10,2) NOT NULL DEFAULT 0
--   - subscription_recalculation_history.discount_amount_after  NUMERIC(10,2) NOT NULL DEFAULT 0
--
-- discount_amount_after is always 0 today. It is stored anyway so a history row
-- is self-describing rather than requiring the reader to know the convention,
-- and so that making the discount an editable field in the recalculation dialog
-- later needs no second migration.
--
-- Safety: two additive columns whose DEFAULT back-fills existing history rows to
-- 0, plus CREATE OR REPLACE on the function. No existing column altered, no row
-- rewritten, nothing dropped. Idempotent.
--
-- Rollback:
--   Re-run scripts/create-subscription-early-closure-recalculation.sql to
--   restore the previous function body, then optionally:
--   ALTER TABLE public.subscription_recalculation_history DROP COLUMN IF EXISTS discount_amount_after;
--   ALTER TABLE public.subscription_recalculation_history DROP COLUMN IF EXISTS discount_amount_before;
-- ============================================================================

-- ============================================================================
-- 1. HISTORY COLUMNS
-- ============================================================================
ALTER TABLE public.subscription_recalculation_history
  ADD COLUMN IF NOT EXISTS discount_amount_before NUMERIC(10,2) NOT NULL DEFAULT 0;

ALTER TABLE public.subscription_recalculation_history
  ADD COLUMN IF NOT EXISTS discount_amount_after NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.subscription_recalculation_history.discount_amount_before IS
  'The manual discount that was on the invoice immediately before this recalculation. Recalculation re-prices from scratch and clears the discount, so this is the only surviving record of the original concession for a recalculated subscription.';

COMMENT ON COLUMN public.subscription_recalculation_history.discount_amount_after IS
  'The manual discount left after this recalculation. Always 0 while recalculation clears discounts; stored explicitly so the history row is self-describing.';


-- ============================================================================
-- 2. RECALCULATE SUBSCRIPTION TENURE — unchanged except for discount clearing
-- ============================================================================
-- Everything else in this body is verbatim from
-- create-subscription-early-closure-recalculation.sql: the same row lock, the
-- same bounds, the same forward-5% GST convention, the same ledger backfill for
-- pre-partial-payment subscriptions, the same deliberate refusal to touch
-- status / pause credits / misc_charge / amount_paid / balance_due.

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
  v_sub               public.subscriptions;
  v_payment           public.payments;
  v_current_end       DATE;
  v_min_end           DATE;
  v_max_end           DATE;
  v_new_tax           NUMERIC(10,2);
  v_new_total         NUMERIC(10,2);
  v_new_total_days    INTEGER;
  v_total_paid        NUMERIC(12,2);
  v_settlement        NUMERIC(12,2);
  v_history           public.subscription_recalculation_history;
  v_updated_sub       public.subscriptions;
  v_updated_pay       public.payments;
  -- NEW: the concession being cleared, captured for the audit trail.
  v_discount_before   NUMERIC(10,2);
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

  -- The INVOICE's discount is the authoritative "before" figure: it is the one
  -- that was actually rendering a stale row to the customer. Falls back to the
  -- subscription's copy, then 0, so a row written before either column existed
  -- still records something meaningful.
  v_discount_before := COALESCE(v_payment.discount_amount, v_sub.discount_amount, 0);

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
  --
  -- NOTE on a discounted subscription: payments.base_amount is stored NET of the
  -- discount, so this bound is the DISCOUNTED taxable value — a tighter ceiling
  -- than the plan's list base. That is the safe direction (it cannot be used to
  -- raise a price), and it is why the dialog must tell the admin a discount is
  -- in play; see RecalculateTenureDialog.
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

  -- GST — FORWARD 5% on the new base charge (see the original script's header
  -- note: deliberately the opposite direction from onboarding's reverse-inclusive
  -- calculation).
  v_new_tax := ROUND(p_new_base_amount * 0.05, 2);

  -- misc_charge is untouched and carried forward unchanged into the new total,
  -- per the confirmed decision that recalculation never edits it. No discount
  -- term appears here: the new total is exactly what the admin typed, plus GST
  -- and the carried-forward misc charge.
  v_new_total := p_new_base_amount + v_new_tax + p_new_delivery_charge
                 + COALESCE(v_sub.misc_charge, 0);

  v_new_total_days := (p_new_end_date - v_sub.starts_on) + 1;

  -- ── Backfill a ledger row for a pre-partial-payment subscription ─────────
  -- See the original script's header note "CRITICAL SUBTLETY". Without this, a
  -- subscription that was paid in full at onboarding (no ledger rows, per the
  -- partial-payment feature's design) would have its settlement computed here
  -- but silently never projected onto payments.balance_due/status, because
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
  -- Deliberately independent of discount_amount: the customer paid real money
  -- (the ledger) against a real new price (what the admin typed), so clearing a
  -- discount cannot move this figure.
  v_settlement := v_new_total - v_total_paid;

  -- ── Apply: subscription dates/total, and clear the discount ──────────────
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
         total_payable      = v_new_total,
         discount_amount    = 0
   WHERE id = p_subscription_id
  RETURNING * INTO v_updated_sub;

  -- ── Apply: invoice breakup columns, and clear the discount ───────────────
  -- amount_paid / balance_due / status are intentionally NOT set here — the
  -- action layer re-projects them from the ledger via
  -- syncInvoicePaymentProjection immediately after this RPC succeeds, so the
  -- ledger stays the single source of truth for "how much has actually moved".
  --
  -- Clearing discount_amount restores the invoice identity
  --   base_amount + tax_amount + delivery_charge + misc_charge = amount
  -- with no discount rows rendered, which is the truth after a from-scratch
  -- re-price.
  UPDATE public.payments
     SET base_amount      = p_new_base_amount,
         tax_amount       = v_new_tax,
         delivery_charge  = p_new_delivery_charge,
         amount           = v_new_total,
         discount_amount  = 0
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
    discount_amount_before, discount_amount_after,
    amount_paid_at_recalculation, settlement_amount,
    recalculated_on, created_by
  ) VALUES (
    p_subscription_id, v_sub.customer_profile_id,
    v_current_end, p_new_end_date,
    v_sub.total_payable, v_new_total,
    v_payment.base_amount, p_new_base_amount,
    v_payment.delivery_charge, p_new_delivery_charge,
    v_new_tax,
    v_discount_before, 0,
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
    'settlement_amount', v_settlement,
    -- Echoed so the confirmation UI can tell the admin the concession was
    -- cleared, without a second round trip.
    'discount_cleared', v_discount_before
  );
END;
$$;

-- ============================================================================
-- DONE. recalculate_subscription_tenure() now clears a stale manual discount on
-- both the subscription and its invoice, and records what was cleared in
-- subscription_recalculation_history.discount_amount_before. All other
-- behaviour, including the settlement figure, is byte-for-byte unchanged.
-- ============================================================================
