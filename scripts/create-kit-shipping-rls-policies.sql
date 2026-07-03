-- ============================================================================
-- KIT SHIPPING INFO RLS POLICIES
-- ============================================================================
--
-- Spec: kit-subscription-management — Task 19.2 — Requirements: Security considerations, 8.3
--
-- Enables RLS and creates policies for the kit_shipping_info table.
-- Shipping information is customer-specific data that must be protected with
-- strict access controls.
--
-- Policy Logic:
--   ADMIN / MASTER_ADMIN (global role) → Full CRUD access to all shipping records
--   CUSTOMERS → Read-only access to their own shipping information only
--
-- Access Patterns:
--   - Admin Portal (Shipping Dashboard): Create and manage shipping information for any KIT customer
--   - Customer Portal: View their own shipping status and tracking information (Req 8.3)
--
-- Security Model:
--   - Customers filtered by customer_profile_id matching authenticated user
--   - Only admins can create, update, or delete shipping records
--   - Customers have read-only access to their own data
--
-- Depends on: is_global_role() helper function from create-franchise-rls-policies.sql
--
-- Requirements validated: Security considerations for KIT shipping management, Requirement 8.3
-- ============================================================================

-- ─── kit_shipping_info ─────────────────────────────────────────────────────

ALTER TABLE public.kit_shipping_info ENABLE ROW LEVEL SECURITY;

-- SELECT Policy: Admins see all records; customers see only their own shipping info
DROP POLICY IF EXISTS kit_shipping_info_select ON public.kit_shipping_info;
CREATE POLICY kit_shipping_info_select ON public.kit_shipping_info
  FOR SELECT USING (
    is_global_role()
    OR customer_profile_id IN (
      SELECT id FROM public.customer_profiles 
      WHERE user_id = auth.uid()
    )
  );

-- INSERT Policy: Only admins can create shipping records
DROP POLICY IF EXISTS kit_shipping_info_insert ON public.kit_shipping_info;
CREATE POLICY kit_shipping_info_insert ON public.kit_shipping_info
  FOR INSERT WITH CHECK (
    is_global_role()
  );

-- UPDATE Policy: Only admins can update shipping records
DROP POLICY IF EXISTS kit_shipping_info_update ON public.kit_shipping_info;
CREATE POLICY kit_shipping_info_update ON public.kit_shipping_info
  FOR UPDATE USING (
    is_global_role()
  );

-- DELETE Policy: Only admins can delete shipping records
DROP POLICY IF EXISTS kit_shipping_info_delete ON public.kit_shipping_info;
CREATE POLICY kit_shipping_info_delete ON public.kit_shipping_info
  FOR DELETE USING (
    is_global_role()
  );

-- ============================================================================
-- POST-ENABLEMENT SMOKE TEST:
--
-- As admin (service role):
--   SELECT set_franchise_context('ADMIN', '');
--   SELECT count(*) FROM kit_shipping_info;                -- Should see ALL records
--   INSERT INTO kit_shipping_info (
--     customer_profile_id, subscription_id, courier_partner, tracking_number
--   ) VALUES (
--     '<customer-uuid>', '<subscription-uuid>', 'DTDC', 'TRACK123'
--   );                                                       -- Should succeed
--   UPDATE kit_shipping_info SET tracking_number = 'TRACK456' 
--     WHERE tracking_number = 'TRACK123';                   -- Should succeed
--   DELETE FROM kit_shipping_info 
--     WHERE tracking_number = 'TRACK456';                   -- Should succeed
--
-- As customer (authenticated user, non-admin):
--   SELECT set_franchise_context('CUSTOMER', '<franchise-uuid>');
--   SELECT count(*) FROM kit_shipping_info 
--     WHERE customer_profile_id = '<own-customer-profile-id>';  -- Should see only own records
--   SELECT count(*) FROM kit_shipping_info 
--     WHERE customer_profile_id != '<own-customer-profile-id>'; -- Should see 0
--   INSERT INTO kit_shipping_info (
--     customer_profile_id, subscription_id, courier_partner, tracking_number
--   ) VALUES (...);                                         -- Should FAIL
--   UPDATE kit_shipping_info SET tracking_number = 'X';    -- Should FAIL
--   DELETE FROM kit_shipping_info WHERE id = '<any-id>';   -- Should FAIL
--
-- As anonymous (not authenticated):
--   SELECT count(*) FROM kit_shipping_info;                -- Should see 0
--   INSERT INTO kit_shipping_info (...);                   -- Should FAIL
-- ============================================================================
