-- ============================================================================
-- Backfill NULL clinic stamps for addresses / customer_profiles / pending orders
-- ============================================================================
--
-- CONTEXT
-- The routing & batching engine (src/actions/system-actions/routeEngine.ts)
-- scopes orders per Core Clinic with `.eq("clinic_id", scope.clinicId)`. An
-- order whose `clinic_id` is NULL belongs to no clinic scope and is never
-- routed, so it shows as "Unassigned" with no rider.
--
-- ROOT CAUSE
-- `delivery_orders.clinic_id` is copied (and frozen) at order-creation time from
-- `addresses.clinic_id` (src/actions/system-actions/orderGeneration.ts). That
-- address stamp is itself resolved from `rider_service_areas` at signup /
-- address-save time (src/lib/clinic/pincode-resolver.ts). When a customer's
-- pincode was mapped to a clinic in `rider_service_areas` AFTER their address
-- was created, the address stamp stayed NULL, and every generated order
-- inherited NULL — permanently unroutable.
--
-- Concrete reported case: customer "T Pranava Sruthi", pincode 500044. The
-- 500044 -> Madhapur Clinic mapping exists in rider_service_areas (with an
-- active rider), but the address + all orders were stamped NULL.
--
-- WHAT THIS SCRIPT DOES (all keyed off the SINGLE source of truth,
-- rider_service_areas, restricted to Core clinics where franchise_id IS NULL):
--   1. Backfill addresses.clinic_id where it is NULL but the pincode maps to a
--      core clinic. Fixes the "Unassigned clinic" display and makes all FUTURE
--      generated orders route correctly.
--   2. Backfill customer_profiles.clinic_id for the affected PRIMARY addresses,
--      keeping the profile stamp consistent with the address.
--   3. Re-stamp only PENDING, UNBATCHED, TODAY-OR-FUTURE delivery_orders whose
--      clinic_id is NULL but whose delivery address pincode maps to a core
--      clinic. This lets the next routing run pick them up.
--
-- IMMUTABILITY NOTE (Req 19.4): order/batch clinic stamps are normally immutable
-- creation-time history and the move_pincode RPC deliberately never touches
-- delivery_orders. This script is a DATA REPAIR that only FILLS IN stamps that
-- were erroneously NULL (never overwriting a non-NULL stamp), and is scoped to
-- future, still-routable orders so historical/delivered attribution is never
-- rewritten.
--
-- SAFE TO RE-RUN: every statement is idempotent (only touches rows still NULL).
-- Wrapped in a single transaction — review the row counts, then COMMIT.
-- Adjust the CURRENT_DATE cutoff if your IST "today" differs from the DB clock.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Addresses: fill NULL clinic_id from the pincode's core-clinic mapping.
-- ---------------------------------------------------------------------------
UPDATE public.addresses a
   SET clinic_id = rsa.clinic_id
  FROM public.rider_service_areas rsa
 WHERE a.clinic_id IS NULL
   AND rsa.pincode = a.pincode
   AND rsa.clinic_id IS NOT NULL
   AND rsa.franchise_id IS NULL;

-- ---------------------------------------------------------------------------
-- 2. Customer profiles: keep profile stamp consistent with the customer's
--    PRIMARY address clinic (only where the profile stamp is still NULL).
-- ---------------------------------------------------------------------------
UPDATE public.customer_profiles cp
   SET clinic_id = a.clinic_id
  FROM public.addresses a
 WHERE cp.clinic_id IS NULL
   AND a.customer_profile_id = cp.id
   AND a.is_primary = true
   AND a.clinic_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Pending, unbatched, today-or-future orders: fill NULL clinic_id so the
--    routing & batching automation can scope and assign them.
-- ---------------------------------------------------------------------------
UPDATE public.delivery_orders o
   SET clinic_id = rsa.clinic_id
  FROM public.addresses a
  JOIN public.rider_service_areas rsa
    ON rsa.pincode = a.pincode
   AND rsa.clinic_id IS NOT NULL
   AND rsa.franchise_id IS NULL
 WHERE o.delivery_address_id = a.id
   AND o.clinic_id IS NULL
   AND o.status = 'ORDER_CREATED'
   AND o.batch_id IS NULL
   AND o.delivery_date >= CURRENT_DATE;

-- Review the affected counts in the transaction output before committing.
COMMIT;
