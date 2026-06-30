-- ============================================================================
-- MIGRATE OLD FRANCHISES (Kolhapur + Hyd1) → Be-Fit Vizag & CLEANUP
-- ============================================================================
-- These two franchises were created under the OLD architecture (no Group,
-- no hierarchy page support). They don't appear in the new Franchise Hierarchy
-- because they have group_id = NULL.
--
-- This script:
--   1. Moves the active customer "Vizag Rahul" to Be-Fit Vizag franchise
--   2. Moves his subscription to Be-Fit Vizag franchise
--   3. Moves the rider "Vizaj Rakesh Rider" to Be-Fit Vizag franchise
--   4. Updates the customer's primary address pincode to one served by Be-Fit Vizag
--   5. Reassigns rider_service_areas pincodes from Kolhapur clinic to Be-Fit Vizag clinic
--   6. Cleans up the archived customer
--   7. Deletes old franchise data (holidays, product settings, pincode requests, pincodes)
--   8. Deletes the Kolhapur and Hyd1 franchises
--   9. Deletes the franchise owner users for Kolhapur and Hyd1
--
-- Be-Fit Vizag IDs:
--   Franchise: 38b99f4f-e426-4ee2-b803-77e6ea12bfb8
--   Clinic:    e4cf0544-6902-4f67-80a6-7dca617f0e4e
--
-- Kolhapur IDs:
--   Franchise: 7f1ad97a-5855-4728-a035-584879073548
--   Owner:     69715dd9-2418-4e19-a31c-ef4dbb919ff3
--   Customer (active): d175c176-6218-4a21-a0df-ea050c77b239 (user: e156a199-5d8b-4ec0-a1cc-9edad231c3f7)
--   Customer (archived): a949ef00-1bbe-40a3-8e33-079c593b17f6 (user: 9cdb3c88-261e-45ee-afbc-f6a242c58851)
--   Rider: 8436dc4a-3d49-463a-9d2b-2b578a20f3dd (user: 1b161c20-010d-4b63-94b1-512e37689e79)
--   Subscription: b9c59aee-cd88-49d3-a0e6-ef37998e447e
--
-- Hyd1 IDs:
--   Franchise: 305e67a2-7f5b-4944-91f8-d603b4add148
--   Owner:     c4f08407-2bd1-4c8a-8b27-7e3ff0bd2e7f
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- STEP 1: Move active customer "Vizag Rahul" → Be-Fit Vizag franchise & clinic
-- ============================================================================
UPDATE customer_profiles
SET franchise_id = '38b99f4f-e426-4ee2-b803-77e6ea12bfb8',
    clinic_id = 'e4cf0544-6902-4f67-80a6-7dca617f0e4e'
WHERE id = 'd175c176-6218-4a21-a0df-ea050c77b239';

-- Update the customer's user record franchise_id
UPDATE users
SET franchise_id = '38b99f4f-e426-4ee2-b803-77e6ea12bfb8'
WHERE id = 'e156a199-5d8b-4ec0-a1cc-9edad231c3f7';

-- ============================================================================
-- STEP 2: Move subscription → Be-Fit Vizag franchise
-- ============================================================================
UPDATE subscriptions
SET franchise_id = '38b99f4f-e426-4ee2-b803-77e6ea12bfb8'
WHERE id = 'b9c59aee-cd88-49d3-a0e6-ef37998e447e';

-- ============================================================================
-- STEP 3: Move rider → Be-Fit Vizag franchise & clinic
-- ============================================================================
UPDATE rider_profiles
SET franchise_id = '38b99f4f-e426-4ee2-b803-77e6ea12bfb8',
    clinic_id = 'e4cf0544-6902-4f67-80a6-7dca617f0e4e'
WHERE id = '8436dc4a-3d49-463a-9d2b-2b578a20f3dd';

-- Update the rider's user record franchise_id
UPDATE users
SET franchise_id = '38b99f4f-e426-4ee2-b803-77e6ea12bfb8'
WHERE id = '1b161c20-010d-4b63-94b1-512e37689e79';

-- ============================================================================
-- STEP 4: Update customer's primary address → pincode served by Be-Fit Vizag
-- The clinic already assigned pincode 416200 to Be-Fit Vizag clinic.
-- We'll update the address pincode to 530008 (Vizag pincode assigned to clinic).
-- Also reassign address clinic_id and franchise_id.
-- ============================================================================
UPDATE addresses
SET pincode = '530008',
    city = 'Vizag',
    clinic_id = 'e4cf0544-6902-4f67-80a6-7dca617f0e4e',
    franchise_id = '38b99f4f-e426-4ee2-b803-77e6ea12bfb8'
WHERE id = '9744763e-02be-473f-b2a6-d20b9e661205';

-- ============================================================================
-- STEP 5: Reassign rider_service_areas from Kolhapur franchise → Be-Fit Vizag
-- The pincodes 416206, 416207 were pointing to Uppal Clinic (core) which is wrong.
-- Pincode 416208 already points to Be-Fit Vizag clinic.
-- We move ALL of this rider's service areas to Be-Fit Vizag clinic + franchise.
-- ============================================================================
UPDATE rider_service_areas
SET franchise_id = '38b99f4f-e426-4ee2-b803-77e6ea12bfb8',
    clinic_id = 'e4cf0544-6902-4f67-80a6-7dca617f0e4e'
WHERE rider_id = '8436dc4a-3d49-463a-9d2b-2b578a20f3dd';

-- ============================================================================
-- STEP 6: Update delivery orders that were stamped with Kolhapur franchise
-- ============================================================================
UPDATE delivery_orders
SET franchise_id = '38b99f4f-e426-4ee2-b803-77e6ea12bfb8',
    clinic_id = 'e4cf0544-6902-4f67-80a6-7dca617f0e4e'
WHERE customer_profile_id = 'd175c176-6218-4a21-a0df-ea050c77b239'
  AND franchise_id = '7f1ad97a-5855-4728-a035-584879073548';

-- ============================================================================
-- STEP 7: Delete the archived customer (no subscriptions, inactive)
-- ============================================================================
-- Delete addresses first (FK)
DELETE FROM addresses WHERE customer_profile_id = 'a949ef00-1bbe-40a3-8e33-079c593b17f6';
-- Delete the archived customer profile
DELETE FROM customer_profiles WHERE id = 'a949ef00-1bbe-40a3-8e33-079c593b17f6';
-- Delete the archived customer's user record
DELETE FROM users WHERE id = '9cdb3c88-261e-45ee-afbc-f6a242c58851';

-- ============================================================================
-- STEP 8: Clean up Kolhapur franchise ancillary data
-- ============================================================================
-- Holidays
DELETE FROM holidays WHERE franchise_id = '7f1ad97a-5855-4728-a035-584879073548';
-- Product settings
DELETE FROM franchise_product_settings WHERE franchise_id = '7f1ad97a-5855-4728-a035-584879073548';
-- Pincode requests
DELETE FROM franchise_pincode_requests WHERE franchise_id = '7f1ad97a-5855-4728-a035-584879073548';
-- Franchise pincodes (old pincode-to-franchise mapping table)
DELETE FROM franchise_pincodes WHERE franchise_id = '7f1ad97a-5855-4728-a035-584879073548';
DELETE FROM franchise_pincodes WHERE franchise_id = '305e67a2-7f5b-4944-91f8-d603b4add148';

-- ============================================================================
-- STEP 9: Delete Kolhapur and Hyd1 franchises
-- ============================================================================
DELETE FROM franchises WHERE id = '7f1ad97a-5855-4728-a035-584879073548';
DELETE FROM franchises WHERE id = '305e67a2-7f5b-4944-91f8-d603b4add148';

-- ============================================================================
-- STEP 10: Delete franchise owner users for Kolhapur and Hyd1
-- ============================================================================
DELETE FROM users WHERE id = '69715dd9-2418-4e19-a31c-ef4dbb919ff3';
DELETE FROM users WHERE id = 'c4f08407-2bd1-4c8a-8b27-7e3ff0bd2e7f';

COMMIT;
