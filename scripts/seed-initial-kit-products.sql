-- ============================================================================
-- KIT SUBSCRIPTION MANAGEMENT — Seed Initial Three KIT Products
-- (SAFE: Idempotent, single transaction)
-- ============================================================================
-- PURPOSE
--   Seeds the three initial KIT products for the KIT subscription feature:
--     - Weightloss Platinum (₹28,080.00)
--     - Weightloss Premium  (₹19,760.00)
--     - Weightloss Prime    (₹10,400.00)
--
--   All products have:
--     - tax_rate = 0.05 (5% tax rate per Requirement 1.5)
--     - is_active = true (available for sale)
--
--   Run this MANUALLY in the Supabase SQL editor, AFTER:
--     1. Database schema changes that create the kit_products table
--        (from kit-subscription-management spec task 1.1)
--
--   This script performs no application work and is safe to re-run (idempotent).
--   Each product insert is guarded by NOT EXISTS to prevent duplicates.
--
-- ── REQUIREMENTS VALIDATED ─────────────────────────────────────────────────
--   Requirement 1.2: Initial three KIT products with exact names and prices
--   Requirement 1.5: 5% tax rate applied to all KIT products
--
-- ── SAFETY / IDEMPOTENCY / TRANSACTION ─────────────────────────────────────
--   Idempotent: Each product insert is guarded by NOT EXISTS (name check), so
--   re-running this script will not create duplicates.
--
--   Transaction: The whole migration runs inside a single DO $$ ... $$ plpgsql
--   block, which executes as ONE atomic transaction — any error aborts and
--   rolls back ALL changes so no partial migration persists.
--
-- ── ROLLBACK (manual undo) ─────────────────────────────────────────────────
--   To remove the seeded products (if needed for testing):
--     BEGIN;
--     DELETE FROM public.kit_products
--      WHERE name IN ('Weightloss Platinum', 'Weightloss Premium', 'Weightloss Prime')
--        AND base_price IN (28080.00, 19760.00, 10400.00)
--        AND is_active = true;
--     COMMIT;
--
--   WARNING: Only delete if no subscriptions reference these products!
-- ============================================================================

DO $$
DECLARE
  v_platinum_id uuid;
  v_premium_id  uuid;
  v_prime_id    uuid;
  v_platinum_existed boolean := false;
  v_premium_existed  boolean := false;
  v_prime_existed    boolean := false;
BEGIN
  -- ──────────────────────────────────────────────────────────────────────────
  -- PRODUCT 1: Weightloss Platinum - ₹28,080.00
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_platinum_id
    FROM public.kit_products
   WHERE name = 'Weightloss Platinum'
     AND base_price = 28080.00
   LIMIT 1;

  IF v_platinum_id IS NULL THEN
    INSERT INTO public.kit_products (name, base_price, tax_rate, is_active)
    VALUES ('Weightloss Platinum', 28080.00, 0.05, true)
    RETURNING id INTO v_platinum_id;
    RAISE NOTICE 'Created KIT product "Weightloss Platinum" (id=%, price=₹28,080.00, tax=5%%)', v_platinum_id;
  ELSE
    v_platinum_existed := true;
    RAISE NOTICE 'KIT product "Weightloss Platinum" already exists (id=%); reusing (idempotent)', v_platinum_id;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- PRODUCT 2: Weightloss Premium - ₹19,760.00
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_premium_id
    FROM public.kit_products
   WHERE name = 'Weightloss Premium'
     AND base_price = 19760.00
   LIMIT 1;

  IF v_premium_id IS NULL THEN
    INSERT INTO public.kit_products (name, base_price, tax_rate, is_active)
    VALUES ('Weightloss Premium', 19760.00, 0.05, true)
    RETURNING id INTO v_premium_id;
    RAISE NOTICE 'Created KIT product "Weightloss Premium" (id=%, price=₹19,760.00, tax=5%%)', v_premium_id;
  ELSE
    v_premium_existed := true;
    RAISE NOTICE 'KIT product "Weightloss Premium" already exists (id=%); reusing (idempotent)', v_premium_id;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- PRODUCT 3: Weightloss Prime - ₹10,400.00
  -- ──────────────────────────────────────────────────────────────────────────
  SELECT id INTO v_prime_id
    FROM public.kit_products
   WHERE name = 'Weightloss Prime'
     AND base_price = 10400.00
   LIMIT 1;

  IF v_prime_id IS NULL THEN
    INSERT INTO public.kit_products (name, base_price, tax_rate, is_active)
    VALUES ('Weightloss Prime', 10400.00, 0.05, true)
    RETURNING id INTO v_prime_id;
    RAISE NOTICE 'Created KIT product "Weightloss Prime" (id=%, price=₹10,400.00, tax=5%%)', v_prime_id;
  ELSE
    v_prime_existed := true;
    RAISE NOTICE 'KIT product "Weightloss Prime" already exists (id=%); reusing (idempotent)', v_prime_id;
  END IF;

  -- ──────────────────────────────────────────────────────────────────────────
  -- Run summary
  -- ──────────────────────────────────────────────────────────────────────────
  RAISE NOTICE '────────────────────────────────────────────────────────────';
  RAISE NOTICE 'KIT products seed complete.';
  RAISE NOTICE '  Weightloss Platinum : % (pre-existing=%)', v_platinum_id, v_platinum_existed;
  RAISE NOTICE '  Weightloss Premium  : % (pre-existing=%)', v_premium_id, v_premium_existed;
  RAISE NOTICE '  Weightloss Prime    : % (pre-existing=%)', v_prime_id, v_prime_existed;
  RAISE NOTICE '────────────────────────────────────────────────────────────';
END
$$;

-- ============================================================================
-- VERIFICATION (read-only; run after the migration to confirm the result).
-- ============================================================================

-- V1. Verify all three KIT products exist with correct prices and tax rate.
-- SELECT id, name, base_price, tax_rate, is_active, created_at
--   FROM public.kit_products
--  WHERE name IN ('Weightloss Platinum', 'Weightloss Premium', 'Weightloss Prime')
--  ORDER BY base_price DESC;
--
-- Expected result: 3 rows
--   Weightloss Platinum | 28080.00 | 0.05 | true
--   Weightloss Premium  | 19760.00 | 0.05 | true
--   Weightloss Prime    | 10400.00 | 0.05 | true

-- V2. Verify tax calculation (5% of base price).
-- SELECT 
--   name,
--   base_price,
--   tax_rate,
--   ROUND(base_price * tax_rate, 2) AS calculated_tax,
--   ROUND(base_price * (1 + tax_rate), 2) AS total_with_tax
--   FROM public.kit_products
--  WHERE name IN ('Weightloss Platinum', 'Weightloss Premium', 'Weightloss Prime')
--  ORDER BY base_price DESC;
--
-- Expected tax amounts:
--   Weightloss Platinum: ₹1,404.00 (total: ₹29,484.00)
--   Weightloss Premium:  ₹988.00   (total: ₹20,748.00)
--   Weightloss Prime:    ₹520.00   (total: ₹10,920.00)

-- ============================================================================
-- DONE. Three initial KIT products seeded with 5% tax rate and active status.
-- Re-running this script changes nothing further (idempotent).
-- ============================================================================
