-- ============================================================================
-- MULTI-TENANT FRANCHISE — Franchise Warehouse Schema (SAFE: Additive only)
-- ============================================================================
-- Spec: multi-tenant-franchise — Task 1.4 — Requirements 19.1, 19.2, 19.6
--
-- Introduces per-franchise warehouse inventory, isolated from the CORE
-- inventory_* / manufacturing_* tables. Each franchise owns exactly one
-- warehouse (Req 19.1), and that warehouse holds per-product stock levels
-- (Req 19.2). franchise_id is denormalized onto the stock table so franchise
-- Row Level Security can scope rows directly without a join (Req 19.6).
--
-- Creates:
--   1. franchise_warehouses        (new) — one warehouse per franchise
--   2. franchise_warehouse_stock   (new) — per-product stock for a warehouse
--
-- Enforces:
--   - franchise_warehouses.franchise_id UNIQUE        (one warehouse / franchise)
--   - franchise_warehouse_stock UNIQUE(warehouse_id, product_id)
--   - franchise_warehouse_stock.quantity CHECK (quantity >= 0)
--
-- ORDERING: This script MUST run AFTER the franchises table exists
-- (see create-franchise-tables.sql). It references public.franchises(id) and
-- public.products(id) directly. Run the franchise base migration first.
--
-- SCOPE: This migration does NOT touch the core inventory_* or manufacturing_*
-- tables in any way. Franchise warehouse stock is an independent, isolated
-- ledger.
--
-- Safety: Both tables are brand new; nothing existing is dropped or altered
-- destructively. Idempotent (re-runnable) via IF NOT EXISTS guards.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.franchise_warehouse_stock;
--   DROP TABLE IF EXISTS public.franchise_warehouses;
-- ============================================================================

-- ============================================================================
-- 1. FRANCHISE_WAREHOUSES (new) — Requirement 19.1 — one warehouse per franchise
-- ============================================================================
-- franchise_id is UNIQUE to guarantee a franchise can own at most one warehouse.

CREATE TABLE IF NOT EXISTS public.franchise_warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id UUID NOT NULL UNIQUE REFERENCES public.franchises(id),  -- one warehouse per franchise (Req 19.1)
  name VARCHAR(150) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_franchise_warehouses_franchise
  ON public.franchise_warehouses(franchise_id);

-- ============================================================================
-- 2. FRANCHISE_WAREHOUSE_STOCK (new) — Requirements 19.2, 19.6 — per-product stock
-- ============================================================================
-- franchise_id is denormalized here (in addition to being reachable via
-- warehouse_id -> franchise_warehouses.franchise_id) so franchise RLS can scope
-- rows directly without a join (Req 19.6). UNIQUE(warehouse_id, product_id)
-- guarantees a single stock row per product within a warehouse.

CREATE TABLE IF NOT EXISTS public.franchise_warehouse_stock (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id UUID NOT NULL REFERENCES public.franchise_warehouses(id),
  franchise_id UUID NOT NULL REFERENCES public.franchises(id),  -- denormalized for RLS (Req 19.6)
  product_id UUID REFERENCES public.products(id),
  quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One stock row per product within a warehouse (Req 19.2)
  CONSTRAINT uq_franchise_warehouse_stock_warehouse_product UNIQUE (warehouse_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_franchise_warehouse_stock_franchise
  ON public.franchise_warehouse_stock(franchise_id);

-- ============================================================================
-- 3. updated_at TRIGGERS (franchise pattern)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_franchise_warehouses_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_franchise_warehouses_updated_at ON public.franchise_warehouses;
CREATE TRIGGER trg_franchise_warehouses_updated_at
  BEFORE UPDATE ON public.franchise_warehouses
  FOR EACH ROW
  EXECUTE FUNCTION public.update_franchise_warehouses_updated_at();

CREATE OR REPLACE FUNCTION public.update_franchise_warehouse_stock_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_franchise_warehouse_stock_updated_at ON public.franchise_warehouse_stock;
CREATE TRIGGER trg_franchise_warehouse_stock_updated_at
  BEFORE UPDATE ON public.franchise_warehouse_stock
  FOR EACH ROW
  EXECUTE FUNCTION public.update_franchise_warehouse_stock_updated_at();

-- ============================================================================
-- DONE. Both tables are additive and isolated from core inventory_* /
-- manufacturing_* tables. Run this only AFTER franchises (and products) exist.
-- ============================================================================
