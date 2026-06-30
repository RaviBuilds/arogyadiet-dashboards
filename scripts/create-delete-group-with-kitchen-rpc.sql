-- ============================================================================
-- MULTI-TENANT FRANCHISE — Atomic Group + Kitchen Deletion RPC (SAFE)
-- ============================================================================
-- Defines delete_group_with_kitchen(p_group_id): the AUTHORITATIVE,
-- single-transaction path that deletes a Group together with the single Kitchen
-- it owns (Task 5.2, Requirements 2.7, 2.8).
--
-- A plpgsql function body runs inside a single implicit transaction, so the
-- dependency guard, the group DELETE, and the kitchen DELETE either commit
-- together or roll back together. On any RAISE EXCEPTION nothing is deleted —
-- the Group and its Kitchen are left intact (Req 2.7, 2.8).
--
-- What it does, in order, within one transaction:
--   1. Dependency guard (Req 2.8): if ANY franchise references this group via
--      franchises.group_id →
--        RAISE EXCEPTION 'group has associated franchises'
--      Run FIRST so a guarded group is never partially torn down.
--   2. Capture the group's owned kitchen_id:
--        SELECT kitchen_id FROM groups WHERE id = p_group_id
--      If the group does not exist (NOT FOUND) the function is a no-op and
--      RETURNs (idempotent — re-running a completed delete is safe).
--   3. DELETE the group FIRST — it carries the FK to kitchens
--      (groups.kitchen_id), so the group row must go before its kitchen.
--   4. DELETE the now-unreferenced kitchen.
--
-- RUN-ORDER / SAFETY (why group-before-kitchen): groups.kitchen_id is a NOT NULL
-- FK into kitchens. Deleting the kitchen first would violate that FK while the
-- group still points at it. Deleting the group first releases the reference,
-- after which the kitchen can be removed cleanly.
--
-- SECURITY DEFINER: the function is invoked by the service-role admin client
-- (createAdminClient) from the deleteGroup Server Action after the action has
-- authorized the caller (full_network scope). Running as DEFINER keeps the
-- atomic deletion behaving consistently regardless of the caller's row-level
-- privileges, mirroring the pattern in create-move-franchise-to-group-rpc.sql.
--
-- Safety: creates/replaces a function only; alters no table. It deletes rows
-- ONLY when invoked and ONLY after the no-franchises guard passes. Idempotent
-- (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- RUN ORDER (IMPORTANT): run this AFTER scripts/create-groups-table.sql and
-- scripts/add-group-id-to-franchises.sql (the groups table and
-- franchises.group_id must already exist).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.delete_group_with_kitchen(uuid);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delete_group_with_kitchen(
  p_group_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_franchise_count integer;
  v_kitchen_id      uuid;
BEGIN
  -- 1. Dependency guard FIRST (Req 2.8): refuse to delete a Group that still
  --    has Franchises pointing at it. Nothing is deleted on this path.
  SELECT count(*)
    INTO v_franchise_count
    FROM public.franchises f
   WHERE f.group_id = p_group_id;

  IF v_franchise_count > 0 THEN
    RAISE EXCEPTION 'group has associated franchises';
  END IF;

  -- 2. Capture the owned kitchen_id. If the group is gone already, no-op so the
  --    operation stays idempotent.
  SELECT g.kitchen_id
    INTO v_kitchen_id
    FROM public.groups g
   WHERE g.id = p_group_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- 3. Delete the group FIRST — it holds the NOT NULL FK to kitchens, so it
  --    must be removed before the kitchen it references (Req 2.7).
  DELETE FROM public.groups
   WHERE id = p_group_id;

  -- 4. Delete the now-unreferenced owned kitchen (Req 2.7).
  DELETE FROM public.kitchens
   WHERE id = v_kitchen_id;
END;
$$;

-- ============================================================================
-- DONE. delete_group_with_kitchen is the authoritative atomic group+kitchen
-- deletion path. Invoke it from the deleteGroup Server Action via
-- createAdminClient().rpc("delete_group_with_kitchen", { ... }).
-- ============================================================================
