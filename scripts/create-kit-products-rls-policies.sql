-- ============================================================================
-- KIT PRODUCTS RLS POLICIES
-- ============================================================================
--
-- Spec: kit-subscription-management — Task 19.1 — Security Requirements
--
-- Enables RLS and creates policies for the kit_products table.
-- KIT products are global catalog items (no franchise_id column), accessible
-- across all users but with different permission levels based on role.
--
-- Policy Logic:
--   ADMIN / MASTER_ADMIN (global role) → Full CRUD access to all products
--   CUSTOMERS (all other users) → Read-only access to active products only
--
-- Access Patterns:
--   - Admin Portal: Create, update, and manage KIT products
--   - Quick Onboarding: Fetch active products for dropdown selection
--   - Customer Portal: (Future) View available KIT products for purchase
--
-- Depends on: is_global_role() helper function from create-franchise-rls-policies.sql
--
-- Requirements validated: Security considerations for KIT product management
-- ============================================================================

-- ─── kit_products ──────────────────────────────────────────────────────────

-- Base table-level GRANTs (Postgres checks these BEFORE evaluating RLS
-- policies). Without them, `authenticated`/`anon` get "permission denied for
-- table kit_products" regardless of how permissive the RLS policy is below.
-- RLS still gates which ROWS each grantee can see/write.
GRANT SELECT ON public.kit_products TO authenticated, anon;
GRANT INSERT, UPDATE, DELETE ON public.kit_products TO authenticated;

ALTER TABLE public.kit_products ENABLE ROW LEVEL SECURITY;

-- SELECT Policy: Admins see all products; customers see only active products
DROP POLICY IF EXISTS kit_products_select ON public.kit_products;
CREATE POLICY kit_products_select ON public.kit_products
  FOR SELECT USING (
    is_global_role()
    OR is_active = true
  );

-- INSERT Policy: Only admins can create new products
DROP POLICY IF EXISTS kit_products_insert ON public.kit_products;
CREATE POLICY kit_products_insert ON public.kit_products
  FOR INSERT WITH CHECK (
    is_global_role()
  );

-- UPDATE Policy: Only admins can update products
DROP POLICY IF EXISTS kit_products_update ON public.kit_products;
CREATE POLICY kit_products_update ON public.kit_products
  FOR UPDATE USING (
    is_global_role()
  );

-- DELETE Policy: Only admins can delete products
DROP POLICY IF EXISTS kit_products_delete ON public.kit_products;
CREATE POLICY kit_products_delete ON public.kit_products
  FOR DELETE USING (
    is_global_role()
  );

-- ============================================================================
-- POST-ENABLEMENT SMOKE TEST:
--
-- As admin (service role):
--   SELECT set_franchise_context('ADMIN', '');
--   SELECT count(*) FROM kit_products;                   -- Should see ALL
--   INSERT INTO kit_products (name, base_price) 
--     VALUES ('Test Product', 1000.00);                  -- Should succeed
--   UPDATE kit_products SET is_active = false 
--     WHERE name = 'Test Product';                       -- Should succeed
--   DELETE FROM kit_products WHERE name = 'Test Product'; -- Should succeed
--
-- As customer (authenticated user, non-admin):
--   SELECT set_franchise_context('CUSTOMER', '<franchise-uuid>');
--   SELECT count(*) FROM kit_products WHERE is_active = true;  -- Should see active only
--   SELECT count(*) FROM kit_products WHERE is_active = false; -- Should see 0
--   INSERT INTO kit_products (name, base_price) 
--     VALUES ('Test', 100.00);                           -- Should FAIL
--   UPDATE kit_products SET base_price = 100;            -- Should FAIL
--   DELETE FROM kit_products WHERE id = '<any-id>';      -- Should FAIL
--
-- As anonymous (not authenticated):
--   SELECT count(*) FROM kit_products WHERE is_active = true;  -- Should see active only
--   INSERT INTO kit_products (name, base_price) 
--     VALUES ('Test', 100.00);                           -- Should FAIL
-- ============================================================================
