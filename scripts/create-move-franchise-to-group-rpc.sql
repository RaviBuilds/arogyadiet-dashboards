-- ============================================================================
-- MULTI-TENANT FRANCHISE — Atomic Franchise → Group Move RPC (SAFE)
-- ============================================================================
-- Defines move_franchise_to_group(p_franchise_id, p_dest_group_id): the
-- AUTHORITATIVE, single-transaction path that moves a franchise from its
-- current group to a destination group WITHIN THE SAME CITY, returning the
-- destination group's kitchen_id (Task 1.6, Requirements 5.1–5.5).
--
-- A plpgsql function body runs inside a single implicit transaction, so the
-- validation and the single UPDATE either commit together or roll back
-- together. On any RAISE EXCEPTION the franchise's group_id is left unchanged.
--
-- What it does, in order, within one transaction:
--   1. Resolve the SOURCE city from the franchise's current group:
--        SELECT g.city_id FROM franchises f JOIN groups g ON g.id = f.group_id
--         WHERE f.id = p_franchise_id
--   2. Resolve the DESTINATION city + kitchen from the target group:
--        SELECT g.city_id, g.kitchen_id FROM groups g WHERE g.id = p_dest_group_id
--   3. If the destination group does not exist (dest city IS NULL) →
--        RAISE EXCEPTION 'destination group not found'            (Req 5.3)
--   4. If source city IS DISTINCT FROM destination city →
--        RAISE EXCEPTION 'inter-group move allowed only within the same city'
--                                                                  (Req 5.2)
--   5. Otherwise re-point the franchise to the destination group and RETURN
--        the destination group's kitchen_id:
--        UPDATE franchises SET group_id = p_dest_group_id WHERE id = p_franchise_id
--                                                                  (Req 5.4)
--
-- CRITICAL — TENANT DATA IS PRESERVED (Req 5.5): this function scopes its only
-- write to franchises.group_id. It MUST NOT (and does NOT) touch clinics,
-- rider_service_areas, or any other tenant rows. Because only the group_id
-- changes, the franchise_id is stable and all downstream wiring — clinic
-- linkage and pincode/service-area assignments — is preserved across the move.
--
-- SECURITY DEFINER: the function is invoked by the service-role admin client
-- (createAdminClient) from the moveFranchiseToGroup Server Action after the
-- action has authorized the caller and validated inputs. Running as DEFINER
-- keeps the atomic move behaving consistently regardless of the caller's
-- row-level privileges, mirroring the pattern in create-move-pincode-rpc.sql.
--
-- Safety: additive only — creates/replaces a function, alters no table and
-- drops no data. Idempotent (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.move_franchise_to_group(uuid, uuid);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.move_franchise_to_group(
  p_franchise_id   uuid,
  p_dest_group_id  uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source_city_id  uuid;
  v_dest_city_id    uuid;
  v_dest_kitchen_id uuid;
BEGIN
  -- 1. Resolve the SOURCE city via the franchise's current group.
  SELECT g.city_id
    INTO v_source_city_id
    FROM public.franchises f
    JOIN public.groups g ON g.id = f.group_id
   WHERE f.id = p_franchise_id;

  -- 2. Resolve the DESTINATION city + kitchen from the target group.
  SELECT g.city_id, g.kitchen_id
    INTO v_dest_city_id, v_dest_kitchen_id
    FROM public.groups g
   WHERE g.id = p_dest_group_id;

  -- 3. Destination group must exist (Req 5.3).
  IF v_dest_city_id IS NULL THEN
    RAISE EXCEPTION 'destination group not found';
  END IF;

  -- 4. Inter-group moves are permitted only within the same city (Req 5.2).
  IF v_source_city_id IS DISTINCT FROM v_dest_city_id THEN
    RAISE EXCEPTION 'inter-group move allowed only within the same city';
  END IF;

  -- 5. Re-point ONLY the franchise's group_id; tenant rows (clinics,
  --    rider_service_areas, pincodes) are untouched so franchise_id, clinic
  --    wiring, and pincodes are preserved (Req 5.4, 5.5).
  UPDATE public.franchises
     SET group_id = p_dest_group_id
   WHERE id = p_franchise_id;

  RETURN v_dest_kitchen_id;
END;
$$;

-- ============================================================================
-- DONE. move_franchise_to_group is the authoritative atomic franchise-move path.
-- Invoke it from the moveFranchiseToGroup Server Action via
-- createAdminClient().rpc("move_franchise_to_group", { ... }).
-- ============================================================================
