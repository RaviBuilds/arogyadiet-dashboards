-- ============================================================================
-- FRANCHISE INVENTORY — franchise_inventories table (SAFE: Additive only)
-- ============================================================================
-- Spec: franchise-inventory — Task 2.1 — Requirements 1.2, 1.3, 1.4, 1.6
--
-- Introduces the per-franchise inventory header. Each franchise owns exactly
-- one inventory (Req 1.3), enforced by UNIQUE(franchise_id). Provisioning is
-- idempotent under concurrency thanks to the unique constraint — a duplicate
-- INSERT simply conflicts without error when used with ON CONFLICT DO NOTHING
-- in the provisioning RPC (Req 1.4, 1.6).
--
-- An empty inventory (zero lots) satisfies Req 1.2: product count = 0 and
-- On_Hand_Quantity = 0 by definition (on-hand is computed from lot sums).
--
-- Creates:
--   1. franchise_inventories table (new) — one inventory per franchise
--   2. updated_at trigger (follows existing franchise pattern)
--
-- ORDERING: This script MUST run AFTER the franchises table exists
-- (see create-franchise-tables.sql). It references public.franchises(id).
--
-- Safety: Brand new table; nothing existing is dropped or altered.
-- Idempotent (re-runnable) via IF NOT EXISTS guards.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_franchise_inventories_updated_at ON public.franchise_inventories;
--   DROP FUNCTION IF EXISTS public.update_franchise_inventories_updated_at();
--   DROP TABLE IF EXISTS public.franchise_inventories;
-- ============================================================================

-- ============================================================================
-- 1. FRANCHISE_INVENTORIES (new) — one inventory per franchise (Req 1.3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.franchise_inventories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id UUID NOT NULL UNIQUE REFERENCES public.franchises(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. updated_at TRIGGER (franchise pattern)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_franchise_inventories_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_franchise_inventories_updated_at ON public.franchise_inventories;
CREATE TRIGGER trg_franchise_inventories_updated_at
  BEFORE UPDATE ON public.franchise_inventories
  FOR EACH ROW
  EXECUTE FUNCTION public.update_franchise_inventories_updated_at();

-- ============================================================================
-- DONE. The table is additive and isolated. Run only AFTER franchises exist.
-- ============================================================================
