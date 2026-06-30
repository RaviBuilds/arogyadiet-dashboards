-- ============================================================================
-- MULTI-TENANT FRANCHISE — Group association for Franchises + Business for
-- Cities (SAFE: Additive only)  [Spec: multi-tenant-franchise, Task 1.2]
-- ============================================================================
-- Wires the Franchise into the multi-tenant hierarchy by associating it with a
-- Group, and associates each City with a Business. Both links are nullable so
-- this migration is purely additive with zero production impact (Req 1.1, 3.1,
-- 3.4).
--
-- RUN ORDER (IMPORTANT): This file MUST run AFTER scripts/create-groups-table.sql.
-- The public.groups table must already exist for the franchises.group_id foreign
-- key below to resolve. Likewise public.businesses must exist (created by
-- scripts/create-clinic-hierarchy-tables.sql) for cities.business_id.
--
-- Adds (nullable, NULL = unassigned, zero production impact):
--   - franchises.group_id  — each Franchise belongs to (at most) one Group.
--                            NULL = not yet assigned to a Group (Req 1.1, 3.1).
--   - cities.business_id    — each City belongs to (at most) one Business.
--                            NULL = not yet assigned to a Business (Req 3.4).
--
-- Adds indexes:
--   - idx_franchises_group  ON franchises(group_id)
--   - idx_cities_business    ON cities(business_id)
--
-- Safety: All new columns are nullable and reference already-existing tables.
-- No existing data is dropped or altered. Idempotent (re-runnable) via
-- ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
--
-- RLS: This script does NOT enable RLS and does NOT alter any existing data,
-- following the established additive pattern (create-clinic-hierarchy-tables.sql).
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_franchises_group;
--   DROP INDEX IF EXISTS public.idx_cities_business;
--   ALTER TABLE public.franchises DROP COLUMN IF EXISTS group_id;
--   ALTER TABLE public.cities     DROP COLUMN IF EXISTS business_id;
-- ============================================================================

-- ============================================================================
-- DEPRECATION NOTICE — READ BEFORE EXTENDING THIS SCHEMA
-- ============================================================================
-- *** franchises.kitchen_id IS NOW DEPRECATED ***
--   The legacy franchises.kitchen_id column is left PHYSICALLY PRESENT but is
--   NO LONGER READ OR WRITTEN by application code. The Kitchen for a Franchise
--   is now resolved THROUGH THE GROUP:
--
--       Franchise --(group_id)--> Group --> Kitchen
--
--   Do NOT reintroduce reads/writes of franchises.kitchen_id. Resolve the
--   Kitchen via the Group instead. This migration intentionally does NOT drop
--   the column — physical removal is a SEPARATE, LATER cleanup step.
--
-- *** the legacy franchise_pincodes table IS NOW DEPRECATED ***
--   One-pincode-one-entity ownership now lives with rider_service_areas, backed
--   by the uq_service_area_pincode unique constraint (created in
--   create-clinic-hierarchy-tables.sql). The legacy franchise_pincodes table is
--   NO LONGER the source of truth and should NOT be read or written. As above,
--   this migration intentionally does NOT drop it — physical removal is a
--   SEPARATE, LATER cleanup step.
-- ============================================================================

-- ============================================================================
-- 1. FRANCHISES (existing) — add group_id (Req 1.1, 3.1)
-- ============================================================================
-- Each Franchise belongs to (at most) one Group. NULLABLE for a safe additive
-- rollout: NULL = not yet assigned to a Group. Requires public.groups to exist
-- (run scripts/create-groups-table.sql FIRST).

ALTER TABLE public.franchises
  ADD COLUMN IF NOT EXISTS group_id UUID NULL REFERENCES public.groups(id);

CREATE INDEX IF NOT EXISTS idx_franchises_group ON public.franchises(group_id);

-- ============================================================================
-- 2. CITIES (existing) — add business_id (Req 3.4)
-- ============================================================================
-- Each City belongs to (at most) one Business. NULLABLE for a safe additive
-- rollout: NULL = not yet assigned to a Business. Requires public.businesses to
-- exist (created by scripts/create-clinic-hierarchy-tables.sql).

ALTER TABLE public.cities
  ADD COLUMN IF NOT EXISTS business_id UUID NULL REFERENCES public.businesses(id);

CREATE INDEX IF NOT EXISTS idx_cities_business ON public.cities(business_id);

-- ============================================================================
-- DONE. Both new columns are additive and nullable. franchises.kitchen_id and
-- the franchise_pincodes table are now DEPRECATED (left physically present; no
-- longer read or written) — physical removal is a separate later cleanup. This
-- file must run AFTER create-groups-table.sql (groups must exist for the FK).
-- ============================================================================
