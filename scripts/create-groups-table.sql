-- ============================================================================
-- MULTI-TENANT FRANCHISE — Groups Table (SAFE: Additive only)
-- ============================================================================
-- Task 1.1 — Requirements 2.1, 2.2, 2.4.
--
-- Introduces the `groups` table for the franchise hierarchy. A Group is a
-- tenant-level grouping that owns exactly one Kitchen and lives within one City.
--
-- Creates:
--   1. groups                (new) — franchise grouping; City-scoped, owns one Kitchen
--
-- Enforces:
--   - groups.name CHECK        (1..100 after trim — Req 2.1)
--   - groups.city_id NOT NULL  REFERENCES cities(id) (Req 2.4)
--   - groups.kitchen_id        NOT NULL UNIQUE REFERENCES kitchens(id) — the
--                              NOT NULL + UNIQUE pair enforces the Group<->Kitchen
--                              1:1 relationship (Req 2.2).
--
-- GROUP <-> KITCHEN 1:1 (Req 2.2): kitchen_id is NOT NULL (a Group must own a
-- Kitchen) and UNIQUE (no two Groups may share the same Kitchen). Together these
-- guarantee each Group has exactly one Kitchen and each Kitchen belongs to at
-- most one Group.
--
-- NO kitchens.group_id COLUMN (deliberate): The ownership FK lives on the Group
-- side (groups.kitchen_id), NOT on kitchens. This keeps Core kitchens that have
-- no Group completely untouched — no new column, no backfill, no production
-- impact on the existing kitchens table.
--
-- Safety: Brand new table; no existing data is dropped or altered. The script is
-- idempotent (re-runnable) via IF NOT EXISTS guards.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.groups;
-- ============================================================================

-- ============================================================================
-- 1. GROUPS (new) — Requirement 2 — City-scoped grouping that owns one Kitchen
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 100),  -- 1..100 after trim (Req 2.1)
  city_id    UUID NOT NULL REFERENCES public.cities(id),       -- Group lives in one City (Req 2.4)
  -- NOT NULL + UNIQUE together enforce the Group<->Kitchen 1:1: a Group has
  -- exactly one Kitchen and no Kitchen is shared by two Groups (Req 2.2).
  kitchen_id UUID NOT NULL UNIQUE REFERENCES public.kitchens(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_groups_city ON public.groups(city_id);

-- ============================================================================
-- DONE. New table is additive. The Group<->Kitchen 1:1 is enforced by the
-- NOT NULL + UNIQUE constraint on groups.kitchen_id. No kitchens.group_id column
-- is added, so Core kitchens with no Group are untouched.
-- ============================================================================
