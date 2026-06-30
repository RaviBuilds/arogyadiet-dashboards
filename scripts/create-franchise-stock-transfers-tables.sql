-- ============================================================================
-- FRANCHISE INVENTORY — franchise_stock_transfers & franchise_stock_transfer_lines
-- (SAFE: Additive only)
-- ============================================================================
-- Spec: franchise-inventory — Task 2.3 — Requirements 6.2, 7.2, 8.6
--
-- Introduces:
--   1. franchise_transfer_state ENUM — lifecycle states for a stock transfer
--   2. franchise_stock_transfers table — transfer header (state machine,
--      timestamps, actors, source kitchen)
--   3. franchise_stock_transfer_lines table — per-batch breakdown of each
--      transfer (batch number, quantity, expiry, source lot reference)
--   4. Supporting indexes for common query patterns
--   5. updated_at trigger on the header table (follows existing pattern)
--
-- The transfer lifecycle is: DISPATCHED → ACCEPTED → RECEIVED, with
-- DISPATCHED → REJECTED as the only alternative terminal transition (Req 8.6).
-- On-hand is affected only by the ACCEPTED → RECEIVED edge.
--
-- ORDERING: This script MUST run AFTER:
--   - create-franchise-tables.sql (public.franchises)
--   - inventory_products table exists (public.inventory_products)
--   - kitchens table exists (public.kitchens)
--   - users table exists (public.users)
--   - inventory_lots table exists (public.inventory_lots)
--
-- Safety: Brand new tables and type; nothing existing is dropped or altered.
-- Idempotent (re-runnable) via IF NOT EXISTS / DO $$ guards.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_fstl_transfer;
--   DROP TABLE IF EXISTS public.franchise_stock_transfer_lines;
--   DROP TRIGGER IF EXISTS trg_franchise_stock_transfers_updated_at ON public.franchise_stock_transfers;
--   DROP FUNCTION IF EXISTS public.update_franchise_stock_transfers_updated_at();
--   DROP INDEX IF EXISTS idx_fst_dest_state;
--   DROP TABLE IF EXISTS public.franchise_stock_transfers;
--   DROP TYPE IF EXISTS franchise_transfer_state;
-- ============================================================================

-- ============================================================================
-- 1. FRANCHISE_TRANSFER_STATE ENUM
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'franchise_transfer_state') THEN
    CREATE TYPE franchise_transfer_state AS ENUM ('DISPATCHED','ACCEPTED','RECEIVED','REJECTED');
  END IF;
END
$$;

-- ============================================================================
-- 2. FRANCHISE_STOCK_TRANSFERS — transfer header (Req 6.2, 7.2, 8.6)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.franchise_stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Destination franchise (denormalized for RLS)
  dest_franchise_id UUID NOT NULL REFERENCES public.franchises(id),

  -- What is being transferred
  product_id UUID NOT NULL REFERENCES public.inventory_products(id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),

  -- Transfer lifecycle state
  state franchise_transfer_state NOT NULL DEFAULT 'DISPATCHED',

  -- Central kitchen source identifier (Req 9.3)
  source_central_kitchen_id UUID REFERENCES public.kitchens(id),

  -- Timestamp columns
  dispatched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  rejected_at TIMESTAMPTZ,

  -- Actor columns
  dispatched_by UUID REFERENCES public.users(id),
  acted_by UUID REFERENCES public.users(id),

  -- Audit timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index: fast lookup of transfers by destination franchise and state
CREATE INDEX IF NOT EXISTS idx_fst_dest_state
  ON public.franchise_stock_transfers(dest_franchise_id, state);

-- ============================================================================
-- 3. updated_at TRIGGER for franchise_stock_transfers (follows existing pattern)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_franchise_stock_transfers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_franchise_stock_transfers_updated_at ON public.franchise_stock_transfers;
CREATE TRIGGER trg_franchise_stock_transfers_updated_at
  BEFORE UPDATE ON public.franchise_stock_transfers
  FOR EACH ROW
  EXECUTE FUNCTION public.update_franchise_stock_transfers_updated_at();

-- ============================================================================
-- 4. FRANCHISE_STOCK_TRANSFER_LINES — per-batch breakdown (Req 6.2, 7.2, 12.1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.franchise_stock_transfer_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Parent transfer (cascade delete if transfer is removed)
  transfer_id UUID NOT NULL REFERENCES public.franchise_stock_transfers(id) ON DELETE CASCADE,

  -- Denormalized franchise_id for RLS
  franchise_id UUID NOT NULL REFERENCES public.franchises(id),

  -- Batch details
  batch_number TEXT NOT NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  expiry_date TIMESTAMPTZ NOT NULL,

  -- Which central lot this line came from
  source_lot_id UUID REFERENCES public.inventory_lots(id)
);

-- Index: fast lookup of lines by transfer
CREATE INDEX IF NOT EXISTS idx_fstl_transfer
  ON public.franchise_stock_transfer_lines(transfer_id);

-- ============================================================================
-- DONE. Both tables are additive and isolated.
-- Run only AFTER franchises, inventory_products, kitchens, users, and
-- inventory_lots tables exist.
-- ============================================================================
