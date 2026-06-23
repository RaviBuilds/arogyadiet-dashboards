-- ============================================================================
-- ROLLBACK: DISABLE FRANCHISE RLS — Run if anything breaks after enablement
-- ============================================================================
-- This IMMEDIATELY disables RLS on all franchise-scoped tables.
-- All queries will return all rows again (pre-RLS behavior).
-- Safe to run at any time — instant recovery.
-- ============================================================================

ALTER TABLE public.customer_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_batches DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_service_areas DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_live_locations DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_monthly_summaries DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_payouts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.razorpay_transactions DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.products DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.addon_orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.addon_order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.addresses DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.coupons DISABLE ROW LEVEL SECURITY;

-- Verify: All tables should now be accessible without session context
-- SELECT count(*) FROM customer_profiles;  -- Should work without set_franchise_context
