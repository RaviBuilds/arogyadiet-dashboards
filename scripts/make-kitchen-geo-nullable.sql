-- ============================================================================
-- MAKE KITCHEN GEO NULLABLE (SAFE: relaxes constraints only)
-- ============================================================================
-- Spec: multi-tenant-franchise (and core-clinic-architecture follow-up)
--
-- WHY: The Business → Kitchen → Clinic model moved geo OFF the Kitchen — the
-- rider pickup / routing origin now lives ONLY on the Clinic. A Kitchen is a
-- meal-prep / workload-aggregation entity with NO address or coordinates.
--
-- However, the legacy `kitchens` table still has `lat` and `lng` as
-- NUMERIC NOT NULL columns with no default. So any NEW kitchen created without
-- coordinates fails with:
--     null value in column "lat" of relation "kitchens" violates not-null constraint
-- This blocks BOTH:
--   - franchise Group creation (create_group_with_kitchen inserts a geoless kitchen), and
--   - creating a new Core kitchen from the Master "Core Business" UI (no geo fields).
--
-- FIX: make `lat` and `lng` NULLABLE. This is purely a constraint relaxation:
--   - Existing kitchen rows keep their current coordinate values, untouched.
--   - New kitchens may be inserted with NULL lat/lng (the intended geoless model).
--   - The deprecated columns are NOT dropped (additive safety); they are simply
--     no longer required and no longer read as a routing origin.
--
-- Safety: relaxing NOT NULL never invalidates existing data. Idempotent —
-- DROP NOT NULL is a no-op when the column is already nullable, so this is safe
-- to re-run.
--
-- Rollback (only if every kitchen row has non-null lat/lng):
--   ALTER TABLE public.kitchens ALTER COLUMN lat SET NOT NULL;
--   ALTER TABLE public.kitchens ALTER COLUMN lng SET NOT NULL;
-- ============================================================================

ALTER TABLE public.kitchens ALTER COLUMN lat DROP NOT NULL;
ALTER TABLE public.kitchens ALTER COLUMN lng DROP NOT NULL;

-- ============================================================================
-- DONE. New kitchens (franchise Groups and new Core kitchens) can now be
-- created without coordinates. Geo lives on the Clinic, not the Kitchen.
-- ============================================================================
