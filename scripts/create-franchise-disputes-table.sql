-- ============================================================================
-- FRANCHISE DISPUTES — franchise_disputes table (SAFE: Additive only)
-- ============================================================================
-- Spec: franchise-dispute-management — Task 1.1
-- Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9
--
-- Introduces the franchise dispute management table. Franchise owners raise
-- disputes categorized by business domain; master admins review and resolve
-- them through a linear status lifecycle: Open → Under_Investigation → Solved.
--
-- Creates:
--   1. franchise_disputes table (new) with CHECK constraints
--   2. updated_at trigger function and trigger (Req 1.9)
--   3. RLS policies for FRANCHISE_ADMIN and MASTER_ADMIN (Req 1.5–1.8)
--   4. Indexes on franchise_id and created_at DESC
--
-- ORDERING: This script MUST run AFTER the franchises table exists.
-- It references public.franchises(id).
--
-- Safety: Brand new table; nothing existing is dropped or altered.
-- Idempotent (re-runnable) via IF NOT EXISTS / OR REPLACE guards.
--
-- Rollback:
--   DROP POLICY IF EXISTS franchise_disputes_update_master ON public.franchise_disputes;
--   DROP POLICY IF EXISTS franchise_disputes_select_master ON public.franchise_disputes;
--   DROP POLICY IF EXISTS franchise_disputes_insert_franchise ON public.franchise_disputes;
--   DROP POLICY IF EXISTS franchise_disputes_select_franchise ON public.franchise_disputes;
--   DROP TRIGGER IF EXISTS trg_franchise_disputes_updated_at ON public.franchise_disputes;
--   DROP FUNCTION IF EXISTS public.update_franchise_disputes_updated_at();
--   DROP TABLE IF EXISTS public.franchise_disputes;
-- ============================================================================

-- ============================================================================
-- 1. FRANCHISE_DISPUTES TABLE (Req 1.1, 1.2, 1.3, 1.4)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.franchise_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id UUID NOT NULL REFERENCES public.franchises(id),
  category TEXT NOT NULL CHECK (category IN (
    'Inventory', 'Customer', 'Subscriptions', 'KIT',
    'Rider', 'Shop_Products', 'Operations', 'Others'
  )),
  description TEXT NOT NULL CHECK (char_length(description) <= 2000),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN (
    'Open', 'Under_Investigation', 'Solved'
  )),
  master_admin_comment TEXT,
  related_order_ids UUID[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. updated_at TRIGGER (Req 1.9)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_franchise_disputes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_franchise_disputes_updated_at ON public.franchise_disputes;
CREATE TRIGGER trg_franchise_disputes_updated_at
  BEFORE UPDATE ON public.franchise_disputes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_franchise_disputes_updated_at();

-- ============================================================================
-- 3. ROW LEVEL SECURITY (Req 1.5, 1.6, 1.7, 1.8)
-- ============================================================================

ALTER TABLE public.franchise_disputes ENABLE ROW LEVEL SECURITY;

-- FRANCHISE_ADMIN: read own disputes (Req 1.6)
CREATE POLICY franchise_disputes_select_franchise
  ON public.franchise_disputes FOR SELECT
  USING (
    franchise_id = current_franchise_id()
  );

-- FRANCHISE_ADMIN: insert own disputes (Req 1.7)
CREATE POLICY franchise_disputes_insert_franchise
  ON public.franchise_disputes FOR INSERT
  WITH CHECK (
    franchise_id = current_franchise_id()
  );

-- MASTER_ADMIN: read all disputes (Req 1.8)
CREATE POLICY franchise_disputes_select_master
  ON public.franchise_disputes FOR SELECT
  USING (
    is_global_role()
  );

-- MASTER_ADMIN: update all disputes (Req 1.8)
CREATE POLICY franchise_disputes_update_master
  ON public.franchise_disputes FOR UPDATE
  USING (
    is_global_role()
  );

-- ============================================================================
-- 4. INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_franchise_disputes_franchise_id
  ON public.franchise_disputes(franchise_id);

CREATE INDEX IF NOT EXISTS idx_franchise_disputes_created_at
  ON public.franchise_disputes(created_at DESC);

-- ============================================================================
-- DONE. The table is additive and isolated. Run only AFTER franchises exist.
-- ============================================================================
