-- ============================================================================
-- KIT SUBSCRIPTION MANAGEMENT — kit_products table (SAFE: Additive only)
-- ============================================================================
-- Spec: kit-subscription-management — Task 1.1 — Requirements 1.4, 9.1
--
-- Introduces the kit_products table to store KIT product catalog information.
-- KIT products represent one-time purchase meal packages (e.g., 30-day kits)
-- with base pricing and tax rate for invoice generation. Each product has:
--   - base_price: Product cost before tax (positive decimal)
--   - tax_rate: Tax percentage (default 5%, non-negative decimal)
--   - is_active: Soft delete flag for product lifecycle management
--
-- The tax_rate defaults to 0.05 (5%) per Requirement 1.4. A CHECK constraint
-- enforces base_price > 0 and tax_rate >= 0 to maintain data integrity.
-- An index on is_active enables fast filtering of active products for admin
-- product listings and customer onboarding dropdowns.
--
-- Creates:
--   1. kit_products table (new) — KIT product catalog
--   2. idx_kit_products_active index — fast active product queries
--   3. updated_at trigger (follows existing project pattern)
--
-- ORDERING: Independent — no foreign key dependencies on other tables.
-- This table will be referenced by subscriptions.kit_product_id in Task 1.3.
--
-- Safety: Brand new table; nothing existing is dropped or altered.
-- Idempotent (re-runnable) via IF NOT EXISTS guards.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_kit_products_updated_at ON public.kit_products;
--   DROP FUNCTION IF EXISTS public.update_kit_products_updated_at();
--   DROP INDEX IF EXISTS public.idx_kit_products_active;
--   DROP TABLE IF EXISTS public.kit_products;
-- ============================================================================

-- ============================================================================
-- 1. KIT_PRODUCTS TABLE (new) — KIT product catalog (Req 1.4, 9.1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kit_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  base_price NUMERIC(10, 2) NOT NULL CHECK (base_price > 0),
  tax_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.05 CHECK (tax_rate >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_active BOOLEAN NOT NULL DEFAULT true
);

-- ============================================================================
-- 2. INDEX FOR ACTIVE PRODUCTS (Req 1.4) — fast active product filtering
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_kit_products_active 
  ON public.kit_products(is_active) 
  WHERE is_active = true;

-- ============================================================================
-- 3. updated_at TRIGGER (project pattern)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_kit_products_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kit_products_updated_at ON public.kit_products;
CREATE TRIGGER trg_kit_products_updated_at
  BEFORE UPDATE ON public.kit_products
  FOR EACH ROW
  EXECUTE FUNCTION public.update_kit_products_updated_at();

-- ============================================================================
-- DONE. The kit_products table is ready for KIT product management.
-- Next: Task 1.2 (kit_shipping_info table) and Task 1.3 (subscriptions FK).
-- ============================================================================
