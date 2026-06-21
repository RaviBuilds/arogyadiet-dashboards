-- ============================================================================
-- ENABLE FRANCHISE RLS — Run ONLY after:
--   1. Application code deployed with session context setting
--   2. Feature flag tested in staging for 24+ hours
--   3. set_franchise_context RPC confirmed working
--
-- Run ONE TABLE AT A TIME. After each, verify admin can still query.
-- If anything breaks: immediately run disable-franchise-rls.sql
-- ============================================================================

-- Pre-check: Verify session context is working
-- Run this first to confirm the RPC function works:
-- SELECT set_franchise_context('ADMIN', '');
-- SELECT current_setting('app.role', true);  -- Should return 'ADMIN'

-- ─── Enable RLS table by table ─────────────────────────────────────────────

-- Step 1
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;
-- VERIFY: SELECT count(*) FROM customer_profiles; (should return all rows for ADMIN)

-- Step 2
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Step 3
ALTER TABLE public.delivery_orders ENABLE ROW LEVEL SECURITY;

-- Step 4
ALTER TABLE public.delivery_batches ENABLE ROW LEVEL SECURITY;

-- Step 5
ALTER TABLE public.rider_profiles ENABLE ROW LEVEL SECURITY;

-- Step 6
ALTER TABLE public.rider_service_areas ENABLE ROW LEVEL SECURITY;

-- Step 7
ALTER TABLE public.rider_live_locations ENABLE ROW LEVEL SECURITY;

-- Step 8
ALTER TABLE public.rider_monthly_summaries ENABLE ROW LEVEL SECURITY;

-- Step 9
ALTER TABLE public.rider_payouts ENABLE ROW LEVEL SECURITY;

-- Step 10
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Step 11
ALTER TABLE public.razorpay_transactions ENABLE ROW LEVEL SECURITY;

-- Step 12
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

-- Step 13
ALTER TABLE public.addon_orders ENABLE ROW LEVEL SECURITY;

-- Step 14
ALTER TABLE public.addon_order_items ENABLE ROW LEVEL SECURITY;

-- Step 15
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Step 16
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;

-- Step 17
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- POST-ENABLEMENT SMOKE TEST (run after all tables are enabled):
-- 
-- As admin (service role):
--   SELECT set_franchise_context('ADMIN', '');
--   SELECT count(*) FROM customer_profiles;  -- Should see ALL
--   SELECT count(*) FROM subscriptions;      -- Should see ALL
--
-- As franchise admin:
--   SELECT set_franchise_context('FRANCHISE_ADMIN', '<franchise-uuid>');
--   SELECT count(*) FROM customer_profiles;  -- Should see only franchise records
--
-- As core rider:
--   SELECT set_franchise_context('RIDER', '');
--   SELECT count(*) FROM delivery_orders;    -- Should see only NULL franchise_id
-- ============================================================================
