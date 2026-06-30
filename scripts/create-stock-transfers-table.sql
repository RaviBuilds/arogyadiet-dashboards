-- ============================================================================
-- STOCK TRANSFERS — Schema Foundation (SAFE: Additive only)
-- ============================================================================
-- Spec: multi-tenant-franchise — Task 1.5 — Requirement 19.5
--
-- Records a transfer of product stock into a destination Franchise warehouse,
-- originating either from the CORE business or from another Franchise. This
-- table is the audit/ledger of inter-entity stock movement that feeds the
-- destination warehouse inventory.
--
-- Creates:
--   1. stock_transfers (new) — one row per stock transfer event.
--
-- Source semantics (Req 19.5):
--   - source_kind = 'CORE'      => the transfer originates from CORE.
--                                  source_franchise_id MUST be NULL.
--   - source_kind = 'FRANCHISE' => the transfer originates from a Franchise.
--                                  source_franchise_id references franchises(id).
--
-- Safety: Brand new table created with CREATE TABLE IF NOT EXISTS. No existing
-- data is dropped or altered. Idempotent (re-runnable) — indexes use
-- CREATE INDEX IF NOT EXISTS.
--
-- ORDERING REQUIREMENT:
--   This file MUST run AFTER create-franchise-warehouse-tables.sql, because
--   dest_warehouse_id references public.franchise_warehouses(id), which that
--   script creates. It also depends on public.franchises, public.products, and
--   public.users already existing.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.stock_transfers;
-- ============================================================================

-- ============================================================================
-- 1. STOCK_TRANSFERS (new) — Requirement 19.5
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind VARCHAR(20) NOT NULL CHECK (source_kind IN ('CORE','FRANCHISE')),  -- Req 19.5
  source_franchise_id UUID NULL REFERENCES public.franchises(id),                -- NULL when source_kind='CORE'
  dest_warehouse_id UUID NOT NULL REFERENCES public.franchise_warehouses(id),
  dest_franchise_id UUID NOT NULL REFERENCES public.franchises(id),
  product_id UUID REFERENCES public.products(id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_dest_franchise
  ON public.stock_transfers(dest_franchise_id);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_source_franchise
  ON public.stock_transfers(source_franchise_id);

-- ============================================================================
-- DONE. New table is additive. Run AFTER create-franchise-warehouse-tables.sql
-- so that public.franchise_warehouses exists for the dest_warehouse_id FK.
-- ============================================================================
