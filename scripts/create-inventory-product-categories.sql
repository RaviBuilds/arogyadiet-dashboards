-- ============================================================================
-- Managed Inventory Product Categories
-- ----------------------------------------------------------------------------
-- Introduces a master-managed category catalog for warehouse products so that
-- categories are picked from a fixed, curated list instead of being free-typed
-- (which produced duplicate / inconsistent categories).
--
-- Design notes:
--   * inventory_products.category REMAINS a text column and continues to store
--     the category *name*. This keeps every existing consumer (analytics,
--     exports, insights, filter chips) working unchanged.
--   * The set of allowed names is now curated via inventory_product_categories
--     and enforced through the UI dropdown.
--   * "Not selected" is represented by the reserved sentinel name
--     'Uncategorized'. The column stays NOT NULL and defaults to 'Uncategorized'
--     so no string consumer can crash on a null value.
--
-- Safety: This script ONLY touches the `category` column of inventory_products.
--         No other product information is modified.
-- ============================================================================

-- 1. Category catalog table -------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_product_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  image_url   text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness on the category name (prevents duplicates such
-- as "Oil" vs "oil" vs " Oil ").
CREATE UNIQUE INDEX IF NOT EXISTS inventory_product_categories_name_lower_uidx
  ON public.inventory_product_categories (lower(btrim(name)));

COMMENT ON TABLE public.inventory_product_categories IS
  'Master-managed catalog of warehouse product categories. Referenced by inventory_products.category (by name).';

-- 2. Make the product category column safe & defaulted ----------------------
ALTER TABLE public.inventory_products
  ALTER COLUMN category SET DEFAULT 'Uncategorized';

-- 3. Reset all existing products to Uncategorized ---------------------------
--    Master admin will create the curated categories and re-assign products
--    from the product edit screen. Only the category is reset here; every
--    other product field is left untouched.
UPDATE public.inventory_products
   SET category = 'Uncategorized',
       updated_at = now()
 WHERE category IS DISTINCT FROM 'Uncategorized';
