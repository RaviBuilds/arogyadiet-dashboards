-- ============================================================================
-- FRANCHISE INVENTORY — Atomic Provision Franchise Inventory RPC (SAFE)
-- ============================================================================
-- Spec: franchise-inventory — Task 3.1 — Requirements 1.1, 1.4, 1.5, 1.6
--
-- Defines provision_franchise_inventory(p_franchise_id): the AUTHORITATIVE,
-- single-transaction path that provisions exactly one franchise_inventories
-- row for a given franchise. Intended to be called inside the
-- franchise-creation transaction so that no franchise is persisted without
-- an associated inventory (Req 1.1, 1.5).
--
-- A plpgsql function body runs inside a single implicit transaction, so if
-- this function is called within a broader transaction (e.g. franchise
-- creation), a RAISE EXCEPTION here will abort the entire parent transaction,
-- ensuring no franchise exists without an inventory (Req 1.5).
--
-- What it does, in order, within one transaction:
--   1. INSERT INTO franchise_inventories (franchise_id) VALUES (p_franchise_id)
--      ON CONFLICT (franchise_id) DO NOTHING.
--      - If the franchise has no inventory yet, a new row is created (Req 1.1).
--      - If the franchise already has an inventory, the ON CONFLICT clause
--        makes this a no-op — idempotent (Req 1.4).
--      - Under concurrent requests, the UNIQUE(franchise_id) constraint
--        serializes inserts so exactly one inventory is created (Req 1.6).
--   2. SELECT the franchise_inventories row for p_franchise_id (existing or
--      newly created) and RETURN it.
--
-- SECURITY DEFINER: the function is invoked by the service-role admin client
-- (createAdminClient) from the createFranchise Server Action after the action
-- has authorized the caller and validated inputs. Running as DEFINER keeps the
-- provisioning behaving consistently regardless of the caller's row-level
-- privileges, mirroring create-group-with-kitchen-rpc.sql and
-- create-transfer-stock-rpc.sql.
--
-- Safety: additive only — creates/replaces a function, alters no table and
-- drops no data. Idempotent (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- ORDERING REQUIREMENT: This file MUST run AFTER
-- create-franchise-inventories-table.sql (provides franchise_inventories).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.provision_franchise_inventory(uuid);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.provision_franchise_inventory(
  p_franchise_id uuid
)
RETURNS SETOF public.franchise_inventories
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- 1. Insert a new inventory row for this franchise. ON CONFLICT makes
  --    provisioning idempotent (Req 1.4) and concurrency-safe (Req 1.6) —
  --    the UNIQUE(franchise_id) constraint guarantees at most one row per
  --    franchise regardless of concurrent execution.
  INSERT INTO public.franchise_inventories (franchise_id)
  VALUES (p_franchise_id)
  ON CONFLICT (franchise_id) DO NOTHING;

  -- 2. Return the franchise_inventories row (existing or newly created).
  --    Using RETURN QUERY ensures we always return the row even when the
  --    INSERT was a no-op due to ON CONFLICT.
  RETURN QUERY
    SELECT *
      FROM public.franchise_inventories
     WHERE franchise_id = p_franchise_id;
END;
$$;

-- ============================================================================
-- DONE. provision_franchise_inventory is the authoritative atomic
-- franchise-inventory provisioning path. Invoke it from the createFranchise
-- Server Action via createAdminClient().rpc("provision_franchise_inventory",
-- { p_franchise_id: franchiseId }).
-- Run only AFTER create-franchise-inventories-table.sql.
-- ============================================================================
