-- ============================================================================
-- FRANCHISE INVENTORY — franchise_inventory_lots table (SAFE: Additive only)
-- ============================================================================
-- Spec: franchise-inventory — Task 2.2 — Requirements 9.1, 9.3, 12.1
--
-- Each row represents a batch of a finished product held in a franchise's
-- inventory. Lots are created exclusively by the receive_franchise_transfer
-- RPC when a Stock_Transfer reaches state RECEIVED. The product_id must
-- reference a FINISHED_GOOD (enforced in the RPC, Req 3).
--
-- FIFO depletion order is: earliest expiry_date first, ties broken by
-- earliest received_at (Req 10.2, 12.5). The partial index idx_fil_fifo
-- supports efficient FIFO queries on ACTIVE lots only.
--
-- Each lot records its source_transfer_id (Req 9.3) so stock-in is traceable
-- back to the originating central-kitchen dispatch. The batch_number and
-- expiry_date are retained unchanged from the source transfer lines (Req 12.1).
--
-- Creates:
--   1. franchise_inventory_lots table (new)
--   2. idx_fil_franchise — fast RLS/scope lookups by franchise
--   3. idx_fil_fifo — partial FIFO index for active-lot depletion
--   4. updated_at trigger (follows existing franchise pattern)
--
-- ORDERING: This script MUST run AFTER:
--   - create-franchise-tables.sql (franchises)
--   - create-franchise-inventories-table.sql (franchise_inventories)
--   - create-franchise-stock-transfers-tables.sql (franchise_stock_transfers)
--   - inventory_products table already exists
--
-- NOTE: This references franchise_stock_transfers which may not yet exist
-- when running scripts out of order. All scripts are run manually in the
-- correct sequence.
--
-- Safety: Brand new table; nothing existing is dropped or altered.
-- Idempotent (re-runnable) via IF NOT EXISTS guards.
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_fil_fifo;
--   DROP INDEX IF EXISTS public.idx_fil_franchise;
--   DROP TRIGGER IF EXISTS trg_franchise_inventory_lots_updated_at ON public.franchise_inventory_lots;
--   DROP FUNCTION IF EXISTS public.update_franchise_inventory_lots_updated_at();
--   DROP TABLE IF EXISTS public.franchise_inventory_lots;
-- ============================================================================

-- ============================================================================
-- 1. FRANCHISE_INVENTORY_LOTS (new) — batch records per franchise (Req 9.1, 9.3, 12.1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.franchise_inventory_lots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id UUID NOT NULL REFERENCES public.franchises(id) ON DELETE CASCADE,
  inventory_id UUID NOT NULL REFERENCES public.franchise_inventories(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.inventory_products(id),
  batch_number TEXT NOT NULL,
  quantity_remaining NUMERIC NOT NULL CHECK (quantity_remaining >= 0),
  expiry_date TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_transfer_id UUID NOT NULL REFERENCES public.franchise_stock_transfers(id),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DEPLETED','EXPIRED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 2. INDEXES
-- ============================================================================

-- Fast RLS / scope lookups by franchise (denormalized column)
CREATE INDEX IF NOT EXISTS idx_fil_franchise
  ON public.franchise_inventory_lots(franchise_id);

-- Partial FIFO index: supports efficient depletion queries on active lots
-- ordered by earliest expiry first, ties broken by earliest received date
CREATE INDEX IF NOT EXISTS idx_fil_fifo
  ON public.franchise_inventory_lots(product_id, expiry_date ASC, received_at ASC)
  WHERE status = 'ACTIVE';

-- ============================================================================
-- 3. updated_at TRIGGER (franchise pattern)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_franchise_inventory_lots_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_franchise_inventory_lots_updated_at ON public.franchise_inventory_lots;
CREATE TRIGGER trg_franchise_inventory_lots_updated_at
  BEFORE UPDATE ON public.franchise_inventory_lots
  FOR EACH ROW
  EXECUTE FUNCTION public.update_franchise_inventory_lots_updated_at();

-- ============================================================================
-- DONE. The table is additive and isolated.
-- Run AFTER franchises, franchise_inventories, inventory_products, and
-- franchise_stock_transfers tables exist.
-- ============================================================================
