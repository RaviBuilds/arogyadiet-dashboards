-- ============================================================================
-- STAY EXTENSION HISTORY (SAFE: Additive only)
-- ============================================================================
-- Requirements: extend-stay-history (chat-driven addition to
-- accommodation-payment-lifecycle) — record one row per Stay_Extension so the
-- Accommodation tab can show an extension history list, the way
-- stay_payment_transactions already backs the Payment History list.
--
-- WHY A NEW TABLE RATHER THAN REUSING stay_payment_transactions: a
-- Stay_Extension is deliberately NOT a Payment_Transaction (Req 11.2 in
-- create-stay-payment-lifecycle.sql — "No Payment_Transaction ledger row is
-- written for the extension cost"). Total_Paid must never move just because a
-- stay was extended; only Total_Stay_Amount does. Recording the extension in
-- the payment ledger would silently break that invariant (the ledger's
-- Total_Paid formula sums every row in stay_payment_transactions). A separate,
-- purely informational history table keeps the ledger's invariant intact while
-- still giving admins a record of every extension applied.
--
-- Creates:
--   1. stay_extension_history table (new) — one row per Stay_Extension,
--      capturing the nights added, the amount folded into Total_Stay_Amount,
--      and the stay's nights/total immediately before and after
--   2. record_stay_extension() — row-locked helper mirroring
--      record_stay_payment_transaction()'s lock discipline: the same
--      SELECT ... FOR UPDATE that stayRepository.extendStay() already takes
--      inside AccommodationService.extendStay() covers this insert too, so
--      this function is called from WITHIN that existing lock rather than
--      re-acquiring it — see the "Concurrency" note below.
--
-- Backfill: existing Stay_Extensions applied before this migration have no
-- history row — the running total on the stay itself is unaffected, only the
-- history LIST starts from the migration date forward. This script writes no
-- data rows at all (design decision mirrors create-accommodation-tables.sql).
--
-- RLS: This script does NOT enable or alter RLS. Follows the stay_entries /
-- stay_payment_transactions precedent — all access is through Server Actions
-- using the service-role admin client, with admin-group authorisation enforced
-- in the action layer (getCurrentAdminContext).
--
-- Concurrency: stayRepository.extendStay() (create-stay-payment-lifecycle.sql
-- companion, task 4.2) currently does a plain UPDATE, not a row-locked RPC —
-- unlike record_stay_payment_transaction(). This script does not change that;
-- it only adds a plain insert function callable from the same service-layer
-- call site, immediately after the existing extendStay() update, so the two
-- writes land together without requiring a new database transaction wrapper
-- in the Node layer. If stayRepository.extendStay() is ever moved behind its
-- own row lock, this insert should move inside that lock too.
--
-- ORDERING: This script MUST run AFTER:
--   - create-accommodation-tables.sql (public.stay_entries)
--   - create-stay-payment-lifecycle.sql (establishes the ledger precedent this
--     table deliberately does NOT join)
--   - public.customer_profiles and public.users exist
--
-- Safety: One brand new table + one new function. No table is dropped, no
-- column is removed, no existing row is read or rewritten. Idempotent
-- (re-runnable) via CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS,
-- and CREATE OR REPLACE FUNCTION.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.record_stay_extension(uuid, uuid, integer, integer, integer, numeric, numeric, numeric, uuid);
--   DROP TABLE IF EXISTS public.stay_extension_history;
-- ============================================================================

-- ============================================================================
-- 1. STAY EXTENSION HISTORY TABLE
-- ============================================================================
-- One row per Stay_Extension, in the order applied. Purely informational —
-- nothing reads this table to derive a balance; Total_Stay_Amount continues to
-- live only on stay_entries.payment_amount (single source of truth, per
-- create-stay-payment-lifecycle.sql's header note).

CREATE TABLE IF NOT EXISTS public.stay_extension_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_entry_id UUID NOT NULL REFERENCES public.stay_entries(id) ON DELETE CASCADE,
  customer_profile_id UUID NOT NULL REFERENCES public.customer_profiles(id),
  additional_nights INTEGER NOT NULL CHECK (additional_nights > 0),
  additional_amount NUMERIC(10,2) NOT NULL CHECK (additional_amount > 0),
  nights_before INTEGER NOT NULL,
  nights_after INTEGER NOT NULL,
  total_amount_before NUMERIC(10,2),
  total_amount_after NUMERIC(10,2) NOT NULL,
  extended_on DATE NOT NULL,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Chronological history per stay, matching the Payment History list's
-- ordering convention (idx_stay_payment_tx_stay).
CREATE INDEX IF NOT EXISTS idx_stay_extension_history_stay
  ON public.stay_extension_history(stay_entry_id, created_at);

CREATE INDEX IF NOT EXISTS idx_stay_extension_history_customer
  ON public.stay_extension_history(customer_profile_id);

-- ============================================================================
-- 2. RECORD FUNCTION
-- ============================================================================
-- Plain insert, no row lock of its own — see the "Concurrency" header note.
-- Returns the inserted row as jsonb so the repository can map it straight
-- into the typed domain shape without a second round trip.

CREATE OR REPLACE FUNCTION public.record_stay_extension(
  p_stay_entry_id       UUID,
  p_customer_profile_id UUID,
  p_additional_nights   INTEGER,
  p_nights_before       INTEGER,
  p_nights_after        INTEGER,
  p_additional_amount   NUMERIC,
  p_total_amount_before NUMERIC,
  p_total_amount_after  NUMERIC,
  p_extended_on         DATE,
  p_created_by          UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.stay_extension_history;
BEGIN
  INSERT INTO public.stay_extension_history (
    stay_entry_id, customer_profile_id, additional_nights,
    nights_before, nights_after,
    additional_amount, total_amount_before, total_amount_after,
    extended_on, created_by
  ) VALUES (
    p_stay_entry_id, p_customer_profile_id, p_additional_nights,
    p_nights_before, p_nights_after,
    p_additional_amount, p_total_amount_before, p_total_amount_after,
    p_extended_on, p_created_by
  )
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'extension', to_jsonb(v_row));
END;
$$;

-- ============================================================================
-- DONE.
-- stay_extension_history is a purely informational record of every
-- Stay_Extension applied. It has no bearing on Total_Paid or
-- Remaining_Balance — those continue to be derived exclusively from
-- stay_payment_transactions against stay_entries.payment_amount, unchanged by
-- this migration. Insert only through
--   createAdminClient().rpc("record_stay_extension", { ... })
-- from the AccommodationService.extendStay() call site, immediately after
-- stayRepository.extendStay() succeeds. Run only AFTER
-- create-accommodation-tables.sql and create-stay-payment-lifecycle.sql.
-- ============================================================================
