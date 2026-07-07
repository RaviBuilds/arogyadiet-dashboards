-- Phase 4: Database hardening — Add indexes on customer_profile_id
-- These prevent sequential scans as customer count grows.
-- All indexes are created with IF NOT EXISTS and CONCURRENTLY for zero-downtime.

-- subscriptions: general-purpose index (the existing partial unique index only covers ACTIVE/PENDING)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_subscriptions_customer_profile_id
  ON public.subscriptions (customer_profile_id);

-- addresses: queried on every address-related page
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_addresses_customer_profile_id
  ON public.addresses (customer_profile_id);

-- delivery_orders: queried for today's order, meals history, tracking
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_delivery_orders_customer_profile_id
  ON public.delivery_orders (customer_profile_id);

-- addon_orders: queried for shop orders, dashboard addon badge
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_addon_orders_customer_profile_id
  ON public.addon_orders (customer_profile_id);

-- medical_documents: queried on profile page for document listing
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_medical_documents_customer_profile_id
  ON public.medical_documents (customer_profile_id);
