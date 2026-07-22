-- ============================================================================
-- SHOP PRODUCT DELIVERY LINKING FIX — Defect #6: Fail-safe franchise stock
-- (SAFE: Additive only)
-- ============================================================================
-- Adds a nullable `fulfillment_status` marker to `addon_orders` so a franchise
-- order that was PAID but whose franchise stock could NOT be decremented
-- (the atomic `decrement_franchise_product_stock` RPC returned `false` — e.g. a
-- concurrent sale) can be flagged as unfulfillable for ops review / refund,
-- instead of being left silently PAID with unavailable stock (oversell).
--
-- Requirement 2.7 / Property 6.
--
-- Adds (nullable, NULL = normal/fulfillable, zero production impact):
--   - addon_orders.fulfillment_status — NULL for normal orders; set to
--       'UNFULFILLABLE_STOCK' by `verifyAddonPayment` when a franchise stock
--       decrement could not be honored for one or more items.
--
-- NULLABILITY: The column is NULLABLE on purpose. Existing and normal orders
-- stay NULL and behave exactly as before; only the fail-safe path stamps a
-- value. `status` is deliberately left unchanged (PAID) because the customer
-- WAS charged — the marker records the fulfillment condition without rewriting
-- the payment lifecycle.
-- ============================================================================

ALTER TABLE public.addon_orders
  ADD COLUMN IF NOT EXISTS fulfillment_status TEXT DEFAULT NULL
    CHECK (fulfillment_status IS NULL OR fulfillment_status IN ('UNFULFILLABLE_STOCK'));

-- Lets ops quickly list orders needing review/refund without scanning the table.
CREATE INDEX IF NOT EXISTS idx_addon_orders_fulfillment_status
  ON public.addon_orders (fulfillment_status)
  WHERE fulfillment_status IS NOT NULL;

-- ============================================================================
-- DONE. Additive and nullable; no backfill required. Normal orders remain
-- NULL and unaffected.
-- ============================================================================
