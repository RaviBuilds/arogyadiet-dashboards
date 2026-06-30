-- ============================================================================
-- FRANCHISE INVENTORY — franchise_inventory_ledger table (SAFE: Additive only)
-- ============================================================================
-- Spec: franchise-inventory — Task 2.4 — Requirements 11.1, 11.2, 11.3
--
-- The franchise audit ledger records every incoming and outgoing stock movement
-- for a franchise inventory. Each entry is scoped to exactly one franchise
-- (Req 11.3) and captures:
--   - IN entries: product, quantity, batch breakdown, source transfer,
--     central kitchen source, and UTC timestamp (Req 11.1)
--   - OUT entries: product, quantity, stock-out reason, optional comment,
--     affected batches, and UTC timestamp (Req 11.2)
--
-- The primary key is a BIGINT IDENTITY column that provides a monotonic
-- insertion order used as a tie-breaker when sorting newest-first (Req 11.4).
--
-- The ck_ledger_direction CHECK constraint ensures IN entries always have a
-- source_transfer_id and no stock_out_reason, while OUT entries always have a
-- stock_out_reason and no source_transfer_id.
--
-- Creates:
--   1. franchise_ledger_direction ENUM (IN, OUT)
--   2. franchise_inventory_ledger table (new)
--   3. idx_fledger_franchise_time — composite index for newest-first queries
--
-- ORDERING: This script MUST run AFTER:
--   - create-franchise-tables.sql (public.franchises)
--   - inventory_products table exists (public.inventory_products)
--   - create-franchise-stock-transfers-tables.sql (public.franchise_stock_transfers)
--   - kitchens table exists (public.kitchens)
--
-- Safety: Brand new table and type; nothing existing is dropped or altered.
-- Idempotent (re-runnable) via IF NOT EXISTS / DO $$ guards.
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_fledger_franchise_time;
--   DROP TABLE IF EXISTS public.franchise_inventory_ledger;
--   DROP TYPE IF EXISTS franchise_ledger_direction;
-- ============================================================================

-- ============================================================================
-- 1. FRANCHISE_LEDGER_DIRECTION ENUM
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'franchise_ledger_direction') THEN
    CREATE TYPE franchise_ledger_direction AS ENUM ('IN','OUT');
  END IF;
END
$$;

-- ============================================================================
-- 2. FRANCHISE_INVENTORY_LEDGER (new) — per-franchise audit ledger (Req 11.1, 11.2, 11.3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.franchise_inventory_ledger (
  -- Monotonic insertion order for tie-break (Req 11.4)
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Scope: every entry belongs to exactly one franchise (Req 11.3)
  franchise_id UUID NOT NULL REFERENCES public.franchises(id),

  -- Direction of the movement
  direction franchise_ledger_direction NOT NULL,

  -- What product was moved
  product_id UUID NOT NULL REFERENCES public.inventory_products(id),

  -- Total quantity moved (always positive)
  quantity NUMERIC NOT NULL CHECK (quantity > 0),

  -- Per-batch breakdown: [{batch_number, quantity, expiry_date}]
  batch_breakdown JSONB NOT NULL,

  -- IN entries: source transfer and central kitchen
  source_transfer_id UUID REFERENCES public.franchise_stock_transfers(id),
  source_central_kitchen_id UUID REFERENCES public.kitchens(id),

  -- OUT entries: reason and optional comment
  stock_out_reason TEXT CHECK (stock_out_reason IN (
    'MEAL_SUBSCRIPTION_SALE',
    'KIT_SUBSCRIPTION_SALE',
    'ONE_TIME_PURCHASE_SALE',
    'SPOILED',
    'DAMAGED',
    'OTHER'
  )),
  comment TEXT CHECK (comment IS NULL OR char_length(comment) BETWEEN 1 AND 500),

  -- UTC timestamp with at least second-level precision (Req 11.1, 11.2)
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Direction integrity constraint:
  -- IN entries must have a source_transfer_id and no stock_out_reason
  -- OUT entries must have a stock_out_reason and no source_transfer_id
  CONSTRAINT ck_ledger_direction CHECK (
    (direction = 'IN'  AND source_transfer_id IS NOT NULL AND stock_out_reason IS NULL) OR
    (direction = 'OUT' AND stock_out_reason  IS NOT NULL AND source_transfer_id IS NULL)
  )
);

-- ============================================================================
-- 3. INDEX — newest-first queries with tie-break by insertion order
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_fledger_franchise_time
  ON public.franchise_inventory_ledger(franchise_id, occurred_at DESC, id DESC);

-- ============================================================================
-- DONE. The table is additive and isolated.
-- Run AFTER franchises, inventory_products, franchise_stock_transfers, and
-- kitchens tables exist.
-- ============================================================================
