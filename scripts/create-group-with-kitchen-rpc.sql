-- ============================================================================
-- MULTI-TENANT FRANCHISE — Atomic Group + Kitchen Creation RPC (SAFE)
-- ============================================================================
-- Defines create_group_with_kitchen(p_city_id, p_group_name, p_kitchen_name):
-- the AUTHORITATIVE, single-transaction path that creates a Group together with
-- the single Kitchen it owns, returning the new group id (Task 5.2,
-- Requirements 2.3, 2.5, 2.6).
--
-- A plpgsql function body runs inside a single implicit transaction, so the
-- city lookup, the kitchen INSERT, and the group INSERT either commit together
-- or roll back together. On any RAISE EXCEPTION nothing is persisted — no
-- orphan Kitchen is left behind without its owning Group (Req 2.3).
--
-- What it does, in order, within one transaction:
--   1. Resolve the owning Business from the City:
--        SELECT c.business_id FROM cities c WHERE c.id = p_city_id
--      If the city does not exist (NOT FOUND) →
--        RAISE EXCEPTION 'city not found'                         (Req 2.6)
--      (business_id may itself be NULL when the City is not yet wired to a
--       Business; that is carried through to the Kitchen as-is, since
--       kitchens.business_id is nullable.)
--   2. INSERT the owned Kitchen (business_id := the city's business_id,
--      city_id := p_city_id, name := p_kitchen_name) returning its id. The
--      Kitchen carries NO geo — no address, latitude, or longitude — because
--      the geographic routing origin always lives on the Clinic (Req 2.5).
--   3. INSERT the Group (city_id := p_city_id, name := p_group_name,
--      kitchen_id := the new kitchen id). The Group<->Kitchen 1:1 is enforced
--      by the NOT NULL + UNIQUE constraint on groups.kitchen_id.
--   4. RETURN the new group id.
--
-- SECURITY DEFINER: the function is invoked by the service-role admin client
-- (createAdminClient) from the createGroup Server Action after the action has
-- authorized the caller (full_network scope) and validated inputs. Running as
-- DEFINER keeps the atomic creation behaving consistently regardless of the
-- caller's row-level privileges, mirroring the pattern in
-- create-move-franchise-to-group-rpc.sql.
--
-- Safety: additive only — creates/replaces a function, alters no table and
-- drops no data. Idempotent (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- RUN ORDER (IMPORTANT): run this AFTER scripts/create-groups-table.sql and
-- scripts/add-group-id-to-franchises.sql (the groups table and cities.business_id
-- must already exist).
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.create_group_with_kitchen(uuid, text, text);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_group_with_kitchen(
  p_city_id      uuid,
  p_group_name   text,
  p_kitchen_name text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_kitchen_id  uuid;
  v_group_id    uuid;
BEGIN
  -- 1. Resolve the owning Business from the City. NOT FOUND means the city does
  --    not exist; abort so nothing is created (Req 2.6).
  SELECT c.business_id
    INTO v_business_id
    FROM public.cities c
   WHERE c.id = p_city_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'city not found';
  END IF;

  -- 2. Create the single owned Kitchen. NO geo (address/lat/lng) — the routing
  --    origin always lives on the Clinic (Req 2.5). business_id is carried from
  --    the City as-is (kitchens.business_id is nullable).
  INSERT INTO public.kitchens (name, business_id, city_id)
  VALUES (p_kitchen_name, v_business_id, p_city_id)
  RETURNING id INTO v_kitchen_id;

  -- 3. Create the Group pointing at its new Kitchen. The NOT NULL + UNIQUE
  --    constraint on groups.kitchen_id enforces the Group<->Kitchen 1:1.
  INSERT INTO public.groups (city_id, name, kitchen_id)
  VALUES (p_city_id, p_group_name, v_kitchen_id)
  RETURNING id INTO v_group_id;

  -- 4. Return the new group id.
  RETURN v_group_id;
END;
$$;

-- ============================================================================
-- DONE. create_group_with_kitchen is the authoritative atomic group+kitchen
-- creation path. Invoke it from the createGroup Server Action via
-- createAdminClient().rpc("create_group_with_kitchen", { ... }).
-- ============================================================================
