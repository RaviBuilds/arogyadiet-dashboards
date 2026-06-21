-- ============================================================================
-- ADD franchise_id TO TENANT-ISOLATED TABLES — Phase 1 (SAFE: Nullable columns only)
-- ============================================================================
-- Adds franchise_id UUID DEFAULT NULL to tenant-scoped tables.
-- Existing rows keep NULL (= core operation). No queries affected.
--
-- EXCLUDED (deferred — inventory/manufacturing is core-only for now):
--   inventory_products, inventory_lots, inventory_transactions,
--   manufacturing_batches, manufacturing_orders, manufacturing_outputs,
--   manufacturing_product_mappings
--
-- Rollback: ALTER TABLE <table> DROP COLUMN franchise_id; (for each table below)
-- ============================================================================

-- ========================
-- CUSTOMER & SUBSCRIPTION
-- ========================

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

-- ========================
-- DELIVERY OPERATIONS
-- ========================

ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

ALTER TABLE public.delivery_batches
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

-- ========================
-- RIDER
-- ========================

ALTER TABLE public.rider_profiles
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

ALTER TABLE public.rider_service_areas
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

ALTER TABLE public.rider_live_locations
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

ALTER TABLE public.rider_monthly_summaries
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

ALTER TABLE public.rider_payouts
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

-- ========================
-- PAYMENTS & TRANSACTIONS
-- ========================

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

ALTER TABLE public.razorpay_transactions
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

-- ========================
-- PRODUCTS & ADDON ORDERS (franchise sells products)
-- ========================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

ALTER TABLE public.addon_orders
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

ALTER TABLE public.addon_order_items
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

-- ========================
-- OTHER TENANT-SCOPED
-- ========================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

ALTER TABLE public.addresses
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

ALTER TABLE public.coupons
  ADD COLUMN IF NOT EXISTS franchise_id UUID DEFAULT NULL REFERENCES public.franchises(id) ON DELETE SET NULL;

-- ============================================================================
-- INDEXES for franchise_id filtering performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_customer_profiles_franchise ON public.customer_profiles(franchise_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_franchise ON public.subscriptions(franchise_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_franchise ON public.delivery_orders(franchise_id);
CREATE INDEX IF NOT EXISTS idx_delivery_batches_franchise ON public.delivery_batches(franchise_id);
CREATE INDEX IF NOT EXISTS idx_rider_profiles_franchise ON public.rider_profiles(franchise_id);
CREATE INDEX IF NOT EXISTS idx_rider_service_areas_franchise ON public.rider_service_areas(franchise_id);
CREATE INDEX IF NOT EXISTS idx_rider_live_locations_franchise ON public.rider_live_locations(franchise_id);
CREATE INDEX IF NOT EXISTS idx_rider_monthly_summaries_franchise ON public.rider_monthly_summaries(franchise_id);
CREATE INDEX IF NOT EXISTS idx_rider_payouts_franchise ON public.rider_payouts(franchise_id);
CREATE INDEX IF NOT EXISTS idx_payments_franchise ON public.payments(franchise_id);
CREATE INDEX IF NOT EXISTS idx_razorpay_transactions_franchise ON public.razorpay_transactions(franchise_id);
CREATE INDEX IF NOT EXISTS idx_products_franchise ON public.products(franchise_id);
CREATE INDEX IF NOT EXISTS idx_addon_orders_franchise ON public.addon_orders(franchise_id);
CREATE INDEX IF NOT EXISTS idx_addon_order_items_franchise ON public.addon_order_items(franchise_id);
CREATE INDEX IF NOT EXISTS idx_notifications_franchise ON public.notifications(franchise_id);
CREATE INDEX IF NOT EXISTS idx_addresses_franchise ON public.addresses(franchise_id);
CREATE INDEX IF NOT EXISTS idx_coupons_franchise ON public.coupons(franchise_id);
