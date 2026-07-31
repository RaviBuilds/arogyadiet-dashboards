-- ============================================================================
-- CLINIC-SCOPED SHOP INVENTORY — Product_Link on Shop Products
-- (SAFE: Additive only)
-- ============================================================================
-- Adds the nullable Product_Link that associates a Shop_Product
-- (public.products) with exactly one Master_Catalog_Product
-- (public.inventory_products). The link is what makes Stock_In possible: a
-- Stock_In of N shop items depletes N base units of the linked Master Catalog
-- Product's warehouse lots (Base_Unit_Equivalence).
--
-- Requirements: 3.1 (persist a nullable Product_Link referencing an existing
-- inventory_products row), 3.9 (many Shop_Products may share one
-- Master_Catalog_Product — no unique constraint here).
--
-- Adds (nullable, NULL = Unlinked_Shop_Product, zero production impact):
--   - products.inventory_product_id — NULL for an Unlinked_Shop_Product (a
--       fully valid state: it simply cannot receive Stock_In). Set to the
--       linked public.inventory_products.id for a Linked_Shop_Product.
--
-- Adds indexes:
--   - idx_products_inventory_product ON products(inventory_product_id)
--       PARTIAL (WHERE inventory_product_id IS NOT NULL). Drives the reverse
--       lookup "which Shop_Products consume this Master Catalog Product" used
--       by Stock_In validation and the Master Catalog selector. Partial keeps it
--       small while most catalogue rows remain unlinked.
--
-- NULLABILITY (Requirement 3.1): The column is NULLABLE on purpose. Existing
-- Shop_Products stay NULL and behave exactly as before. Nothing is backfilled:
-- an Inventory_Admin sets the link explicitly through the Master Catalog
-- selector on the Warehouse_Shop_Products_Page.
--
-- ON DELETE SET NULL: If a Master_Catalog_Product is ever deleted, the Shop
-- Product survives and simply reverts to Unlinked_Shop_Product rather than
-- being deleted with it. The Shop catalogue row is customer-facing data and
-- must never be removed by a warehouse-catalogue deletion.
--
-- NO STOCK SEMANTICS HERE: This script does NOT touch products.stock_quantity.
-- That column is retained, frozen, as a pre-migration historical value
-- (Requirement 1.15); per-clinic stock lives in clinic_product_settings.
--
-- The Aggregate_Stock-is-zero restriction on CHANGING an existing link
-- (Requirement 3.11) is deliberately NOT a database constraint: it depends on
-- summing clinic_product_settings across every Core Clinic and is enforced in
-- the server action that persists the link (Requirement 3.12).
--
-- Safety: The new column is nullable and references the already-existing
-- public.inventory_products(id). No existing data is dropped or altered.
-- Idempotent (re-runnable) via ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT
-- EXISTS.
--
-- RLS: This script does NOT enable or alter RLS on public.products, following
-- the established additive pattern (add-placed-by-to-addon-orders.sql).
--
-- ORDERING: This script MUST run AFTER:
--   - public.products exists (shop catalogue base schema)
--   - public.inventory_products exists (warehouse master catalogue)
-- It is independent of the clinic overlay tables and may run before or after
-- create-clinic-product-settings-table.sql.
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_products_inventory_product;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS inventory_product_id;
-- ============================================================================

-- ============================================================================
-- 1. PRODUCTS (existing) — Product_Link (Requirement 3.1)
-- ============================================================================
-- Nullable: an Unlinked_Shop_Product is a valid state. The foreign key is what
-- delivers "a set Product_Link references an existing inventory_products row"
-- (Requirement 3.1); the action layer additionally reports a friendly
-- not-found message (Requirement 3.8).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS inventory_product_id UUID
    REFERENCES public.inventory_products(id) ON DELETE SET NULL;

-- Reverse lookup for Stock_In validation and link auditing. Partial index:
-- unlinked rows are excluded, so the index stays proportional to the number of
-- Linked_Shop_Products rather than the whole catalogue.
CREATE INDEX IF NOT EXISTS idx_products_inventory_product
  ON public.products (inventory_product_id)
  WHERE inventory_product_id IS NOT NULL;

-- ============================================================================
-- DONE. Additive and nullable; no backfill required. Every existing
-- Shop_Product remains an Unlinked_Shop_Product until an Inventory_Admin links
-- it. products.stock_quantity is untouched.
-- ============================================================================
