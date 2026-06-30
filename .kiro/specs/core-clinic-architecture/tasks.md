# Implementation Plan: Core Clinic Architecture

## Overview

This plan implements the revised **Business → Kitchen → Clinic** hierarchy in TypeScript (Next.js App Router, Server Actions, Supabase) per the current design. It supersedes the previously implemented City → Kitchen → Clinic model (kitchen-coordinate seed + delivery-address stamping); every task below is marked not-started and the orchestrator will execute the full plan fresh against the revised design and requirements.

Work proceeds bottom-up: additive SQL schema (new `businesses` table, `kitchens.business_id` nullable → backfill → NOT NULL, no-geo Kitchen, clinic/city/snapshot/order-stamp columns) and shared types first; then pure domain logic (business/clinic/city validation, pincode resolution, primary-address stamping, conflict detection, reassignment selection, order/batch stamp guards, payout, aggregation) that carries the property-based tests; then the Server Actions (business/city/kitchen/clinic/service-area/rider/conflict/workload), the per-clinic routing engine and daily pipeline, and finally the master and admin UI surfaces. The rewritten seed migration and feature-flag equivalence guards close the plan.

Every pure-logic module is isolated in `src/lib/clinic/*` so the **44 correctness properties** can be tested with `fast-check` (minimum 100 generated cases each) without a live Supabase connection. Each property test carries the tag comment `// Feature: core-clinic-architecture, Property {number}: {property text}`.

Key deltas from the prior implementation:
- New `businesses` table and `kitchens.business_id`; Kitchen no longer carries geo; Clinic resolves Business via Kitchen (no `business_id` on clinics).
- Customer stamping anchored to the **Primary_Address** pincode (`is_primary = true`); delivery-address selection never re-stamps.
- New Conflict Clinic flow (`detectClinicConflict`, derived `Conflict_Clinic_List`, admin surface).
- Order stamp = delivery-address clinic at creation; batch stamp = rider clinic; immutability guard.
- Rewritten seed: Core Hyderabad Business → no-geo Hyderabad Central Kitchen → Madhapur + Uppal clinics with coordinates set directly.
- New additive master **Core Business** section; existing **Core Clinic Management** card untouched.

## Tasks

- [x] 1. Establish revised schema, shared types, and Zod schemas
  - [x] 1.1 Add additive SQL schema for the Business → Kitchen → Clinic hierarchy
    - Create `scripts/create-clinic-hierarchy-tables.sql` (additive, RLS-respecting) adding the new `businesses` table (`id`, `name VARCHAR(100)`, `type VARCHAR(20) CHECK (type IN ('Core','Franchise'))`, timestamps, `idx_businesses_type`); the `cities` table with `uq_cities_name_lower`; the `clinics` table (`name VARCHAR(200)`, `address VARCHAR(500)`, `latitude/longitude DOUBLE PRECISION` with range CHECKs, `kitchen_id NOT NULL FK`, nullable `franchise_id FK`, indexes); and the `workload_snapshots` table (`clinic_id`, `kitchen_id`, `target_date`, veg/non_veg/egg counts + `shop_product_counts JSONB` with 0..100000 CHECKs, `uq_snapshot_clinic_kitchen_date`, supporting indexes)
    - Add `kitchens.business_id` and `kitchens.city_id` as **nullable** FKs with `idx_kitchens_business`/`idx_kitchens_city`; the seed (Task 14.1) backfills `business_id` and promotes it to `NOT NULL`. Do not drop any existing `kitchens` lat/lng columns; document them as no-longer-used (no routing/seed origin)
    - Add nullable `clinic_id` FK columns to `rider_service_areas` (with global `uq_service_area_pincode` unique index + `idx_service_areas_clinic`), `rider_profiles`, `customer_profiles`, and `addresses`
    - _Requirements: 1.1, 2.1, 2.2, 2.4, 2.5, 3.1, 3.2, 4.1, 4.2, 6.1, 8.1, 12.1, 18.1, 18.2, 20.1, 20.8_

  - [x] 1.2 Add additive SQL for order/batch clinic stamp
    - Create/replace `scripts/add-clinic-stamp-to-orders.sql` adding nullable `clinic_id UUID REFERENCES clinics(id)` to `delivery_orders` and `delivery_batches`
    - Add indexes `idx_delivery_orders_clinic_date` on `delivery_orders(clinic_id, delivery_date)`, `idx_delivery_orders_date` on `delivery_orders(delivery_date)` (supports the conflict-list scan), and `idx_delivery_batches_clinic_date` on `delivery_batches(clinic_id, delivery_date)`
    - Standalone additive migration run separately; nullable so an unresolved clinic never blocks order/batch creation; `addon_orders` inherit clinic via `delivery_order_id` (no own column)
    - _Requirements: 19.1, 22.7_

  - [x] 1.3 Define shared TypeScript types for the business/clinic domain
    - Create/replace `src/types/clinic.ts` with `BusinessType` (`"Core" | "Franchise"`), `Business`, `City`, `Kitchen` (with `business_id`, `city_id`, and **no** address/lat/lng), `Clinic` (with `kitchen_id`, nullable `franchise_id`, no `business_id`), `WorkloadSnapshot`, `WorkloadAggregate`, `OrderClinicStamp`, and the `ActionResult<T>` discriminated union (`{ success: true; data } | { success: false; error; field? }`)
    - _Requirements: 3.1, 12.1, 19.1, 20.1, 20.9_

  - [x] 1.4 Define Zod schemas for the business/clinic domain
    - Create/replace `src/validations/clinic.ts` with `pincodeSchema` (`/^\d{6}$/`), `businessSchema` (`name` trimmed 1..100, `type` enum), `kitchenSchema` (`name`, `business_id` uuid, `city_id` uuid, **no** geo), `clinicCreateSchema` (Req 3 bounds: name 1..120 / address 1..255), `clinicMasterSchema` (Req 14/21 bounds: name 1..200 / address 1..500), and `citySchema` (name 1..100)
    - _Requirements: 1.1, 3.5, 5.4, 14.2, 20.1, 21.5_

- [x] 2. Implement pure validation and classification logic
  - [x] 2.1 Implement pure validators in `src/lib/clinic/validation.ts`
    - Implement `validateBusinessInput` (trims name; returns `name: empty|too_long` or `type: invalid`; `[]` when valid), `validateClinicInput(input, { nameMax, addressMax })` (parameterized per surface; returns one error per offending field across name/address/latitude/longitude/kitchen_id), `validateCityName(name, existingNamesLower, currentIdLowerName?)` (empty/too_long/duplicate, self-rename allowed), `isValidPincode` (exactly 6 digits), `sameCity(clinicCityId, kitchenCityId)`, and `isCoreClinic(franchiseId)` helper
    - Pure, no Supabase dependency, so all are property-testable in isolation
    - _Requirements: 1.1, 1.3, 1.4, 2.10, 2.13, 2.14, 3.4, 3.5, 3.6, 3.7, 5.4, 14.2, 14.3, 18.1, 20.1, 20.3, 20.4, 21.5, 21.6_

  - [x]* 2.2 Write property test for city-name validity and uniqueness
    - **Property 1: City name validity and case-insensitive uniqueness**
    - **Validates: Requirements 1.1, 1.3, 1.4**

  - [x]* 2.3 Write property test for business input validation
    - **Property 2: Business input validation identifies the offending field**
    - **Validates: Requirements 20.1, 20.3, 20.4**

  - [x]* 2.4 Write property test for clinic input validation (parameterized bounds)
    - **Property 6: Clinic input validation identifies every offending field**
    - **Validates: Requirements 3.5, 3.6, 3.7, 14.2, 14.3, 21.5, 21.6**

  - [x]* 2.5 Write property test for pincode format validation
    - **Property 11: Pincode format validation**
    - **Validates: Requirements 5.4**

  - [x]* 2.6 Write property test for Core Clinic classification
    - **Property 8: Core Clinic classification**
    - **Validates: Requirements 3.4, 18.1**

- [x] 3. Implement repositories and master-portal business/city/kitchen/clinic actions
  - [x] 3.1 Create business/clinic-domain repositories
    - Add `src/repositories/clinic/` data-access functions for businesses, cities, kitchens (business + city association, no geo), clinics (with Clinic → Kitchen → Business resolution), service areas, snapshots, and dependency counts, using `createAdminClient`/server client per layering rules
    - _Requirements: 1.1, 2.2, 2.4, 3.1, 3.2, 3.10, 20.1, 20.8, 20.9_

  - [x] 3.2 Implement business Server Actions
    - Create `src/actions/master-actions/businessActions.ts` with `createBusiness`, `updateBusiness` (404 when id not found), `deleteBusiness` (dependency-guarded against kitchens), using `validateBusinessInput`
    - _Requirements: 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.10, 20.11_

  - [x] 3.3 Implement city Server Actions
    - Create `src/actions/master-actions/cityActions.ts` with `createCity`, `updateCity`, `deleteCity` enforcing name validation and dependency-guarded deletion (reject when associated kitchens exist)
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 14.7_

  - [x] 3.4 Implement kitchen Server Actions (no geo) with business + city association and clinic reassignment
    - Create `src/actions/master-actions/kitchenActions.ts` with `createKitchen`, `updateKitchen`, `deleteKitchen` (each requires valid `business_id` and `city_id`, persists **no** address/lat/lng, dependency-guarded), and `reassignClinicKitchen(clinicId, newKitchenId)` enforcing the same-city rule (accept only when target kitchen city equals clinic city; otherwise reject leaving `kitchen_id` unchanged) and re-resolving Business via the new kitchen
    - _Requirements: 2.2, 2.3, 2.5, 2.6, 2.8, 2.9, 2.12, 2.13, 2.14, 14.7_

  - [x] 3.5 Implement clinic Server Actions
    - Create `src/actions/master-actions/clinicActions.ts` with `createClinic`, `updateClinic`, `deleteClinic`; enforce clinic↔kitchen same-city rule, surface-parameterized validation bounds, nullable `franchise_id` (NULL = Core), and dependency-guarded deletion; never store `business_id` on clinics
    - _Requirements: 3.1, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 14.4, 14.5, 14.6, 21.5, 21.6_

  - [x]* 3.6 Write property test for dependency-guarded deletion
    - **Property 3: Dependency-guarded deletion** (Business, City, Kitchen, Clinic)
    - **Validates: Requirements 1.5, 1.6, 14.5, 14.6, 20.5, 20.6**

  - [x]* 3.7 Write property test for kitchen requiring valid business and city
    - **Property 4: Kitchen requires a valid Business and City**
    - **Validates: Requirements 2.8, 2.9, 2.4**

  - [x]* 3.8 Write property test for clinic–kitchen same-city and Business re-resolution
    - **Property 5: Clinic–Kitchen association obeys the same-city rule and re-resolves the Business**
    - **Validates: Requirements 2.10, 2.13, 2.14, 3.10, 20.9**

  - [x]* 3.9 Write property test for clinic persistence round-trip
    - **Property 7: Clinic persistence round-trip**
    - **Validates: Requirements 3.1, 14.4**

  - [x]* 3.10 Write unit tests for business/city/kitchen/clinic happy-paths and not-found
    - Cover Requirements 1.2, 1.7, 2.12, 3.8, 14.1, 20.2, 20.7 example cases
    - _Requirements: 1.2, 1.7, 2.12, 3.8, 14.1, 20.2, 20.7_

- [x] 4. Checkpoint - schema, types, and master-portal CRUD logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement service-area-by-clinic logic, atomic move, and reassignment (primary-address keyed)
  - [x] 5.1 Implement service-area clinic-aware Server Actions
    - Create/extend `src/actions/admin-actions/serviceAreaActions.ts` with `addPincodeToClinic`, `editPincode`, `deletePincode`, surfacing already-assigned (current owner identified) and bad-format errors against `uq_service_area_pincode`
    - _Requirements: 4.1, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.8_

  - [x] 5.2 Update the move-pincode RPC to be primary-address keyed and wire the move action
    - Update `scripts/create-move-pincode-rpc.sql` so `move_pincode_and_reassign` runs in a single transaction: move the service area, and re-stamp customers/addresses whose **primary** address (`is_primary = true`) carries the moved pincode + source clinic; never touch `delivery_orders.clinic_id` / `delivery_batches.clinic_id` (immutable stamps)
    - Add `movePincode(pincode, fromClinicId, toClinicId)` to `serviceAreaActions.ts` returning `{ reassignedCount, riderWarnings }`
    - _Requirements: 4.4, 4.5, 5.7, 7.1, 7.2, 7.3, 19.4_

  - [x] 5.3 Implement customer auto-reassignment module (primary-address keyed)
    - Create `src/lib/clinic/reassignment.ts` (`reassignCustomersOnPincodeMove`) mirroring the `assignWaitlistedCustomers` batch pattern, executed inside the move transaction; selects exactly customers whose **Primary_Address** pincode equals the moved pincode and whose stamped clinic is the source, updating both `customer_profiles.clinic_id` and the matching primary `addresses.clinic_id`; returns the count (0 when none); leaves all unchanged on failure
    - Must not modify `delivery_orders`/`delivery_batches` clinic stamps (historical immutability)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 19.4_

  - [x] 5.4 Implement pincode-move rider-mismatch warning helper
    - Add a pure helper producing `RiderClinicWarning[]` for every rider mapping a moved pincode whose linked clinic differs from the destination clinic
    - _Requirements: 9.4_

  - [x]* 5.5 Write property test for one-pincode-one-clinic invariant
    - **Property 9: One pincode belongs to exactly one clinic**
    - **Validates: Requirements 4.1, 4.3, 5.3**

  - [x]* 5.6 Write property test for atomic single-homed move
    - **Property 10: Pincode move is atomic and single-homed**
    - **Validates: Requirements 4.4, 5.7**

  - [x]* 5.7 Write property test for service-area partition by clinic
    - **Property 12: Service areas partition by clinic**
    - **Validates: Requirements 5.1**

  - [x]* 5.8 Write property test for auto-reassignment matching the primary-address subset
    - **Property 15: Customer auto-reassignment selects exactly the matching Primary_Address subset**
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [x]* 5.9 Write property test for reassignment atomicity on failure
    - **Property 16: Reassignment is atomic on failure**
    - **Validates: Requirements 7.5**

  - [x]* 5.10 Write property test for pincode-move clinic-mismatch warning
    - **Property 20: Pincode-move clinic-mismatch warning**
    - **Validates: Requirements 9.4**

- [x] 6. Implement customer clinic stamping by Primary_Address
  - [x] 6.1 Implement pincode-to-clinic resolver
    - Create `src/lib/clinic/pincode-resolver.ts` (`resolveClinicForPincode` returning `resolved` / `none` / `ambiguous`)
    - _Requirements: 6.1, 6.4, 6.6_

  - [x] 6.2 Implement primary-address stamping module and wire into signup / address-update
    - Create `src/lib/clinic/stamping.ts` with pure `resolveCustomerStamp(primaryAddressResolution, currentClinicId)` (`{ next }` for resolved/none, `{ unchanged: true }` for ambiguous); wire it into `addressActions.ts` and the signup flow so the **Primary_Address** pincode is resolved and `customer_profiles.clinic_id` + primary `addresses.clinic_id` are persisted within the same operation; clear to unset on no-resolution; leave unchanged on ambiguity
    - Ensure **Delivery_Address selection for a day does NOT call the stamper** and never changes `customer_profiles.clinic_id`; preserve all existing signup/address-update inputs, outputs, and completion behavior aside from stamping
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7, 6.8_

  - [x]* 6.3 Write property test for primary-address stamping
    - **Property 13: Customer clinic stamping reflects the Primary_Address pincode resolution**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**

  - [x]* 6.4 Write property test for delivery-address selection never re-stamping
    - **Property 14: Delivery-address selection never changes the customer's clinic stamp**
    - **Validates: Requirements 6.7**

  - [x]* 6.5 Write regression test preserving signup/address-update behavior
    - Verify accepted inputs, outcomes, and completion behavior are unchanged aside from stamping
    - _Requirements: 6.8_

- [x] 7. Implement order/batch clinic-stamp module
  - [x] 7.1 Implement `src/lib/clinic/order-stamp.ts`
    - Pure `resolveOrderClinicStamp(deliveryAddressClinicId)` (order stamp = delivery-address clinic at creation; null when unresolved, never blocks creation), `resolveBatchClinicStamp(riderClinicId)` (batch stamp = rider's linked clinic at routing time; null when unlinked, never blocks creation), and `assertStampImmutable(current, incoming)` (ok only on unset → set; rejects any change to an already-set stamp with reason `"immutable"`)
    - No Supabase dependency so it is property-testable in isolation; consumed by the daily pipeline (order creation) and routing engine (batch creation)
    - _Requirements: 19.2, 19.3, 19.4, 19.5, 19.8, 19.9, 22.3_

  - [x]* 7.2 Write property test for creation-time order/batch stamping
    - **Property 40: Order and batch clinic stamps are set once at creation from the delivery-address / rider clinic**
    - **Validates: Requirements 19.2, 19.3, 19.8, 19.9, 22.3**

  - [x]* 7.3 Write property test for clinic-stamp immutability
    - **Property 41: Clinic stamp is immutable after creation**
    - **Validates: Requirements 19.4, 19.5**

  - [x]* 7.4 Write property test for stamp-derived workload/history attribution
    - **Property 42: Per-clinic workload and history derive from the order stamp**
    - **Validates: Requirements 19.6, 19.7**

- [x] 8. Implement Conflict Clinic flow
  - [x] 8.1 Implement pure conflict detector
    - Create `src/lib/clinic/conflict.ts` with `detectClinicConflict(primaryClinicId, deliveryClinicId)` returning `none` (same clinic), `mismatch` (both non-null and differ), or `unresolved` (delivery resolves to no clinic); never alters the customer's stamp
    - _Requirements: 22.1, 22.2, 22.4, 22.5, 22.8_

  - [x] 8.2 Implement Conflict_Clinic_List read model and action
    - Add the derived `Conflict_Clinic_List` query (per delivery day: `delivery_orders` whose `clinic_id IS DISTINCT FROM customer_profiles.clinic_id`) and `getConflictClinicList(deliveryDate)` in `src/actions/admin-actions/conflictActions.ts` returning `ConflictClinicEntry[]`, restricted to `ADMIN`/`MASTER_ADMIN`
    - Tie into order creation so the conflict list reads from the delivery-address order stamp while `customer_profiles.clinic_id` stays anchored to the Primary_Address clinic (no customer move)
    - _Requirements: 22.2, 22.3, 22.5, 22.6, 22.7, 22.8_

  - [x]* 8.3 Write property test for conflict detection truth table
    - **Property 43: Conflict Clinic detection**
    - **Validates: Requirements 22.1, 22.2, 22.4, 22.5, 22.8**

  - [x]* 8.4 Write property test for Conflict_Clinic_List membership
    - **Property 44: Conflict_Clinic_List membership matches per-day conflicts**
    - **Validates: Requirements 22.2, 22.4, 22.7**

- [x] 9. Implement rider-clinic linkage and service-area constraint
  - [x] 9.1 Implement rider-clinic Server Actions
    - Create `src/actions/admin-actions/riderClinicActions.ts` with `assignRiderToClinic` (manual-only via `rider_profiles.clinic_id`, replaces existing linkage, rejects invalid/inactive clinic), `getAssignablePincodesForRider` (= the rider's linked clinic's pincodes), `assignServiceAreaToRider` (rejects when no clinic linked or pincode outside clinic)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3_

  - [x]* 9.2 Write property test for single rider-clinic linkage
    - **Property 17: Rider has at most one clinic, replaced on reassignment**
    - **Validates: Requirements 8.1, 8.3**

  - [x]* 9.3 Write property test for rejecting invalid clinic targets
    - **Property 18: Rider–clinic assignment rejects invalid targets**
    - **Validates: Requirements 8.5**

  - [x]* 9.4 Write property test for clinic-bounded service-area assignment
    - **Property 19: Service-area assignment is bounded by the rider's clinic**
    - **Validates: Requirements 9.1, 9.2, 9.3**

  - [x]* 9.5 Write unit test for rider assignment success example
    - Cover Requirement 8.2 happy-path
    - _Requirements: 8.2_

- [x] 10. Checkpoint - service area, stamping, conflict, and rider linkage
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Extend routing engine to per-clinic scopes (clinic origin only)
  - [x] 11.1 Generalize DispatchScope to enumerate clinics as origins
    - Modify `src/actions/system-actions/routeEngine.ts` so scope construction builds one scope per Core Clinic (`franchise_id IS NULL`) using the clinic's latitude/longitude as origin; never use kitchen coordinates (kitchen carries no geo); retain the franchise scope branch inert
    - _Requirements: 2.7, 3.11, 10.1, 10.8, 18.3, 18.6_

  - [x] 11.2 Implement per-clinic batching, scope skipping, and batch stamping
    - Group routable orders to active riders assigned to the clinic (one batch per active rider); skip scopes with zero orders/riders without error; skip and record an error indication for clinics with missing/out-of-range coordinates
    - Stamp each created `delivery_batches.clinic_id` with the rider's linked clinic at routing time via `resolveBatchClinicStamp`, set once and null when the rider has no linked clinic (never blocking routing); never re-stamp the grouped orders' own `delivery_orders.clinic_id`
    - _Requirements: 10.2, 10.3, 10.6, 10.7, 19.3, 19.9_

  - [x] 11.3 Wire clinic-origin payout and preserve route sequencing
    - Ensure payout uses the clinic origin via existing `computeOpenLoopHaversineRoute`/`computeOpenLoopRoute` (Haversine × 1.3 × payout-per-km, summed, rounded 2 dp); keep `route_sequence` a gapless 1..n ordering
    - _Requirements: 10.4, 10.5_

  - [x]* 11.4 Write property test for clinic-origin routing
    - **Property 21: Routing uses each clinic as its own origin, never the kitchen**
    - **Validates: Requirements 10.1, 2.7, 3.11**

  - [x]* 11.5 Write property test for one-batch-per-rider and total batch count
    - **Property 22: One batch per active rider, and total batches equal the sum across clinics**
    - **Validates: Requirements 10.2, 10.3**

  - [x]* 11.6 Write property test for rider payout formula
    - **Property 23: Rider payout formula**
    - **Validates: Requirements 10.4**

  - [x]* 11.7 Write property test for gapless route sequence
    - **Property 24: Route sequence is a gapless 1..n ordering**
    - **Validates: Requirements 10.5**

  - [x]* 11.8 Write property test for skipping degenerate/invalid scopes
    - **Property 25: Routing skips degenerate and invalid scopes without aborting**
    - **Validates: Requirements 10.6, 10.7**

- [x] 12. Implement workload snapshots, aggregation, and the daily automation pipeline
  - [x] 12.1 Implement workload snapshot finalizer and aggregation
    - Create `src/lib/clinic/workload.ts` with `finalizeWorkloadSnapshot` (rejects duplicate per `uq_snapshot_clinic_kitchen_date` with an already-exists error, round-trip persistence) and pure `aggregateSnapshots(rows, grouping)` (day/week/month, per clinic and per kitchen, zeroed empty result)
    - Derive snapshot meal counts for a (clinic, date) by counting `delivery_orders` whose **stamped** `clinic_id` equals that clinic and whose `delivery_date` equals the target date — never the customer's current `clinic_id`
    - Add a workload-statistics action validating `start <= end`
    - _Requirements: 11.4, 12.1, 12.2, 12.4, 12.5, 12.6, 12.7, 19.6, 19.7_

  - [x] 12.2 Implement daily pipeline orchestrator with cutoff, order stamping, and retry
    - Create `src/actions/system-actions/dailyPipeline.ts` (`runDailyPipeline`) sequencing order creation → product linking → snapshotting → routing; halt on failure preserving prior output and recording the failing step; retry order-creation and product-linking up to 3 times before halting
    - At order creation, stamp each `delivery_orders.clinic_id` with the customer's resolved **delivery-address** clinic at creation time via `resolveOrderClinicStamp`, set once and immutable thereafter; leave null when the address resolves to no clinic (no blocking) and surface in the Conflict_Clinic_List
    - Enforce the 5:00 PM IST next-day cutoff in the relevant customer actions using `src/lib/dates/ist.ts`; attribute purchases by the IST day window in product-linking
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6, 11.7, 11.8, 19.2, 19.8, 22.3, 22.5_

  - [x]* 12.3 Write property test for next-day cutoff enforcement
    - **Property 26: Next-day cutoff enforcement**
    - **Validates: Requirements 11.2**

  - [x]* 12.4 Write property test for purchase day-attribution window
    - **Property 27: Purchase day-attribution window**
    - **Validates: Requirements 11.3**

  - [x]* 12.5 Write property test for snapshot finalization well-formedness
    - **Property 28: Snapshot finalization produces one well-formed snapshot per clinic**
    - **Validates: Requirements 11.4, 12.1**

  - [x]* 12.6 Write property test for pipeline halt and prior-output preservation
    - **Property 29: Pipeline halts at the failing step and preserves prior output**
    - **Validates: Requirements 11.7**

  - [x]* 12.7 Write property test for unique snapshot persistence
    - **Property 30: Snapshot persistence is unique per (clinic, kitchen, date)**
    - **Validates: Requirements 12.1, 12.2**

  - [x]* 12.8 Write property test for workload aggregation correctness
    - **Property 31: Workload aggregation correctness over a valid range**
    - **Validates: Requirements 12.4, 12.6, 13.3**

  - [x]* 12.9 Write property test for invalid date range rejection
    - **Property 32: Invalid date range is rejected**
    - **Validates: Requirements 12.5**

  - [x]* 12.10 Write integration test for pipeline ordering, timing, and retry
    - Cover sequential order/link/snapshot/route execution and retry-then-halt behavior
    - _Requirements: 11.1, 11.5, 11.6, 11.8_

- [x] 13. Checkpoint - routing, snapshots, and pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement master portal Core Business section (additive; existing card untouched)
  - [x] 14.1 Build the additive Core Business section
    - Add a new "Core Business" section under `src/app/master/(main)/system/` positioned **below** the existing Core Clinic Management card (which stays untouched), scoped to the Core business: RSC lists plus client create/edit forms (React Hook Form + Zod) for the Business, its Kitchens (no address/lat/lng fields), and its Core Clinics (full address + latitude + longitude), wired to `businessActions`, `kitchenActions`, and `clinicActions`
    - Include the clinic-to-kitchen reassignment control (same-city enforced via `reassignClinicKitchen`); creating multiple Core kitchens is supported
    - _Requirements: 2.12, 2.13, 2.14, 20.2, 21.1, 21.2, 21.3, 21.4, 21.5, 21.6, 21.7_

  - [x]* 14.2 Write unit tests for Core Business section coexistence and no-geo kitchen
    - Cover Requirements 21.1, 21.2, 21.3, 21.7 example cases (existing card untouched, no-geo kitchen form)
    - _Requirements: 21.1, 21.2, 21.3, 21.7_

- [x] 15. Implement workload view and authorization
  - [x] 15.1 Build workload view as a Daily Meal Roster extension
    - Extend the admin Operations Daily Meal Roster to show next-day per-clinic and per-kitchen meal counts plus the most recent 30 days of history from persisted snapshots; zero-count state when empty
    - _Requirements: 13.1, 13.2, 13.3_

  - [x] 15.2 Enforce workload-view authorization
    - Restrict access to `ADMIN` and `MASTER_ADMIN`; deny franchise admin role with no workload data, reinforced by RLS
    - _Requirements: 13.4, 13.5_

  - [x]* 15.3 Write property test for workload-view authorization
    - **Property 33: Workload-view authorization**
    - **Validates: Requirements 13.4, 13.5**

- [x] 16. Implement admin clinic visibility, filters, selector-first views, and Conflict Clinic List
  - [x] 16.1 Add clinic column and placeholder to rider/customer tables
    - Add a "Clinic" column to Rider List and Rider Activity and clinic display wherever rider/customer data shows; render placeholder ("—"/"Unassigned") when unlinked
    - _Requirements: 16.1, 16.2, 16.3, 16.7_

  - [x] 16.2 Implement clinic filter control and pure predicate
    - Add a clinic filter control (clinics + "All Clinics") to rider/customer table title bars with a pure filter predicate over loaded rows
    - _Requirements: 16.4, 16.5, 16.6_

  - [x] 16.3 Implement clinic-selector-first gating for operational views
    - Make Live Routing Board, Live Tracking, and Sandbox clinic-selector-first: no rider/route/tracking data until a clinic is selected; show only the selected clinic's riders; replace within 3s on change; empty-state for zero riders; selector limited to authorized clinics
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9_

  - [x] 16.4 Surface the Conflict Clinic List in the admin dashboard
    - Add an admin dashboard surface for the selected delivery day driven by `getConflictClinicList`, restricted to `ADMIN`/`MASTER_ADMIN`, showing mismatch and unresolved needs-attention entries
    - _Requirements: 22.7_

  - [x]* 16.5 Write property test for clinic display name or placeholder
    - **Property 34: Clinic display name or placeholder**
    - **Validates: Requirements 16.3, 16.7**

  - [x]* 16.6 Write property test for clinic filter predicate
    - **Property 35: Clinic filter predicate**
    - **Validates: Requirements 16.5, 16.6**

  - [x]* 16.7 Write property test for clinic-selector-first gating
    - **Property 36: Clinic-selector-first gating**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.8**

  - [x]* 16.8 Write property test for selection change retaining no stale riders
    - **Property 37: Selection change retains no stale riders**
    - **Validates: Requirements 17.7**

  - [x]* 16.9 Write property test for selector restricted to authorized clinics
    - **Property 38: Selector restricted to authorized clinics**
    - **Validates: Requirements 17.9**

  - [x]* 16.10 Write unit tests for clinic-column and filter examples
    - Cover Requirements 16.1, 16.2, 16.4 example cases
    - _Requirements: 16.1, 16.2, 16.4_

- [x] 17. Implement rewritten seed migration and feature-flag equivalence
  - [x] 17.1 Rewrite the Core Hyderabad Business seed migration
    - Rewrite `scripts/seed-madhapur-clinic.sql` as a single idempotent, transactional migration: create exactly one Core Hyderabad Business (`type Core`); resolve/ensure the Hyderabad Central Kitchen owned by that business with **no** geo, backfill `kitchens.business_id` then promote it to `NOT NULL`; ensure the Hyderabad city; create exactly two Core Clinics (Madhapur, Uppal) under the kitchen with address/lat/lng set directly from seeded clinic values (never copied from the kitchen)
    - Gap-fill: keep existing Madhapur customers under Madhapur, gap-fill null-clinic core customers (+ primary addresses), riders, and service-area pincodes to Madhapur; assert a zero-orphan guard (RAISE EXCEPTION to roll back if any core customer/rider/service-area remains null)
    - History back-stamp: set `delivery_orders.clinic_id`/`delivery_batches.clinic_id` to Madhapur for pre-existing core rows whose stamp is still null (fill-null only, never overwrite — honors immutability), inside the same transaction; additive and RLS-respecting
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 15.11, 18.2, 19.6, 19.7, 20.8_

  - [x] 17.2 Wire the feature-flag-off equivalence guard
    - Ensure `FRANCHISE_FEATURES_ENABLED` (unset resolves to false) routes only Core Clinics with no franchise-specific reads/writes/side effects, producing routing and customer-assignment outcomes identical to pre-`franchise_id` behavior; keep franchise paths compiling and inert
    - _Requirements: 10.8, 18.3, 18.4, 18.5, 18.6_

  - [x]* 17.3 Write property test for feature-flag-off equivalence
    - **Property 39: Feature-flag-off equivalence**
    - **Validates: Requirements 10.8, 18.3, 18.4, 18.6**

  - [x]* 17.4 Write integration/migration tests for the rewritten seed and rollback
    - Verify exactly one Core Business, one no-geo Kitchen (business_id NOT NULL), two Core Clinics with directly-set coordinates, idempotent re-run, zero orphans, idempotent history back-stamp, and transactional rollback on partial failure
    - _Requirements: 15.1, 15.2, 15.3, 15.6, 15.7, 15.8, 15.9, 15.10_

- [x] 18. Final checkpoint - ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- This is a regenerated plan for the revised Business → Kitchen → Clinic design; all tasks are unchecked and intended to be executed fresh by the orchestrator.
- Tasks marked with `*` are optional and cover property, unit, integration, and migration tests; they can be skipped for a faster MVP.
- Each task references specific requirement sub-clauses for traceability.
- Property tests use `fast-check` (min 100 runs each) and carry the `// Feature: core-clinic-architecture, Property {number}` tag; all 44 properties are covered exactly once. Pure logic lives in `src/lib/clinic/*` (validation, pincode-resolver, stamping, conflict, reassignment, order-stamp, workload, routing-core) so properties run without live Supabase.
- Order-level clinic stamps (`delivery_orders.clinic_id`, `delivery_batches.clinic_id`) are set once at creation and are immutable (Requirement 19, Properties 40–42). Customer stamping and pincode-move reassignment are keyed on the **Primary_Address** (`is_primary = true`); delivery-address selection never re-stamps (Property 14).
- The Conflict_Clinic_List is a derived read model (no new table) computed from order stamp vs. customer Primary_Address clinic (Properties 43–44).
- DB-enforced invariants (unique pincode, unique snapshot, coordinate/count CHECKs, business-type CHECK, `kitchens.business_id` NOT NULL after backfill) and transactional RPCs are verified by integration/migration tests rather than property tests.
- The existing master Core Clinic Management card is left untouched; the new Core Business section is purely additive below it.
- Checkpoints provide incremental validation at logical boundaries.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["1.4", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "3.1", "6.1", "7.1", "8.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.5", "5.1", "5.3", "5.4", "6.2", "9.1", "12.1"] },
    { "id": 4, "tasks": ["5.2", "8.2", "11.1"] },
    { "id": 5, "tasks": ["11.2", "11.3", "12.2"] },
    { "id": 6, "tasks": ["3.6", "3.7", "3.8", "3.9", "3.10", "5.5", "5.6", "5.7", "5.8", "5.9", "5.10", "6.3", "6.4", "6.5", "7.2", "7.3", "7.4", "8.3", "8.4", "9.2", "9.3", "9.4", "9.5"] },
    { "id": 7, "tasks": ["11.4", "11.5", "11.6", "11.7", "11.8", "12.3", "12.4", "12.5", "12.6", "12.7", "12.8", "12.9", "12.10"] },
    { "id": 8, "tasks": ["14.1", "15.1", "15.2", "16.1", "16.2", "16.3", "16.4", "17.1", "17.2"] },
    { "id": 9, "tasks": ["14.2", "15.3", "16.5", "16.6", "16.7", "16.8", "16.9", "16.10", "17.3", "17.4"] }
  ]
}
```
