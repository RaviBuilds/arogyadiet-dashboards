-- ============================================================================
-- MASTER CATALOG — Product_Code on inventory_products (SAFE: Additive only)
-- ============================================================================
-- Adds a unique, human-readable, auto-generated 5-character alphanumeric
-- Product_Code to every Master_Catalog_Product (public.inventory_products).
-- This is the code an Inventory_Admin reads off a product card and types into
-- the Shop Products "link by code" flow, instead of picking from a long
-- dropdown.
--
-- What this script does:
--   1. Adds inventory_products.product_code (CHAR(5), uppercase alphanumeric,
--      unique, NOT NULL).
--   2. Backfills every existing row with a randomly generated, collision-free
--      code.
--   3. Installs a trigger that auto-generates a code for every future INSERT
--      that doesn't already supply one, retrying on the rare collision.
--
-- Alphabet: uppercase A-Z + digits 0-9, ambiguous characters (O/0, I/1)
-- excluded to keep codes easy to read and re-type from a physical product
-- card or label. 32 characters ^ 5 positions ≈ 33.5M combinations — ample
-- headroom for a warehouse catalogue of this size (tens to low thousands of
-- rows).
--
-- Safety: additive only. No existing column is altered or dropped. Idempotent
-- (re-runnable) via ADD COLUMN IF NOT EXISTS, a guarded backfill that only
-- touches NULL codes, and CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS
-- for the trigger.
--
-- ORDERING: This script MUST run AFTER public.inventory_products exists.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_inventory_products_product_code ON public.inventory_products;
--   DROP FUNCTION IF EXISTS public.generate_inventory_product_code();
--   ALTER TABLE public.inventory_products DROP COLUMN IF EXISTS product_code;
-- ============================================================================

-- ============================================================================
-- 1. Add the column (nullable at first so the backfill can target NULLs)
-- ============================================================================
ALTER TABLE public.inventory_products
  ADD COLUMN IF NOT EXISTS product_code CHAR(5);

-- ============================================================================
-- 2. Backfill every existing row with a unique code
-- ============================================================================
DO $$
DECLARE
  v_alphabet TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; -- no 0/O, 1/I
  v_row RECORD;
  v_candidate TEXT;
  v_attempts INT;
BEGIN
  FOR v_row IN
    SELECT id FROM public.inventory_products WHERE product_code IS NULL
  LOOP
    v_attempts := 0;
    LOOP
      v_candidate := (
        SELECT string_agg(
          substr(v_alphabet, (floor(random() * length(v_alphabet)) + 1)::int, 1),
          ''
        )
        FROM generate_series(1, 5)
      );

      v_attempts := v_attempts + 1;

      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.inventory_products WHERE product_code = v_candidate
      ) OR v_attempts > 20;
    END LOOP;

    UPDATE public.inventory_products
       SET product_code = v_candidate
     WHERE id = v_row.id;
  END LOOP;
END $$;

-- ============================================================================
-- 3. Enforce NOT NULL + UNIQUE now that every row has a code
-- ============================================================================
ALTER TABLE public.inventory_products
  ALTER COLUMN product_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_inventory_products_product_code'
  ) THEN
    ALTER TABLE public.inventory_products
      ADD CONSTRAINT uq_inventory_products_product_code UNIQUE (product_code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_products_product_code
  ON public.inventory_products (product_code);

-- ============================================================================
-- 4. Auto-generate a code on every future INSERT that omits one
-- ============================================================================
CREATE OR REPLACE FUNCTION public.generate_inventory_product_code()
RETURNS TRIGGER AS $$
DECLARE
  v_alphabet TEXT := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_candidate TEXT;
  v_attempts INT := 0;
BEGIN
  IF NEW.product_code IS NOT NULL THEN
    RETURN NEW;
  END IF;

  LOOP
    v_candidate := (
      SELECT string_agg(
        substr(v_alphabet, (floor(random() * length(v_alphabet)) + 1)::int, 1),
        ''
      )
      FROM generate_series(1, 5)
    );

    v_attempts := v_attempts + 1;

    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.inventory_products WHERE product_code = v_candidate
    ) OR v_attempts > 20;
  END LOOP;

  IF v_attempts > 20 THEN
    RAISE EXCEPTION 'Could not generate a unique product_code after 20 attempts';
  END IF;

  NEW.product_code := v_candidate;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_inventory_products_product_code ON public.inventory_products;

CREATE TRIGGER trg_inventory_products_product_code
  BEFORE INSERT ON public.inventory_products
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_inventory_product_code();

-- ============================================================================
-- DONE. Every Master_Catalog_Product now carries a unique, auto-generated
-- 5-character Product_Code. Existing rows were backfilled; every future
-- insert gets one automatically.
-- ============================================================================
