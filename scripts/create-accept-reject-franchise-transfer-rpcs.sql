-- ============================================================================
-- FRANCHISE INVENTORY — accept_franchise_transfer & reject_franchise_transfer RPCs
-- (SAFE: Additive only)
-- ============================================================================
-- Spec: franchise-inventory — Task 3.3 — Requirements 7.4, 7.5, 7.6, 7.7
--
-- Defines two SECURITY DEFINER plpgsql functions for the Accept and Reject
-- transitions of the franchise stock transfer lifecycle:
--
--   accept_franchise_transfer(p_transfer_id, p_franchise_id, p_acted_by)
--     — Transitions a DISPATCHED transfer to ACCEPTED without changing on-hand.
--
--   reject_franchise_transfer(p_transfer_id, p_franchise_id, p_acted_by)
--     — Transitions a DISPATCHED transfer to REJECTED without changing on-hand.
--
-- Both functions:
--   1. SELECT the transfer WHERE id = p_transfer_id AND dest_franchise_id = p_franchise_id
--      FOR UPDATE (row-level lock prevents concurrent state transitions).
--   2. Assert that the current state is DISPATCHED; raise an exception if not
--      (Req 7.6 — wrong source state leaves transfer unchanged).
--   3. UPDATE the state to ACCEPTED/REJECTED, set the corresponding timestamp,
--      and record the acting user.
--   4. On-hand is NOT changed — stock remains in-transit (Req 7.5, 8.1).
--   5. Return the updated transfer record.
--
-- If the transfer does not exist or does not belong to the given franchise,
-- the SELECT returns NULL and the function raises (rolls back). This enforces
-- franchise-scoped access within the RPC (Req 2.6, 7.7).
--
-- SECURITY DEFINER: Invoked by the service-role admin client (createAdminClient)
-- from the franchiseInventoryActions after the action layer has authorized the
-- caller and validated inputs. Running as DEFINER ensures consistent behavior
-- regardless of row-level privileges, mirroring the transfer_stock RPC pattern.
--
-- ORDERING: This script MUST run AFTER:
--   - create-franchise-stock-transfers-tables.sql (provides franchise_stock_transfers)
--   - create-franchise-tables.sql (provides public.franchises)
--   - users table exists (public.users)
--
-- Safety: Creates/replaces functions only — no tables are dropped or altered.
-- Idempotent (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.accept_franchise_transfer(uuid, uuid, uuid);
--   DROP FUNCTION IF EXISTS public.reject_franchise_transfer(uuid, uuid, uuid);
-- ============================================================================


-- ============================================================================
-- 1. accept_franchise_transfer
-- ============================================================================
-- Transitions a transfer from DISPATCHED → ACCEPTED.
-- On-hand is NOT changed (stock remains in-transit until RECEIVED).
-- Raises on: transfer not found, transfer not owned by franchise, wrong state.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.accept_franchise_transfer(
  p_transfer_id  uuid,
  p_franchise_id uuid,
  p_acted_by     uuid
)
RETURNS SETOF public.franchise_stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer public.franchise_stock_transfers%ROWTYPE;
BEGIN
  -- 1. Lock and fetch the transfer row scoped to the destination franchise.
  SELECT *
    INTO v_transfer
    FROM public.franchise_stock_transfers
   WHERE id = p_transfer_id
     AND dest_franchise_id = p_franchise_id
   FOR UPDATE;

  -- If no row found, the transfer either doesn't exist or doesn't belong to
  -- this franchise. Raise to abort the transaction cleanly.
  IF v_transfer.id IS NULL THEN
    RAISE EXCEPTION 'Transfer not found or does not belong to this franchise';
  END IF;

  -- 2. Assert current state is DISPATCHED (Req 7.6).
  IF v_transfer.state != 'DISPATCHED' THEN
    RAISE EXCEPTION 'Transfer is not in DISPATCHED state, cannot accept';
  END IF;

  -- 3. Transition to ACCEPTED, record timestamp and actor.
  UPDATE public.franchise_stock_transfers
     SET state       = 'ACCEPTED',
         accepted_at = now(),
         acted_by    = p_acted_by
   WHERE id = p_transfer_id
  RETURNING * INTO v_transfer;

  -- 4. On-hand is NOT changed — stock stays in-transit (Req 7.5).

  -- 5. Return the updated transfer record.
  RETURN NEXT v_transfer;
  RETURN;
END;
$$;


-- ============================================================================
-- 2. reject_franchise_transfer
-- ============================================================================
-- Transitions a transfer from DISPATCHED → REJECTED (terminal state).
-- On-hand is NOT changed (rejected stock never enters the franchise inventory).
-- Raises on: transfer not found, transfer not owned by franchise, wrong state.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.reject_franchise_transfer(
  p_transfer_id  uuid,
  p_franchise_id uuid,
  p_acted_by     uuid
)
RETURNS SETOF public.franchise_stock_transfers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_transfer public.franchise_stock_transfers%ROWTYPE;
BEGIN
  -- 1. Lock and fetch the transfer row scoped to the destination franchise.
  SELECT *
    INTO v_transfer
    FROM public.franchise_stock_transfers
   WHERE id = p_transfer_id
     AND dest_franchise_id = p_franchise_id
   FOR UPDATE;

  -- If no row found, the transfer either doesn't exist or doesn't belong to
  -- this franchise. Raise to abort the transaction cleanly.
  IF v_transfer.id IS NULL THEN
    RAISE EXCEPTION 'Transfer not found or does not belong to this franchise';
  END IF;

  -- 2. Assert current state is DISPATCHED (Req 7.6).
  IF v_transfer.state != 'DISPATCHED' THEN
    RAISE EXCEPTION 'Transfer is not in DISPATCHED state, cannot reject';
  END IF;

  -- 3. Transition to REJECTED, record timestamp and actor.
  UPDATE public.franchise_stock_transfers
     SET state       = 'REJECTED',
         rejected_at = now(),
         acted_by    = p_acted_by
   WHERE id = p_transfer_id
  RETURNING * INTO v_transfer;

  -- 4. On-hand is NOT changed (Req 7.4 — rejected stock never enters inventory).

  -- 5. Return the updated transfer record.
  RETURN NEXT v_transfer;
  RETURN;
END;
$$;


-- ============================================================================
-- DONE. Both RPCs are the authoritative Accept/Reject transition path.
-- Invoke from the franchiseInventoryActions via:
--   createAdminClient().rpc("accept_franchise_transfer", { ... })
--   createAdminClient().rpc("reject_franchise_transfer", { ... })
-- Run only AFTER create-franchise-stock-transfers-tables.sql.
-- ============================================================================
