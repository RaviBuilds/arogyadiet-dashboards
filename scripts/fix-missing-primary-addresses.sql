-- ============================================================================
-- FIX: Mark is_primary = true for customers with exactly 1 address
-- ============================================================================
-- Problem: Bulk-imported customers had their single address marked as
-- is_primary = false. This causes them to not appear correctly in the UI
-- (missing pincode, missing GPS status) and breaks clinic resolution.
--
-- Fix: For any customer_profile that has exactly 1 address and that address
-- has is_primary = false, set it to true.
--
-- Safe: Only touches customers with a single address. Does NOT affect
-- customers with 2 addresses where one is already primary.
-- ============================================================================

UPDATE public.addresses
SET is_primary = true
WHERE id IN (
  SELECT a.id
  FROM addresses a
  WHERE a.is_primary = false
    AND a.customer_profile_id IS NOT NULL
    AND (
      SELECT COUNT(*)
      FROM addresses a2
      WHERE a2.customer_profile_id = a.customer_profile_id
    ) = 1
);
