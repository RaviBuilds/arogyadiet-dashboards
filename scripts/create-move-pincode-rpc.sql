-- ============================================================================
-- CORE CLINIC ARCHITECTURE — Atomic Pincode Move + Reassignment RPC (SAFE)
-- ============================================================================
-- Defines move_pincode_and_reassign(p_pincode, p_from_clinic, p_to_clinic):
-- the AUTHORITATIVE, single-transaction path that moves a pincode from one
-- Clinic to another and re-stamps the affected customers and their PRIMARY
-- addresses (Requirements 4.4, 4.5, 5.7, 7.1, 7.2, 7.3).
--
-- A plpgsql function body runs inside a single implicit transaction, so all
-- three writes either commit together or roll back together. On failure the
-- pincode remains associated only with the source Clinic and every affected
-- customer/address clinic stamp is left unchanged (Req 4.4, 7.5).
--
-- What it does, in order, within one transaction:
--   1. Move the service area:
--        UPDATE rider_service_areas SET clinic_id = p_to_clinic
--        WHERE pincode = p_pincode AND clinic_id = p_from_clinic
--   2. Reassign matching customers (BEFORE addresses are re-stamped, so the
--      address scope still matches the source clinic). Keyed on the customer's
--      PRIMARY address (is_primary = true):
--        UPDATE customer_profiles SET clinic_id = p_to_clinic
--        WHERE clinic_id = p_from_clinic
--          AND id IN (customers whose PRIMARY address carries the moved
--                     pincode + source clinic)
--      The count of reassigned customers is captured here and RETURNed.
--   3. Reassign matching PRIMARY addresses:
--        UPDATE addresses SET clinic_id = p_to_clinic
--        WHERE is_primary = true AND pincode = p_pincode
--          AND clinic_id = p_from_clinic
--
-- PRIMARY-ADDRESS KEYING (Req 7.1, 7.2): both the customer subquery and the
-- address re-stamp filter is_primary = true. A customer is reassigned ONLY when
-- their primary address carries the moved pincode and is stamped to the source
-- clinic; secondary addresses never trigger a move and are never re-stamped.
--
-- Returns: the integer count of customers reassigned (0 when none match, Req 7.3).
--
-- CRITICAL — IMMUTABLE ORDER/BATCH STAMPS (Req 19.4): this function scopes its
-- writes to rider_service_areas, customer_profiles, and addresses ONLY. It MUST
-- NOT (and does NOT) update delivery_orders.clinic_id or
-- delivery_batches.clinic_id — those order/batch clinic stamps are recorded at
-- creation time and are immutable history. A customer moving between clinics
-- never re-attributes their prior orders/batches.
--
-- SECURITY DEFINER: the function is invoked by the service-role admin client
-- (createAdminClient) from the movePincode Server Action after the action has
-- authorized the caller (ADMIN / MASTER_ADMIN) and validated inputs. Running as
-- DEFINER keeps the atomic move behaving consistently regardless of the
-- caller's row-level privileges, mirroring the session-helper pattern in
-- create-clinic-hierarchy-tables.sql.
--
-- Safety: additive only — creates/replaces a function, alters no table and
-- drops no data. Idempotent (re-runnable) via CREATE OR REPLACE FUNCTION.
--
-- Rollback:
--   DROP FUNCTION IF EXISTS public.move_pincode_and_reassign(text, uuid, uuid);
-- ============================================================================

CREATE OR REPLACE FUNCTION public.move_pincode_and_reassign(
  p_pincode      text,
  p_from_clinic  uuid,
  p_to_clinic    uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reassigned integer := 0;
BEGIN
  -- No-op move: nothing to do, zero reassigned.
  IF p_from_clinic IS NOT DISTINCT FROM p_to_clinic THEN
    RETURN 0;
  END IF;

  -- 1. Move the service-area association from source to destination clinic.
  UPDATE public.rider_service_areas
     SET clinic_id = p_to_clinic
   WHERE pincode = p_pincode
     AND clinic_id = p_from_clinic;

  -- 2. Reassign the affected customers and capture the count. Scoped to the
  --    source clinic so only genuinely-affected customers move, and keyed on the
  --    customer's PRIMARY address (is_primary = true) so only customers whose
  --    primary address carries the moved pincode are reassigned — secondary
  --    addresses never trigger a reassignment (Req 7.1). Done BEFORE the address
  --    re-stamp so the matching-address subquery still sees the source clinic_id.
  WITH affected AS (
    UPDATE public.customer_profiles cp
       SET clinic_id = p_to_clinic
     WHERE cp.clinic_id = p_from_clinic
       AND cp.id IN (
         SELECT a.customer_profile_id
           FROM public.addresses a
          WHERE a.is_primary = true
            AND a.pincode = p_pincode
            AND a.clinic_id = p_from_clinic
            AND a.customer_profile_id IS NOT NULL
       )
    RETURNING cp.id
  )
  SELECT count(*)::integer INTO v_reassigned FROM affected;

  -- 3. Re-stamp the matching PRIMARY address records to the destination clinic.
  --    Only primary addresses (is_primary = true) are re-stamped so the address
  --    stamp stays anchored to the customer's primary address (Req 7.2);
  --    secondary addresses are left untouched.
  UPDATE public.addresses
     SET clinic_id = p_to_clinic
   WHERE is_primary = true
     AND pincode = p_pincode
     AND clinic_id = p_from_clinic;

  -- NOTE: delivery_orders.clinic_id / delivery_batches.clinic_id are NEVER
  -- touched here — order/batch stamps are immutable creation-time history (Req 19.4).

  RETURN v_reassigned;
END;
$$;

-- ============================================================================
-- DONE. move_pincode_and_reassign is the authoritative atomic move path.
-- Invoke it from the movePincode Server Action via
-- createAdminClient().rpc("move_pincode_and_reassign", { ... }).
-- ============================================================================
