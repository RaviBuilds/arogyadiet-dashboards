-- ============================================================================
-- FRANCHISE RLS POLICIES — Phase 4 (Creates policies, does NOT enable RLS)
-- ============================================================================
-- 
-- IMPORTANT: This script CREATES policies only. RLS is NOT enabled here.
-- Policies sit idle until you run enable-franchise-rls.sql.
--
-- Policy Logic:
--   ADMIN / MASTER_ADMIN → see ALL rows (core + all franchises) 
--   FRANCHISE_ADMIN → see only rows where franchise_id = their franchise_id
--   RIDER / CUSTOMER (core) → see only rows where franchise_id IS NULL
--   RIDER / CUSTOMER (franchise) → see only rows matching their franchise_id
--
-- Session variables required (set by application code):
--   app.role — user's role code (ADMIN, MASTER_ADMIN, FRANCHISE_ADMIN, RIDER, CUSTOMER)
--   app.franchise_id — user's franchise_id (empty string or UUID)
--
-- Rollback: Run disable-franchise-rls.sql then DROP each policy manually
-- ============================================================================

-- Helper function to check if current user has global access
CREATE OR REPLACE FUNCTION public.is_global_role()
RETURNS boolean AS $$
BEGIN
  RETURN current_setting('app.role', true) IN ('ADMIN', 'MASTER_ADMIN');
EXCEPTION
  WHEN OTHERS THEN RETURN false;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Helper function to get current user's franchise_id (returns NULL if empty or not set)
CREATE OR REPLACE FUNCTION public.current_franchise_id()
RETURNS uuid AS $$
DECLARE
  fid text;
BEGIN
  fid := current_setting('app.franchise_id', true);
  IF fid IS NULL OR fid = '' THEN
    RETURN NULL;
  END IF;
  RETURN fid::uuid;
EXCEPTION
  WHEN OTHERS THEN RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================================
-- CREATE POLICIES FOR EACH TENANT-ISOLATED TABLE
-- Pattern: 
--   SELECT: global role sees all; franchise user sees own; core user sees NULL
--   INSERT: franchise user must stamp own franchise_id; global can insert any
--   UPDATE: same as SELECT (can only update what you can see)
--   DELETE: same as SELECT (can only delete what you can see)
-- ============================================================================

-- ─── customer_profiles ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_customer_profiles ON public.customer_profiles;
CREATE POLICY franchise_select_customer_profiles ON public.customer_profiles
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_customer_profiles ON public.customer_profiles;
CREATE POLICY franchise_insert_customer_profiles ON public.customer_profiles
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_customer_profiles ON public.customer_profiles;
CREATE POLICY franchise_update_customer_profiles ON public.customer_profiles
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_delete_customer_profiles ON public.customer_profiles;
CREATE POLICY franchise_delete_customer_profiles ON public.customer_profiles
  FOR DELETE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── subscriptions ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_subscriptions ON public.subscriptions;
CREATE POLICY franchise_select_subscriptions ON public.subscriptions
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_subscriptions ON public.subscriptions;
CREATE POLICY franchise_insert_subscriptions ON public.subscriptions
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_subscriptions ON public.subscriptions;
CREATE POLICY franchise_update_subscriptions ON public.subscriptions
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_delete_subscriptions ON public.subscriptions;
CREATE POLICY franchise_delete_subscriptions ON public.subscriptions
  FOR DELETE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── delivery_orders ───────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_delivery_orders ON public.delivery_orders;
CREATE POLICY franchise_select_delivery_orders ON public.delivery_orders
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_delivery_orders ON public.delivery_orders;
CREATE POLICY franchise_insert_delivery_orders ON public.delivery_orders
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_delivery_orders ON public.delivery_orders;
CREATE POLICY franchise_update_delivery_orders ON public.delivery_orders
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_delete_delivery_orders ON public.delivery_orders;
CREATE POLICY franchise_delete_delivery_orders ON public.delivery_orders
  FOR DELETE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── delivery_batches ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_delivery_batches ON public.delivery_batches;
CREATE POLICY franchise_select_delivery_batches ON public.delivery_batches
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_delivery_batches ON public.delivery_batches;
CREATE POLICY franchise_insert_delivery_batches ON public.delivery_batches
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_delivery_batches ON public.delivery_batches;
CREATE POLICY franchise_update_delivery_batches ON public.delivery_batches
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── rider_profiles ────────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_rider_profiles ON public.rider_profiles;
CREATE POLICY franchise_select_rider_profiles ON public.rider_profiles
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_rider_profiles ON public.rider_profiles;
CREATE POLICY franchise_insert_rider_profiles ON public.rider_profiles
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_rider_profiles ON public.rider_profiles;
CREATE POLICY franchise_update_rider_profiles ON public.rider_profiles
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── rider_service_areas ───────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_rider_service_areas ON public.rider_service_areas;
CREATE POLICY franchise_select_rider_service_areas ON public.rider_service_areas
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_rider_service_areas ON public.rider_service_areas;
CREATE POLICY franchise_insert_rider_service_areas ON public.rider_service_areas
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_rider_service_areas ON public.rider_service_areas;
CREATE POLICY franchise_update_rider_service_areas ON public.rider_service_areas
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── rider_live_locations ──────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_rider_live_locations ON public.rider_live_locations;
CREATE POLICY franchise_select_rider_live_locations ON public.rider_live_locations
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_rider_live_locations ON public.rider_live_locations;
CREATE POLICY franchise_update_rider_live_locations ON public.rider_live_locations
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── rider_monthly_summaries ───────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_rider_monthly_summaries ON public.rider_monthly_summaries;
CREATE POLICY franchise_select_rider_monthly_summaries ON public.rider_monthly_summaries
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_rider_monthly_summaries ON public.rider_monthly_summaries;
CREATE POLICY franchise_insert_rider_monthly_summaries ON public.rider_monthly_summaries
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_rider_monthly_summaries ON public.rider_monthly_summaries;
CREATE POLICY franchise_update_rider_monthly_summaries ON public.rider_monthly_summaries
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── rider_payouts ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_rider_payouts ON public.rider_payouts;
CREATE POLICY franchise_select_rider_payouts ON public.rider_payouts
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_rider_payouts ON public.rider_payouts;
CREATE POLICY franchise_insert_rider_payouts ON public.rider_payouts
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── payments ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_payments ON public.payments;
CREATE POLICY franchise_select_payments ON public.payments
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_payments ON public.payments;
CREATE POLICY franchise_insert_payments ON public.payments
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_payments ON public.payments;
CREATE POLICY franchise_update_payments ON public.payments
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── razorpay_transactions ─────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_razorpay_transactions ON public.razorpay_transactions;
CREATE POLICY franchise_select_razorpay_transactions ON public.razorpay_transactions
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_razorpay_transactions ON public.razorpay_transactions;
CREATE POLICY franchise_insert_razorpay_transactions ON public.razorpay_transactions
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── products ──────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_products ON public.products;
CREATE POLICY franchise_select_products ON public.products
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_products ON public.products;
CREATE POLICY franchise_insert_products ON public.products
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_products ON public.products;
CREATE POLICY franchise_update_products ON public.products
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── addon_orders ──────────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_addon_orders ON public.addon_orders;
CREATE POLICY franchise_select_addon_orders ON public.addon_orders
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_addon_orders ON public.addon_orders;
CREATE POLICY franchise_insert_addon_orders ON public.addon_orders
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── addon_order_items ─────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_addon_order_items ON public.addon_order_items;
CREATE POLICY franchise_select_addon_order_items ON public.addon_order_items
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_addon_order_items ON public.addon_order_items;
CREATE POLICY franchise_insert_addon_order_items ON public.addon_order_items
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── notifications ─────────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_notifications ON public.notifications;
CREATE POLICY franchise_select_notifications ON public.notifications
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_notifications ON public.notifications;
CREATE POLICY franchise_insert_notifications ON public.notifications
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── addresses ─────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_addresses ON public.addresses;
CREATE POLICY franchise_select_addresses ON public.addresses
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_addresses ON public.addresses;
CREATE POLICY franchise_insert_addresses ON public.addresses
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_addresses ON public.addresses;
CREATE POLICY franchise_update_addresses ON public.addresses
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── coupons ───────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_coupons ON public.coupons;
CREATE POLICY franchise_select_coupons ON public.coupons
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_coupons ON public.coupons;
CREATE POLICY franchise_insert_coupons ON public.coupons
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_coupons ON public.coupons;
CREATE POLICY franchise_update_coupons ON public.coupons
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );


-- ============================================================================
-- RPC FUNCTION: set_franchise_context
-- Called by application code to set session variables before queries
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_franchise_context(p_role text, p_franchise_id text)
RETURNS void AS $$
BEGIN
  PERFORM set_config('app.role', p_role, true);
  PERFORM set_config('app.franchise_id', p_franchise_id, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
