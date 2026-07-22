-- ============================================================================
-- ADMIN/FRANCHISE PLACE SHOP ORDER FOR CUSTOMER — Audit: operator identity
-- (SAFE: Additive only)
-- ============================================================================
-- Adds a nullable `placed_by_user_id` to `addon_orders` so an order placed by
-- an Operator (Admin or Franchise_Admin) on behalf of a customer records WHO
-- placed it, for audit purposes. Customer-placed orders leave this NULL and
-- behave exactly as before, so the change is additive and back-compatible.
--
-- Requirement 6.6.
--
-- Adds (nullable, NULL = customer-placed, zero production impact):
--   - addon_orders.placed_by_user_id — NULL for customer-placed orders; set to
--       the Operator's `public.users.id` for assisted (admin/franchise) orders.
--
-- NULLABILITY: The column is NULLABLE on purpose. Existing and customer-placed
-- orders stay NULL and behave exactly as before; only the assisted-placement
-- path stamps the Operator's identity. The FK uses ON DELETE SET NULL so the
-- audit reference is cleared (not the order deleted) if the operator user is
-- ever removed.
-- ============================================================================

ALTER TABLE public.addon_orders
  ADD COLUMN IF NOT EXISTS placed_by_user_id UUID DEFAULT NULL
    REFERENCES public.users(id) ON DELETE SET NULL;

-- Lets ops/audit quickly list assisted (operator-placed) orders without
-- scanning the full table; partial index keeps it small (NULL rows excluded).
CREATE INDEX IF NOT EXISTS idx_addon_orders_placed_by
  ON public.addon_orders (placed_by_user_id)
  WHERE placed_by_user_id IS NOT NULL;

-- ============================================================================
-- DONE. Additive and nullable; no backfill required. Customer-placed orders
-- remain NULL and unaffected.
-- ============================================================================
