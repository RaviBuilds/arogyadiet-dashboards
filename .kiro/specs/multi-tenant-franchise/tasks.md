# Implementation Plan: Multi-Tenant Franchise SaaS

## Overview

This plan converts the franchise design into incremental coding steps for the existing Next.js 16 / React 19 / Supabase (PostgreSQL + RLS) codebase. It follows the project's structure conventions: SQL migrations under `scripts/`, types in `src/types`, Zod schemas in `src/validations`, data access in `src/repositories`, business logic in `src/services`, Server Actions in `src/actions` (master/admin actions), subdomain routing in `src/middleware.ts`, and the portal-agnostic RBAC-aware UI in `src/shared/components`.

The work proceeds bottom-up: the database boundary (`franchises` table, `franchise_id` stamping, RLS policies) is established first because it is the foundation of the "Isolated Data" promise; the assignment resolver, server actions, middleware routing, and shared dashboard layer are then wired on top; finally the existing Hyderabad operation is migrated as the founding franchise.

A property-based test framework (Vitest + fast-check) is introduced to validate the six correctness invariants from the design. Isolation/master/global/write properties (1, 2, 4, 5) are exercised as integration property tests against a test PostgreSQL/Supabase instance with RLS enabled; assignment and routing properties (3, 6) are exercised against the resolver and routing logic.

## Tasks

- [ ] 1. Establish the database boundary schema
  - [ ] 1.1 Create the `franchises` registry table migration
    - Add `scripts/create-franchises-table.sql` defining `franchises` with a unique id, `name` (unique, 1–100 chars, CHECK constraint), `status` enum/CHECK restricted to `active|onboarding|suspended`, and a `kitchen_id` FK referencing `kitchens(id)`
    - Seed the founding "Hyderabad (Core)" franchise row referencing the existing core kitchen
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 6.8_

  - [ ] 1.2 Create the pincode-to-franchise mapping migration
    - Add `scripts/create-franchise-pincodes.sql` mapping 6-digit pincodes to a single `franchise_id`, with a UNIQUE constraint on pincode to make assignment deterministic and surface overlaps at setup
    - Add a CHECK constraint enforcing the 6-digit numeric pincode format
    - _Requirements: 1.4, 2.3, 8.6, 9.1_

  - [ ] 1.3 Add `franchise_id` to the `users` identity record
    - Add `scripts/add-franchise-id-to-users.sql` adding a nullable `franchise_id` FK on `users` (null for `MASTER_ADMIN`/`ADMIN`, non-null for franchise users)
    - _Requirements: 3.1, 3.2_

  - [ ] 1.4 Add `franchise_id` columns to all tenant-isolated tables
    - Add `scripts/add-franchise-id-to-tenant-tables.sql` adding a `franchise_id` FK to every tenant-isolated table (customer_profiles, addresses, medical_documents, coupons, subscriptions, subscription_daily_preferences, delivery_orders, delivery_batches, delivery_status_logs, addon_orders, addon_order_items, rider_profiles, rider_service_areas, rider_live_locations, rider_monthly_summaries, rider_payouts, inventory_products, inventory_lots, inventory_transactions, manufacturing_*, payments, razorpay_transactions, notifications)
    - Add indexes on `franchise_id` for query performance
    - _Requirements: 4.1, 12.4_

- [ ] 2. Set up the property-based testing harness
  - [ ] 2.1 Install and configure Vitest + fast-check
    - Add Vitest, fast-check, and a `test` script to `package.json`; add `vitest.config.ts`
    - Add a test helper that connects to a disposable test PostgreSQL/Supabase instance and can run migrations + create franchise-scoped and master sessions
    - _Requirements: 5.7_

- [ ] 3. Implement RLS policies and write-stamping (the vault door)
  - [ ] 3.1 Create RLS helper functions and session context
    - Add `scripts/create-rls-helpers.sql` defining functions to resolve the current request's `franchise_id` and master-role status from the authenticated identity (`auth_user_id` → `users.franchise_id` / role)
    - _Requirements: 3.3, 3.4, 5.6_

  - [ ] 3.2 Create tenant isolation RLS policies for all tenant-isolated tables
    - Add `scripts/create-tenant-rls-policies.sql` enabling RLS and adding read/list/update/delete policies that match rows only WHERE `franchise_id` = caller's franchise; deny-all when the caller's franchise is null/unresolved
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.6, 5.7_

  - [ ] 3.3 Create write-stamping enforcement for tenant-isolated inserts
    - Add `scripts/create-franchise-stamp-trigger.sql` with a BEFORE INSERT trigger/policy that forces `franchise_id` to the caller's resolved franchise (ignoring any payload value) and rejects inserts whose resolved franchise is missing or does not match an existing franchise
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 5.5_

  - [ ] 3.4 Create master-bypass RLS policies
    - Extend policies so `MASTER_ADMIN`/`ADMIN` rows are visible/writable across all franchises, including suspended franchises' retained data
    - _Requirements: 6.1, 6.2, 2.8_

  - [ ] 3.5 Create global-table policies
    - Add `scripts/create-global-table-policies.sql` granting read to all roles and write only to master roles for `system_settings`, `roles`, `subscription_plans`, `meal_categories`, `holidays`, `products`
    - _Requirements: 7.1, 7.4, 7.5_

  - [ ]* 3.6 Write property test for Total isolation
    - **Property 1: Total isolation**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**
    - Generate random franchise/record combinations across every tenant-isolated table; assert a franchise session can read/modify a record iff `franchise_id` matches, and other-franchise requests return results indistinguishable from non-existent

  - [ ]* 3.7 Write property test for No cross-contamination on write
    - **Property 5: No cross-contamination on write**
    - **Validates: Requirements 4.2, 4.3**
    - Generate inserts with arbitrary payload `franchise_id` values from a franchise session; assert the persisted row is always stamped with the caller's own franchise and cross-franchise inserts are rejected

  - [ ]* 3.8 Write property test for Master completeness
    - **Property 2: Master completeness**
    - **Validates: Requirements 6.1, 2.6**
    - Generate records across many franchises (including suspended) and assert a master session reads all of them with none hidden

  - [ ]* 3.9 Write property test for Global consistency
    - **Property 4: Global consistency**
    - **Validates: Requirements 7.1, 7.3**
    - Assert global-table reads are identical across arbitrary franchise sessions and that franchise-session writes to global tables are rejected

- [ ] 4. Checkpoint - database boundary verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 5. Implement franchise domain types, validation, and data access
  - [ ] 5.1 Define franchise types
    - Add franchise, franchise-status, and pincode-mapping TypeScript types to `src/types`
    - _Requirements: 1.1, 1.2_

  - [ ] 5.2 Define franchise Zod validation schemas
    - Add `src/validations` schemas validating name (1–100 chars, non-empty), status set membership, kitchen reference presence, 6-digit pincodes, and the 0–1000 pincode count limit
    - _Requirements: 1.6, 1.7_

  - [ ] 5.3 Implement the franchise repository
    - Add `src/repositories` data-access functions for create/read/update franchise, owner association, and pincode read/write using the admin client
    - _Requirements: 1.1, 1.5, 3.1_

  - [ ]* 5.4 Write unit tests for franchise validation schemas
    - Cover name length/uniqueness-shape, invalid status, invalid kitchen reference, malformed pincode, and over-limit pincode count
    - _Requirements: 1.6, 1.7_

- [ ] 6. Implement franchise registry and lifecycle Server Actions
  - [ ] 6.1 Implement create-franchise action with owner assignment
    - Add `src/actions/master-actions/franchiseActions.ts` creating a franchise with status `onboarding`, requiring exactly one `FRANCHISE_ADMIN` owner, validating name/kitchen, and rejecting invalid input without persisting changes
    - _Requirements: 1.5, 1.6, 2.1, 2.2_

  - [ ] 6.2 Implement served-pincode assignment action
    - Add an action to assign/extend a franchise's served pincodes, rejecting malformed pincodes, over-limit counts, and pincodes already assigned to another franchise (conflict)
    - _Requirements: 1.4, 1.7, 2.3, 2.4_

  - [ ] 6.3 Implement franchise status-transition actions
    - Add activate/suspend/reactivate actions enforcing valid transitions (reject activating an already-active franchise, reject reactivating an already-active franchise, and reject suspending an already-suspended franchise), applying within the 5s budget, and restoring dashboard access on reactivation
    - _Requirements: 2.5, 2.6, 2.7, 2.9, 2.10_

  - [ ]* 6.4 Write unit tests for lifecycle actions
    - Cover missing-owner rejection, pincode-conflict rejection, and invalid status-transition rejection
    - _Requirements: 2.2, 2.4, 2.10_

- [ ] 7. Implement pincode overlap detection
  - [ ] 7.1 Implement overlap-detection service
    - Add `src/services` logic that, at franchise setup, detects pincodes mapped to more than one franchise, names the duplicated pincode, and lists every franchise it maps to
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ] 7.2 Gate territory go-live on unresolved overlaps
    - While any overlap is unresolved, block only the territory's transition to the live state while still permitting non-live state transitions (such as draft → review) and still allowing the territory's non-conflicting pincodes to receive customers (partial activation); reject the live activation and report each conflicting pincode; clear the indication and permit go-live once each pincode maps to exactly one franchise
    - _Requirements: 9.4, 9.5, 9.6_

  - [ ]* 7.3 Write unit tests for overlap detection and go-live gating
    - Cover single-overlap detection, multi-franchise listing, blocked live activation, permitted non-live transitions and non-conflicting-pincode customer assignment while conflicts remain (partial activation), and cleared-conflict activation
    - _Requirements: 9.1, 9.4, 9.6_

- [ ] 8. Implement pincode-to-franchise assignment and waitlist
  - [ ] 8.1 Implement the Assignment_Resolver service
    - Add `src/services` resolver that maps a delivery pincode to exactly one active franchise and exposes the resolved `franchise_id` for stamping
    - _Requirements: 8.1, 8.6_

  - [ ] 8.2 Wire assignment into customer signup and waitlist handling
    - Stamp the resolved `franchise_id` onto the customer profile before signup completes; place customers with no active franchise (or with a multi-franchise conflict) into the Waitlist_State, block their ordering, and surface conflicts to the Master Admin
    - _Requirements: 8.1, 8.3, 8.4, 8.7_

  - [ ] 8.3 Propagate assignment to derived operational records
    - Ensure subscriptions, orders, and payments derived from an assigned customer inherit the customer's `franchise_id`
    - _Requirements: 8.2_

  - [ ] 8.4 Implement waitlist resolution on pincode/franchise changes
    - When a franchise's pincodes are extended or a new franchise covers a waitlisted pincode, assign the servicing `franchise_id` and remove the customer from the Waitlist_State
    - _Requirements: 8.5_

  - [ ]* 8.5 Write property test for Single assignment
    - **Property 3: Single assignment**
    - **Validates: Requirements 8.1, 8.2, 8.5**
    - Generate random pincode→franchise maps and customer pincodes; assert each served pincode resolves to exactly one franchise and a customer plus derived records associate with exactly that one franchise

  - [ ]* 8.6 Write unit tests for waitlist scenarios
    - Cover unmatched pincode, multi-franchise conflict, and waitlist clearing on coverage extension
    - _Requirements: 8.3, 8.4, 8.7_

- [ ] 9. Checkpoint - registry, assignment, and isolation verified
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement subdomain portal routing
  - [ ] 10.1 Extend middleware for the franchise portal
    - Update `src/middleware.ts` to detect `franchies.arogyadiet.com` and `admin.arogyadiet.com`, route within the latency budget, verify role + `franchise_id`, route franchise admins into a franchise-scoped workspace and master admins into the global workspace, and prevent an authenticated Franchise_Admin from reaching the head-office global workspace by routing them back to their franchise-scoped workspace
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ] 10.2 Implement access denial and unauthenticated handling
    - Deny insufficient-role access at the middleware layer (before any page renders) to the unauthorized page exposing no franchise data regardless of the unauthorized page's implementation, redirect unauthenticated users to login preserving the subdomain, and route undefined subdomains to the unauthorized page
    - _Requirements: 10.6, 10.7, 10.8, 3.4_

  - [ ]* 10.3 Write property test for Routing soundness
    - **Property 6: Routing soundness**
    - **Validates: Requirements 10.3, 10.4, 10.5, 10.6, 11.2, 11.3, 11.4**
    - Generate random (role, franchise, subdomain, auth-state) combinations; assert users are only routed into workspaces consistent with their role/franchise (including a Franchise_Admin being routed back from the head-office workspace), master controls are hidden from franchise users and shown to head office, and unauthorized access yields middleware-layer denial with no partial visibility

- [ ] 11. Implement the shared RBAC-aware dashboard layer
  - [ ] 11.1 Implement role/scope context and RBAC gate
    - Add a scope-context provider and an RBAC gate component in `src/shared/components` that receives role + `franchise_id` props and conditionally renders master-only controls
    - _Requirements: 11.3, 11.4, 11.5, 11.6_

  - [ ] 11.2 Make shared operational interfaces scope-aware
    - Update the shared customer, rider, inventory, order, and reporting components in `src/shared/components` to consume scope context so a single implementation serves both dashboards and scopes franchise data to the viewer's franchise
    - _Requirements: 11.1, 11.2_

  - [ ] 11.3 Implement per-interface error and empty handling
    - Show a per-interface error indication on data-load failure without leaking other-franchise/role data and while retaining the viewer's role scope; show the no-franchise-assigned indication for unassigned franchise admins
    - _Requirements: 11.6, 11.7_

  - [ ]* 11.4 Write unit tests for RBAC show/hide and scope behavior
    - Cover master control visibility per role, franchise scoping, unauthorized-role denial, and unassigned-franchise indication
    - _Requirements: 11.3, 11.4, 11.5, 11.6_

- [ ] 12. Implement the Master and Franchise dashboards
  - [ ] 12.1 Implement Master dashboard data actions and views
    - Add master-action data fetchers and the master dashboard view rendering consolidated revenue (default current calendar month), network operations health (active subscriptions, completed vs scheduled deliveries, active riders), per-franchise drill-down, the founding-franchise label, zero-value handling, and per-metric error handling
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

  - [ ] 12.2 Implement Franchise dashboard at the franchise portal
    - Wire the `franchies` portal route to render the shared operational dashboard scoped to the authenticated franchise, with master features hidden, and deny operation when the franchise is suspended
    - _Requirements: 2.7, 11.1, 11.2, 11.3_

  - [ ]* 12.3 Write unit tests for master metric scoping and drill-down
    - Cover consolidated vs single-franchise scoping, default reporting period, and zero/error metric states
    - _Requirements: 6.3, 6.4, 6.6, 6.7_

- [ ] 13. Implement global-table modification flow for head office
  - [ ] 13.1 Implement master global-config Server Actions
    - Add/extend master actions to persist global-table modifications, propagate within the 5s budget, reject and roll back on persistence failure retaining prior data, and reject franchise-user modification attempts
    - _Requirements: 7.2, 7.3, 7.4_

  - [ ]* 13.2 Write unit tests for global-config persistence and rejection
    - Cover successful persist+propagate, failed-persist rollback, and franchise-user write rejection
    - _Requirements: 7.2, 7.3, 7.4_

- [ ] 14. Migrate the existing Hyderabad operation as the founding franchise
  - [ ] 14.1 Implement the founding-franchise backfill migration
    - Add `scripts/backfill-founding-franchise.sql` associating every existing tenant-isolated record and existing core users with the founding franchise inside a single transaction, rolling back on any failure so no record is left partially migrated, and verifying no tenant-isolated record remains without a `franchise_id`
    - _Requirements: 12.2, 12.3, 12.4_

  - [ ] 14.2 Preserve founding-franchise workflows without a franchise-selection step
    - Ensure founding-franchise users continue the existing customer, rider, inventory, and delivery workflows unchanged with no added franchise-selection step
    - _Requirements: 12.1_

  - [ ]* 14.3 Write integration test for migration completeness
    - Assert post-migration there are zero tenant-isolated records without a `franchise_id` and that a simulated mid-migration failure rolls back cleanly
    - _Requirements: 12.3, 12.4_

- [ ] 15. Final checkpoint - full franchise model verified
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP, but they validate the platform's core isolation promise and are strongly recommended.
- Each task references specific granular requirements clauses for traceability.
- Property-based tests (3.6–3.9, 8.5, 10.3) map one-to-one to the six correctness properties in the design; isolation/master/global/write properties run against a test PostgreSQL/Supabase instance with RLS enabled.
- Checkpoints (4, 9, 15) provide incremental validation at the database, registry/assignment, and full-system boundaries.
- All database changes ship as `scripts/*.sql` migrations consistent with the existing project structure; data access stays in repositories/services and mutations in Server Actions per steering.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4", "5.1"] },
    { "id": 2, "tasks": ["3.1", "5.2", "5.3"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4", "3.5", "5.4"] },
    { "id": 4, "tasks": ["3.6", "3.7", "3.8", "3.9", "6.1", "6.2", "6.3", "7.1"] },
    { "id": 5, "tasks": ["6.4", "7.2", "8.1", "10.1", "11.1"] },
    { "id": 6, "tasks": ["7.3", "8.2", "8.3", "8.4", "10.2", "11.2", "13.1"] },
    { "id": 7, "tasks": ["8.5", "8.6", "10.3", "11.3", "12.1", "12.2", "13.2"] },
    { "id": 8, "tasks": ["11.4", "12.3", "14.1", "14.2"] },
    { "id": 9, "tasks": ["14.3"] }
  ]
}
```
