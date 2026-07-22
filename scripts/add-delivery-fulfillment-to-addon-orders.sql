-- ============================================================================
-- ASSISTED SHOP ORDERS — Clinic pickup & offline delivery fulfillment
-- (SAFE: Additive only)
-- ============================================================================
-- Extends `addon_orders` so an operator (Admin/Franchise_Admin) can fulfil a
-- shop order WITHOUT the meal-delivery routing pipeline:
--
--   1. CLINIC_PICKUP     — the customer collects the product at the clinic. Set
--                          at placement time when the operator ticks "Clinic
--                          pickup"; the order is created already DELIVERED and
--                          never enters product-linking / routing.
--   2. DELIVERED_OFFLINE — an admin marks an existing order delivered manually
--                          from Operations → Shop Orders (e.g. handed over at
--                          the clinic). The order is set DELIVERED and unlinked
--                          from any assigned delivery so no rider carries it.
--
-- Both drop out of `runProductLinkingAction` automatically because that step
-- only links orders that are still `status = 'PAID' AND delivery_order_id IS
-- NULL`. Marking an order DELIVERED (and clearing delivery_order_id) removes it
-- from every future link/route pass.
--
-- Adds:
--   - addon_orders.fulfillment_status — the CHECK is widened to also allow
--       'CLINIC_PICKUP' and 'DELIVERED_OFFLINE' (in addition to the existing
--       'UNFULFILLABLE_STOCK' fail-safe marker). Still NULLABLE; NULL = normal.
--   - addon_orders.delivered_at — TIMESTAMPTZ recording WHEN the order became
--       delivered via an offline/pickup path, so Operations can show the last
--       3 days of delivered orders. NULL for not-yet-delivered orders.
--
-- IDEMPOTENT / SELF-CONTAINED: safe to run whether or not
-- `add-fulfillment-status-to-addon-orders.sql` was applied first — it adds the
-- column if missing, then drops and recreates the CHECK with the full value set.
--
-- Rollback:
--   ALTER TABLE public.addon_orders DROP COLUMN IF EXISTS delivered_at;
--   -- (restore the original single-value CHECK if desired)
-- ============================================================================

-- 1. Ensure the column exists (no-op if the prior migration already added it).
ALTER TABLE public.addon_orders
  ADD COLUMN IF NOT EXISTS fulfillment_status TEXT DEFAULT NULL;

-- 2. Widen the allowed values. Drop the prior (auto-named) column CHECK and any
--    previously named variant, then add the authoritative named constraint.
ALTER TABLE public.addon_orders
  DROP CONSTRAINT IF EXISTS addon_orders_fulfillment_status_check;

ALTER TABLE public.addon_orders
  ADD CONSTRAINT addon_orders_fulfillment_status_check
  CHECK (
    fulfillment_status IS NULL
    OR fulfillment_status IN (
      'UNFULFILLABLE_STOCK',
      'CLINIC_PICKUP',
      'DELIVERED_OFFLINE'
    )
  );

-- 3. Record when an order became delivered via an offline/pickup path.
ALTER TABLE public.addon_orders
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ DEFAULT NULL;

-- Lets Operations fetch the last-3-days delivered orders without scanning.
CREATE INDEX IF NOT EXISTS idx_addon_orders_delivered_at
  ON public.addon_orders (delivered_at)
  WHERE delivered_at IS NOT NULL;

-- ============================================================================
-- DONE. Additive and nullable; no backfill required. Normal orders remain
-- NULL and behave exactly as before.
-- ============================================================================
