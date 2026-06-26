# Implementation Plan: Core Clinic Architecture

## Overview

This plan implements the City → Kitchen → Clinic hierarchy in TypeScript (Next.js App Router, Server Actions, Supabase) following the design. Work proceeds bottom-up: additive SQL schema and shared types first, then pure domain logic (validation, pincode resolution, stamping, reassignment, payout, aggregation) that carries the property-based tests, then the Server Actions, routing-engine and pipeline integrations, and finally the master/admin UI surfaces. The seed migration and feature-flag equivalence guards close the plan. Every pure-logic module is extracted so the 36 correctness properties can be tested with `fast-check` without a live Supabase connection.

Property tests use `fast-check` with the existing test runner, a minimum of 100 generated cases each, and a tag comment `// Feature: core-clinic-architecture, Property {number}: {property text}`.

## Tasks

- [x] 1. Establish schema, types, and validation foundations
  - [x] 1.1 Add additive SQL schema for the clinic hierarchy
    - Create `scripts/create-clinic-hierarchy-tables.sql` adding `cities`, `clinics`, and `workload_snapshots` tables and the `city_id`/`clinic_id` columns on `kitchens`, `rider_service_areas`, `rider_profiles`, `customer_profiles`, `addresses`
    - Add `uq_cities_name_lower`, `uq_service_area_pincode`, `uq_snapshot_clinic_kitchen_date`, coordinate/count CHECK constraints, and supporting indexes
    - Add nullable `clinics.franchise_id` (NULL = Core Clinic) and respect Supabase RLS following the established additive pattern
    - _Requirements: 2.1, 3.1, 3.2, 4.1, 4.2, 6.1, 8.1, 12.1, 18.1, 18.2, 15.10_

  - [x] 1.2 Define shared TypeScript types for clinic domain
    - Create `src/types/clinic.ts` with `City`, `Clinic`, `WorkloadSnapshot`, `WorkloadAggregate`, and the `ActionResult<T>` discriminated union
    - _Requirements: 3.1, 12.1_

  - [x] 1.3 Implement pure clinic/city/pincode validators
    - Create `src/lib/clinic/validation.ts` with `validateClinicInput` (parameterized name/address max lengths), `validateCityName` (case-insensitive duplicate aware, allows self-rename), and `isValidPincode`
    - Create `src/validations/clinic.ts` Zod schemas (`pincodeSchema`, `clinicCreateSchema`, `citySchema`)
    - _Requirements: 1.1, 1.3, 1.4, 3.5, 3.6, 3.7, 5.4, 14.2, 14.3_

  - [x]* 1.4 Write property test for city-name validity and uniqueness
    - **Property 1: City name validity and case-insensitive uniqueness**
    - **Validates: Requirements 1.1, 1.3, 1.4**

  - [x]* 1.5 Write property test for clinic input validation
    - **Property 4: Clinic input validation identifies every offending field**
    - **Validates: Requirements 3.5, 3.6, 3.7, 14.2, 14.3**

  - [x]* 1.6 Write property test for pincode format validation
    - **Property 9: Pincode format validation**
    - **Validates: Requirements 5.4**

  - [x] 1.7 Add additive SQL for order-level clinic stamp
    - Create `scripts/add-clinic-stamp-to-orders.sql` adding a nullable `clinic_id UUID REFERENCES clinics(id)` column to `delivery_orders` and `delivery_batches`
    - Add supporting indexes `idx_delivery_orders_clinic_date` on `delivery_orders(clinic_id, delivery_date)` and `idx_delivery_batches_clinic_date` on `delivery_batches(clinic_id, delivery_date)`
    - Ship as a standalone additive migration (run separately by the user) following the established additive/RLS pattern; nullable so an unresolved clinic never blocks order/batch creation
    - _Requirements: 19.1_

- [x] 2. Implement clinic repositories and master-portal CRUD actions
  - [x] 2.1 Create clinic-domain repositories
    - Add `src/repositories/clinic/` data-access functions for cities, kitchens (city association), clinics, and dependency counts, using `createAdminClient`/server client per layering rules
    - _Requirements: 1.1, 2.2, 3.1, 3.2_

  - [x] 2.2 Implement city Server Actions
    - Create `src/actions/master-actions/cityActions.ts` with `createCity`, `updateCity`, `deleteCity` enforcing name validation and dependency-guarded deletion
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 14.7_

  - [x] 2.3 Implement kitchen Server Actions with city association
    - Create `src/actions/master-actions/kitchenActions.ts` with `createKitchen`, `updateKitchen`, `deleteKitchen`, each requiring a valid `city_id` and retaining `kitchens` records
    - _Requirements: 2.2, 2.3, 2.5, 2.6, 2.8, 14.7_

  - [x] 2.4 Implement clinic Server Actions
    - Create `src/actions/master-actions/clinicActions.ts` with `createClinic`, `updateClinic`, `deleteClinic`; enforce clinic↔kitchen same-city rule, validation bounds per surface, and dependency-guarded deletion
    - _Requirements: 2.7, 3.1, 3.5, 3.6, 3.7, 3.8, 3.9, 14.4, 14.5, 14.6_

  - [x]* 2.5 Write property test for dependency-guarded deletion
    - **Property 2: Dependency-guarded deletion**
    - **Validates: Requirements 1.5, 1.6, 14.5, 14.6**

  - [x]* 2.6 Write property test for kitchen-city and clinic-kitchen city rules
    - **Property 3: Kitchen requires a valid city, and clinic–kitchen must share a city**
    - **Validates: Requirements 2.6, 2.7**

  - [x]* 2.7 Write property test for clinic persistence round-trip
    - **Property 5: Clinic persistence round-trip**
    - **Validates: Requirements 3.1, 14.4**

  - [x]* 2.8 Write property test for Core Clinic classification
    - **Property 6: Core Clinic classification**
    - **Validates: Requirements 3.4, 18.1**

  - [x]* 2.9 Write unit tests for city/kitchen/clinic happy-paths and not-found
    - Cover Requirements 1.2, 1.7, 2.5, 14.1 example cases
    - _Requirements: 1.2, 1.7, 2.5, 14.1_

- [x] 3. Checkpoint - schema and master-portal CRUD logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement service-area-by-clinic logic and atomic move
  - [x] 4.1 Implement service-area clinic-aware Server Actions
    - Create/extend `src/actions/admin-actions/serviceAreaActions.ts` with `addPincodeToClinic`, `editPincode`, `deletePincode`, surfacing already-assigned and bad-format errors against `uq_service_area_pincode`
    - _Requirements: 4.1, 4.3, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 4.2 Implement atomic pincode-move RPC and action wiring
    - Add `scripts/create-move-pincode-rpc.sql` defining `move_pincode_and_reassign` (single transaction: move service area, reassign customer + address `clinic_id`)
    - Add `movePincode` to `serviceAreaActions.ts` returning `{ reassignedCount, riderWarnings }`
    - The transaction MUST scope its writes to `rider_service_areas`, `customer_profiles`, and `addresses` only; it MUST NOT touch `delivery_orders.clinic_id` or `delivery_batches.clinic_id` (order/batch clinic stamps are immutable)
    - _Requirements: 4.4, 4.5, 5.7, 7.1, 7.2, 7.3, 19.4_

  - [x] 4.3 Implement customer auto-reassignment module
    - Create `src/lib/clinic/reassignment.ts` (`reassignCustomersOnPincodeMove`) mirroring the `assignWaitlistedCustomers` batch pattern, executed inside the move transaction
    - Reassignment updates only `customer_profiles`/`addresses` clinic stamps; it MUST NOT modify `delivery_orders` or `delivery_batches` clinic stamps (historical immutability)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 19.4_

  - [x] 4.4 Implement pincode-move rider-mismatch warning logic
    - Add pure helper producing `RiderClinicWarning[]` for riders mapping a moved pincode whose linked clinic differs from the destination
    - _Requirements: 9.4_

  - [x]* 4.5 Write property test for one-pincode-one-clinic invariant
    - **Property 7: One pincode belongs to exactly one clinic**
    - **Validates: Requirements 4.1, 4.3, 5.3**

  - [x]* 4.6 Write property test for atomic single-homed move
    - **Property 8: Pincode move is atomic and single-homed**
    - **Validates: Requirements 4.4, 5.7**

  - [x]* 4.7 Write property test for service-area partition by clinic
    - **Property 10: Service areas partition by clinic**
    - **Validates: Requirements 5.1**

  - [x]* 4.8 Write property test for auto-reassignment matching subset
    - **Property 12: Customer auto-reassignment selects exactly the matching subset**
    - **Validates: Requirements 7.1, 7.2, 7.3**

  - [x]* 4.9 Write property test for reassignment atomicity on failure
    - **Property 13: Reassignment is atomic on failure**
    - **Validates: Requirements 7.5**

  - [x]* 4.10 Write property test for pincode-move clinic-mismatch warning
    - **Property 17: Pincode-move clinic-mismatch warning**
    - **Validates: Requirements 9.4**

- [x] 5. Implement customer clinic stamping
  - [x] 5.1 Implement pincode-to-clinic resolver
    - Create `src/lib/clinic/pincode-resolver.ts` (`resolveClinicForPincode` returning resolved/none/ambiguous)
    - _Requirements: 6.1, 6.4, 6.6_

  - [x] 5.2 Implement stamping module and wire into signup/address flows
    - Create `src/lib/clinic/stamping.ts`; call resolver and persist `clinic_id` on `customer_profiles` and `addresses` within the same operation in `addressActions.ts` and the signup flow; clear on unresolved; leave unchanged on ambiguity
    - Preserve existing inputs/outputs/completion behavior, adding only stamping
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.7_

  - [x]* 5.3 Write property test for customer clinic stamping
    - **Property 11: Customer clinic stamping reflects pincode resolution**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

  - [x]* 5.4 Write regression test preserving signup/address-update behavior
    - Verify accepted inputs, outcomes, and completion behavior are unchanged aside from stamping
    - _Requirements: 6.7_

  - [x] 5.5 Implement order/batch clinic-stamp module
    - Create `src/lib/clinic/order-stamp.ts` with pure `resolveOrderClinicStamp(addressClinicId)` (returns the customer's resolved clinic for the delivery address at creation, null when unresolved), `resolveBatchClinicStamp(riderClinicId)` (returns the routing rider's linked clinic, null when unlinked), and `assertStampImmutable(current, incoming)` (ok only when `current === null`; rejects any change to an already-set stamp with an `"immutable"` reason)
    - Pure functions with no Supabase dependency so they can be property-tested in isolation; consumed by the pipeline (order creation) and routing engine (batch creation)
    - _Requirements: 19.2, 19.3, 19.4, 19.5, 19.8, 19.9_

  - [x]* 5.6 Write property test for creation-time order/batch stamping
    - **Property 37: Order and batch clinic stamps are set once at creation**
    - **Validates: Requirements 19.2, 19.3, 19.8, 19.9**

  - [x]* 5.7 Write property test for clinic-stamp immutability
    - **Property 38: Clinic stamp is immutable after creation**
    - **Validates: Requirements 19.4, 19.5**

- [x] 6. Implement rider-clinic linkage and service-area constraint
  - [x] 6.1 Implement rider-clinic Server Actions
    - Create `src/actions/admin-actions/riderClinicActions.ts` with `assignRiderToClinic` (manual-only, replaces existing linkage, rejects invalid/inactive clinic), `getAssignablePincodesForRider`, `assignServiceAreaToRider`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 9.1, 9.2, 9.3_

  - [x]* 6.2 Write property test for single rider-clinic linkage
    - **Property 14: Rider has at most one clinic, replaced on reassignment**
    - **Validates: Requirements 8.1, 8.3**

  - [x]* 6.3 Write property test for rejecting invalid clinic targets
    - **Property 15: Rider–clinic assignment rejects invalid targets**
    - **Validates: Requirements 8.5**

  - [x]* 6.4 Write property test for clinic-bounded service-area assignment
    - **Property 16: Service-area assignment is bounded by the rider's clinic**
    - **Validates: Requirements 9.1, 9.2, 9.3**

  - [x]* 6.5 Write unit test for rider assignment success example
    - Cover Requirement 8.2 happy-path
    - _Requirements: 8.2_

- [x] 7. Checkpoint - service area, stamping, and rider linkage
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Extend routing engine to per-clinic scopes
  - [ ] 8.1 Generalize DispatchScope to enumerate clinics as origins
    - Modify `src/actions/system-actions/routeEngine.ts` so scope construction builds one scope per Core Clinic using the clinic's latitude/longitude as origin; never use kitchen coordinates; retain franchise scope branch inert
    - _Requirements: 2.4, 10.1, 10.8, 18.3, 18.6_

  - [ ] 8.2 Implement per-clinic batching and scope skipping
    - Group routable orders to active riders assigned to the clinic (one batch per active rider); skip scopes with zero orders/riders without error; skip and record error for invalid/missing coordinates
    - Stamp each created `delivery_batches.clinic_id` with the scope clinic (the rider's linked clinic at routing time), set exactly once and null when the rider has no linked clinic (never blocking routing); never re-stamp the grouped orders' own `delivery_orders.clinic_id`
    - _Requirements: 10.2, 10.3, 10.6, 10.7, 19.3, 19.9_

  - [ ] 8.3 Wire clinic-origin payout and preserve route sequencing
    - Ensure payout uses the clinic origin via existing `computeOpenLoopHaversineRoute`/`computeOpenLoopRoute`; keep `route_sequence` 1..n consecutive
    - _Requirements: 10.4, 10.5_

  - [ ]* 8.4 Write property test for clinic-origin routing
    - **Property 18: Routing uses each clinic as its own origin**
    - **Validates: Requirements 10.1, 2.4**

  - [ ]* 8.5 Write property test for one-batch-per-rider and total batch count
    - **Property 19: One batch per active rider, and total batches equal the sum across clinics**
    - **Validates: Requirements 10.2, 10.3**

  - [ ]* 8.6 Write property test for rider payout formula
    - **Property 20: Rider payout formula**
    - **Validates: Requirements 10.4**

  - [ ]* 8.7 Write property test for gapless route sequence
    - **Property 21: Route sequence is a gapless 1..n ordering**
    - **Validates: Requirements 10.5**

  - [ ]* 8.8 Write property test for skipping degenerate/invalid scopes
    - **Property 22: Routing skips degenerate and invalid scopes without aborting**
    - **Validates: Requirements 10.6, 10.7**

- [ ] 9. Implement workload snapshots, aggregation, and automation pipeline
  - [ ] 9.1 Implement workload snapshot finalizer and aggregation
    - Create `src/lib/clinic/workload.ts` with `finalizeWorkloadSnapshot` (rejects duplicate per `uq_snapshot_clinic_kitchen_date`, round-trip persistence) and pure `aggregateSnapshots` (day/week/month, per clinic and kitchen, zeroed empty result)
    - Derive snapshot meal counts for a (clinic, date) by counting `delivery_orders` whose stamped `clinic_id` equals that clinic and whose `delivery_date` equals the target date — never from the customer's current `clinic_id`
    - Add workload statistics action validating `start <= end`
    - _Requirements: 11.4, 12.1, 12.2, 12.4, 12.5, 12.6, 12.7, 19.6_

  - [ ] 9.2 Implement daily pipeline orchestrator with cutoff enforcement
    - Create `src/actions/system-actions/dailyPipeline.ts` (`runDailyPipeline`) sequencing order creation → product linking → snapshotting → routing; halt on failure preserving prior output; retry order-creation and product-linking up to 3 times
    - At order creation, stamp each `delivery_orders.clinic_id` with the customer's resolved clinic for the delivery address at creation time (via `resolveOrderClinicStamp`), set exactly once and immutable thereafter; leave null when the address resolves to no clinic without blocking creation
    - Enforce 5:00 PM IST next-day cutoff in relevant customer actions using `src/lib/dates/ist.ts`; attribute purchases by IST day window in product-linking
    - _Requirements: 11.1, 11.2, 11.3, 11.5, 11.6, 11.7, 11.8, 19.2, 19.8_

  - [ ]* 9.3 Write property test for next-day cutoff enforcement
    - **Property 23: Next-day cutoff enforcement**
    - **Validates: Requirements 11.2**

  - [ ]* 9.4 Write property test for purchase day-attribution window
    - **Property 24: Purchase day-attribution window**
    - **Validates: Requirements 11.3**

  - [ ]* 9.5 Write property test for snapshot finalization well-formedness
    - **Property 25: Snapshot finalization produces one well-formed snapshot per clinic**
    - **Validates: Requirements 11.4, 12.1**

  - [ ]* 9.6 Write property test for pipeline halt and prior-output preservation
    - **Property 26: Pipeline halts at the failing step and preserves prior output**
    - **Validates: Requirements 11.7**

  - [ ]* 9.7 Write property test for unique snapshot persistence
    - **Property 27: Snapshot persistence is unique per (clinic, kitchen, date)**
    - **Validates: Requirements 12.1, 12.2**

  - [ ]* 9.8 Write property test for workload aggregation correctness
    - **Property 28: Workload aggregation correctness over a valid range**
    - **Validates: Requirements 12.4, 12.6, 13.3**

  - [ ]* 9.9 Write property test for invalid date range rejection
    - **Property 29: Invalid date range is rejected**
    - **Validates: Requirements 12.5**

  - [ ]* 9.10 Write integration test for pipeline ordering, timing, and retry
    - Cover sequential order/link/snapshot/route execution and retry-then-halt behavior
    - _Requirements: 11.1, 11.5, 11.6, 11.8_

  - [ ]* 9.11 Write property test for stamp-derived workload and history
    - **Property 39: Per-clinic workload and history derive from the order stamp**
    - **Validates: Requirements 19.6, 19.7**

- [ ] 10. Checkpoint - routing, snapshots, and pipeline
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement master portal Core Clinic Management UI
  - [ ] 11.1 Build Core Clinic Management card and forms
    - Add a "Core Clinic Management" card under `src/app/master/(main)/system/` with RSC lists and client create/edit forms (React Hook Form + Zod) for cities, kitchens, and clinics wired to the master actions
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

- [ ] 12. Implement workload view and authorization
  - [ ] 12.1 Build workload view as Daily Meal Roster extension
    - Extend the admin Operations Daily Meal Roster to show next-day per-clinic and per-kitchen meal counts plus the most recent 30 days of history from persisted snapshots; zero-count state when empty
    - _Requirements: 13.1, 13.2, 13.3_

  - [ ] 12.2 Enforce workload-view authorization
    - Restrict access to `ADMIN` and `MASTER_ADMIN`; deny franchise admin role with no workload data, reinforced by RLS
    - _Requirements: 13.4, 13.5_

  - [ ]* 12.3 Write property test for workload-view authorization
    - **Property 30: Workload-view authorization**
    - **Validates: Requirements 13.4, 13.5**

- [ ] 13. Implement clinic visibility, filters, and selector-first views
  - [ ] 13.1 Add clinic column and placeholder to rider/customer tables
    - Add a "Clinic" column to Rider List and Rider Activity and clinic display wherever rider/customer data shows; render placeholder ("—"/"Unassigned") when unlinked
    - _Requirements: 16.1, 16.2, 16.3, 16.7_

  - [ ] 13.2 Implement clinic filter control and predicate
    - Add a clinic filter control (clinics + "All Clinics") to rider/customer table title bars with a pure filter predicate over loaded rows
    - _Requirements: 16.4, 16.5, 16.6_

  - [ ] 13.3 Implement clinic-selector-first gating for operational views
    - Make Live Routing Board, Live Tracking, and Sandbox clinic-selector-first: no rider/route/tracking data until a clinic is selected; show only selected clinic's riders; replace within 3s on change; empty-state for zero riders; selector limited to authorized clinics
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 17.9_

  - [ ]* 13.4 Write property test for clinic display name or placeholder
    - **Property 31: Clinic display name or placeholder**
    - **Validates: Requirements 16.3, 16.7**

  - [ ]* 13.5 Write property test for clinic filter predicate
    - **Property 32: Clinic filter predicate**
    - **Validates: Requirements 16.5, 16.6**

  - [ ]* 13.6 Write property test for clinic-selector-first gating
    - **Property 33: Clinic-selector-first gating**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.8**

  - [ ]* 13.7 Write property test for selection change retaining no stale riders
    - **Property 34: Selection change retains no stale riders**
    - **Validates: Requirements 17.7**

  - [ ]* 13.8 Write property test for selector restricted to authorized clinics
    - **Property 35: Selector restricted to authorized clinics**
    - **Validates: Requirements 17.9**

  - [ ]* 13.9 Write unit tests for clinic-column and filter examples
    - Cover Requirements 16.1, 16.2, 16.4 example cases
    - _Requirements: 16.1, 16.2, 16.4_

- [ ] 14. Implement migration seed and feature-flag equivalence
  - [ ] 14.1 Implement Madhapur Clinic seed migration
    - Create `scripts/seed-madhapur-clinic.sql`: idempotent, transactional seed of one Madhapur Clinic from the central kitchen's address/lat/lng; link kitchen; stamp all customers; link all riders; associate all service-area pincodes; leave zero orphans; roll back fully on failure
    - Also back-stamp existing history: set `delivery_orders.clinic_id` and `delivery_batches.clinic_id` to the Madhapur Clinic for all pre-existing rows whose stamp is still `null` — idempotent (only fills null stamps, never overwrites an existing stamp, honoring immutability) and inside the same transaction so a partial failure rolls back fully
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8, 15.9, 15.10, 19.6, 19.7_

  - [ ] 14.2 Wire feature-flag-off equivalence guard
    - Ensure `FRANCHISE_FEATURES_ENABLED` (unset resolves to false) routes only Core Clinics with no franchise-specific reads/writes/side effects; keep franchise paths compiling and inert
    - _Requirements: 10.8, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [ ]* 14.3 Write property test for feature-flag-off equivalence
    - **Property 36: Feature-flag-off equivalence**
    - **Validates: Requirements 10.8, 18.3, 18.4, 18.6**

  - [ ]* 14.4 Write integration/migration tests for seed and rollback
    - Verify idempotent re-run, zero orphans, and transactional rollback on partial failure
    - _Requirements: 15.6, 15.7, 15.8_

- [ ] 15. Final checkpoint - ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; they cover property, unit, and integration tests.
- Each task references specific requirement sub-clauses for traceability.
- Property tests use `fast-check` (min 100 runs each) and carry the `// Feature: core-clinic-architecture, Property {number}` tag; pure logic is isolated so properties run without live Supabase.
- Order-level clinic stamps (`delivery_orders.clinic_id`, `delivery_batches.clinic_id`) are set once at creation and are immutable (Requirement 19, Properties 37–39); `scripts/add-clinic-stamp-to-orders.sql` is a new additive migration the user must run.
- DB-enforced invariants (unique pincode, unique snapshot, coordinate/count CHECKs) and transactional RPCs are verified by integration tests rather than property tests.
- Checkpoints provide incremental validation at logical boundaries.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.7"] },
    { "id": 1, "tasks": ["1.3"] },
    { "id": 2, "tasks": ["1.4", "1.5", "1.6", "2.1", "5.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "4.1", "5.2", "5.5", "6.1", "9.1"] },
    { "id": 4, "tasks": ["2.4", "4.2", "4.3", "4.4", "8.1"] },
    { "id": 5, "tasks": ["8.2", "8.3", "9.2"] },
    { "id": 6, "tasks": ["2.5", "2.6", "2.7", "2.8", "2.9", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "5.3", "5.4", "5.6", "5.7", "6.2", "6.3", "6.4", "6.5"] },
    { "id": 7, "tasks": ["8.4", "8.5", "8.6", "8.7", "8.8", "9.3", "9.4", "9.5", "9.6", "9.7", "9.8", "9.9", "9.10", "9.11"] },
    { "id": 8, "tasks": ["11.1", "12.1", "12.2", "13.1", "13.2", "13.3", "14.1", "14.2"] },
    { "id": 9, "tasks": ["12.3", "13.4", "13.5", "13.6", "13.7", "13.8", "13.9", "14.3", "14.4"] }
  ]
}
```
