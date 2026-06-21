# Implementation Plan: Multi-Tenant Franchise SaaS

## Overview

This plan implements the multi-tenant franchise system with **production safety as the #1 priority**. The existing Hyderabad core operation is LIVE — every change must be additive-only and backward-compatible. Tasks are organized into safety phases:

- **Phase 1 (SAFE):** New tables, new files, new types — zero production impact
- **Phase 2 (SAFE):** Application code that handles franchise_id (reads NULL as core)
- **Phase 3 (CONTROLLED RISK):** Middleware changes — backward-compatible additions only
- **Phase 4 (HIGHEST RISK):** RLS enablement — only after code is deployed and tested
- **Phase 5 (SAFE):** Franchise portal wiring — entirely new subdomain, no existing impact

## Tasks

- [ ] 1. Phase 1 — SAFE: Database schema (additive-only, no existing table modifications yet)
  - [ ] 1.1 Create the `franchises` table and `franchise_pincodes` table
    - Create SQL migration script `scripts/create-franchise-tables.sql`
    - `franchises` table: `id` (uuid, PK), `name` (varchar 100, unique), `status` (enum: active/onboarding/suspended), `kitchen_id` (uuid, FK to kitchens), `owner_user_id` (uuid, FK to users), `created_at`, `updated_at`
    - `franchise_pincodes` table: `id` (uuid, PK), `franchise_id` (uuid, FK to franchises), `pincode` (varchar 6, CHECK regex `^[0-9]{6}$`), unique constraint on `(franchise_id, pincode)`, unique constraint on `pincode` alone (enforces single-assignment)
    - Status enum: CREATE TYPE `franchise_status` AS ENUM ('active', 'onboarding', 'suspended')
    - These are entirely new tables — ZERO impact on existing data or code
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1_

  - [ ] 1.2 Add nullable `franchise_id` column to tenant-isolated tables
    - Create SQL migration script `scripts/add-franchise-id-columns.sql`
    - Add `franchise_id UUID DEFAULT NULL REFERENCES franchises(id)` to: `customer_profiles`, `subscriptions`, `delivery_orders`, `delivery_batches`, `rider_profiles`, `rider_service_areas`, `rider_live_locations`, `rider_monthly_summaries`, `rider_payouts`, `inventory_products`, `inventory_lots`, `inventory_transactions`, `manufacturing_batches`, `manufacturing_orders`, `manufacturing_outputs`, `payments`, `razorpay_transactions`, `notifications`, `addresses`, `addon_orders`, `addon_order_items`, `coupons`
    - CRITICAL: Column is DEFAULT NULL — existing rows keep NULL (= core), existing queries unaffected
    - NO NOT NULL constraint — core records stay NULL forever
    - Add index on `franchise_id` for each table (CREATE INDEX IF NOT EXISTS)
    - _Requirements: 4.1, 4.6, 12.1, 12.2_

  - [ ] 1.3 Add nullable `franchise_id` column to `users` table for franchise association
    - Create SQL migration script `scripts/add-franchise-id-to-users.sql`
    - Add `franchise_id UUID DEFAULT NULL REFERENCES franchises(id)` to `users` table
    - Existing users (ADMIN, MASTER_ADMIN, RIDER, CUSTOMER) keep NULL — no impact
    - Only new FRANCHISE_ADMIN users will have non-null franchise_id
    - _Requirements: 3.1, 3.2, 3.5_

- [ ] 2. Phase 1 — SAFE: TypeScript types, Zod schemas, and configuration
  - [ ] 2.1 Create franchise TypeScript types and Zod validation schemas
    - Create `src/types/franchise.ts` with interfaces: `Franchise`, `FranchisePincode`, `FranchiseWithPincodes`, `FranchiseCreateInput`, `FranchiseUpdateInput`, `FranchiseStatusTransition`
    - Create `src/validations/franchiseSchemas.ts` with Zod schemas for: franchise creation, pincode assignment, status transition, franchise update
    - Pincode validation: 6-digit numeric string, max 1000 per franchise
    - Name validation: 1-100 characters, required
    - Status transitions: onboarding→active, active→suspended, suspended→active
    - _Requirements: 1.1, 1.3, 1.7, 1.8, 2.5, 2.6, 2.10_

  - [ ] 2.2 Create franchise context utility and session helpers
    - Create `src/lib/franchise/context.ts` — utility to resolve franchise_id from authenticated user session
    - Create `src/lib/franchise/constants.ts` — feature flag `FRANCHISE_FEATURES_ENABLED` (env var), core pincodes list, franchise status enum
    - The context resolver: reads user's `franchise_id` from the `users` table; returns NULL for ADMIN/MASTER_ADMIN (they see everything); returns the franchise_id for FRANCHISE_ADMIN; returns NULL for existing RIDER/CUSTOMER (core operation)
    - This is purely a utility — no existing code calls it yet
    - _Requirements: 3.2, 3.3, 3.5, 4.6, 4.7_

  - [ ]* 2.3 Write property tests for franchise context resolution
    - **Property 6: Core records untouched** — verify Core_Admin/ADMIN users always resolve to NULL franchise context
    - **Property 3: Core and Master completeness** — verify MASTER_ADMIN/ADMIN users get unrestricted access context
    - **Validates: Requirements 3.2, 3.5, 4.6, 4.7**

- [ ] 3. Checkpoint — Verify Phase 1 is safe
  - Ensure SQL scripts are reviewed for backward compatibility (all columns DEFAULT NULL, no NOT NULL, no drops)
  - Ensure no existing code is modified
  - Ensure all new files compile without errors
  - Ask the user if questions arise.

- [ ] 4. Phase 2 — SAFE: Franchise registry server actions and data access layer
  - [ ] 4.1 Create franchise CRUD server actions
    - Create `src/actions/admin-actions/franchiseActions.ts`
    - Implement: `createFranchise(input)` — validates name uniqueness, kitchen_id existence, assigns owner, sets status=onboarding
    - Implement: `updateFranchise(id, input)` — validates same constraints
    - Implement: `getFranchise(id)`, `listFranchises(filters)` — read operations
    - Implement: `deleteFranchise(id)` — only if status=onboarding (safety)
    - All actions use `createAdminClient` and check caller is MASTER_ADMIN
    - _Requirements: 1.6, 1.7, 2.1, 2.2_

  - [ ] 4.2 Create franchise lifecycle (status transition) server actions
    - Add to `src/actions/admin-actions/franchiseActions.ts`
    - Implement: `activateFranchise(id)` — validates current status is NOT active, transitions to active
    - Implement: `suspendFranchise(id)` — validates current status is NOT suspended, transitions to suspended
    - Implement: `reactivateFranchise(id)` — validates current status is suspended, transitions to active
    - Reject invalid transitions with specific error messages (already active, already suspended)
    - All transitions verify no unresolved pincode conflicts before activation
    - _Requirements: 2.5, 2.6, 2.9, 2.10, 9.5_

  - [ ] 4.3 Create franchise pincode management server actions
    - Create `src/actions/admin-actions/franchisePincodeActions.ts`
    - Implement: `assignPincodes(franchiseId, pincodes[])` — validates 6-digit format, checks no overlap with other franchises or core pincodes
    - Implement: `removePincodes(franchiseId, pincodes[])` — removes pincode assignments
    - Implement: `getPincodeConflicts(franchiseId)` — returns any pincodes mapped to multiple entities
    - Overlap detection: query `franchise_pincodes` for duplicates AND check against core pincode list
    - Return specific conflict details: which pincode, which entities conflict
    - _Requirements: 2.3, 2.4, 8.8, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6_

  - [ ]* 4.4 Write property tests for pincode assignment and conflict detection
    - **Property 4: Single assignment** — for any pincode, it resolves to exactly one entity (core or one franchise), never both
    - **Property 10: Conflict detection prevents live activation** — any territory with unresolved overlaps cannot go live
    - **Property 11: Core_Operation excluded from Franchise_Registry** — no franchises record represents core
    - **Validates: Requirements 8.8, 9.1, 9.4, 9.5, 9.6, 1.2**

  - [ ] 4.5 Create franchise data stamping utility
    - Create `src/lib/franchise/stamping.ts`
    - Implement: `stampFranchiseId(record, userContext)` — stamps record with user's franchise_id
    - Logic: if user is FRANCHISE_ADMIN → stamp with their franchise_id (ignore any payload value)
    - Logic: if user is ADMIN/MASTER_ADMIN → stamp with NULL (core behavior unchanged)
    - Logic: if franchise_id cannot be resolved for FRANCHISE_ADMIN → reject write
    - This utility will be called by server actions when creating tenant-isolated records
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 4.6 Write property tests for franchise data stamping
    - **Property 5: No cross-contamination on write** — franchise user records always stamped with own franchise_id regardless of payload
    - **Property 6: Core records untouched** — ADMIN/Core user records always get NULL franchise_id
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.6, 4.7**

  - [ ] 4.7 Create pincode-to-franchise assignment resolver
    - Create `src/lib/franchise/assignment-resolver.ts`
    - Implement: `resolveCustomerFranchise(pincode)` — looks up pincode in `franchise_pincodes` table for active franchises, checks core pincode list, returns franchise_id or NULL (core) or 'waitlist'
    - Implement: `assignWaitlistedCustomers(franchiseId, pincodes[])` — batch assign waitlisted customers when pincodes are added
    - Waitlist logic: customer can sign up but cannot place orders until assigned
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [ ]* 4.8 Write property tests for assignment resolver
    - **Property 4: Single assignment** — every pincode resolves to exactly one entity, customer records carry correct franchise_id
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.8**

- [ ] 5. Checkpoint — Verify Phase 2 server actions
  - Ensure all new server actions compile without errors
  - Ensure no existing server actions are modified
  - Ensure franchise CRUD, lifecycle, pincode management, and assignment resolver work correctly
  - Ask the user if questions arise.

- [ ] 6. Phase 2 — SAFE: Master Dashboard franchise management UI
  - [ ] 6.1 Create franchise onboarding page in Master portal
    - Create `src/app/master/franchises/page.tsx` — list all franchises with status badges
    - Create `src/app/master/franchises/new/page.tsx` — create franchise form (name, kitchen, owner assignment, pincodes)
    - Create `src/app/master/franchises/[id]/page.tsx` — franchise detail/edit page with status controls
    - Use existing Shadcn UI components (Table, Badge, Form, Input, Select)
    - Wire to franchise server actions from task 4.1-4.3
    - This is an entirely new route in the master portal — no existing pages affected
    - _Requirements: 1.6, 2.1, 2.3, 2.5, 2.6, 2.9_

  - [ ] 6.2 Create pincode conflict resolution UI
    - Add pincode conflict indicator component to franchise detail page
    - Show conflicting pincodes with which entities they overlap
    - Provide controls to resolve: reassign pincode to one entity or remove from one
    - Block "Activate" button while conflicts exist, with explanation tooltip
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.6_

  - [ ] 6.3 Create Master Dashboard consolidated metrics section
    - Create `src/shared/components/master/FranchiseNetworkOverview.tsx`
    - Display: consolidated revenue (core + all franchises), active subscription count, completed vs scheduled deliveries, active rider count
    - Add franchise drill-down: select a franchise to see its individual metrics
    - Add reporting period selector (defaults to current calendar month)
    - Handle empty data (show zero values) and metric load failures (show error per metric without blocking others)
    - Wire to existing data queries with optional franchise_id filter parameter
    - _Requirements: 6.5, 6.6, 6.7, 6.8, 6.9_

  - [ ]* 6.4 Write unit tests for franchise onboarding UI and metrics
    - Test form validation (name length, pincode format, kitchen required)
    - Test conflict display logic
    - Test status transition button states
    - Test metric fallback behavior (zero values, error states)
    - _Requirements: 1.7, 1.8, 6.8, 6.9, 9.1_

- [ ] 7. Phase 2 — SAFE: Admin Dashboard franchise oversight additions
  - [ ] 7.1 Add franchise oversight section to Admin Dashboard
    - Create `src/shared/components/admin/FranchiseOversight.tsx`
    - Add a "Franchise Data" tab/section to the admin dashboard that shows franchise data grouped by location
    - The existing admin views remain unchanged — this is additive only
    - Core_Admin sees their Hyderabad data as primary (no franchise-selection step), with franchise data available on drill-down
    - CRITICAL: This does NOT modify any existing admin page — it adds a new navigation item/section
    - _Requirements: 6.3, 6.4, 12.4_

  - [ ] 7.2 Create franchise-aware data query helpers
    - Create `src/lib/franchise/queries.ts`
    - Implement query wrappers that accept optional `franchise_id` filter
    - When `franchise_id` is NULL (or not provided), return all records (existing behavior for core admin)
    - When `franchise_id` is provided, filter to that franchise's records
    - These are NEW helper functions — existing queries continue to work unchanged
    - Used by both Admin oversight and later by the Franchise portal
    - _Requirements: 6.1, 6.2, 11.2, 11.4, 11.5, 13.1, 13.3, 13.4, 13.5_

- [ ] 8. Checkpoint — Verify Phase 2 UI is safe
  - Ensure admin.arogyadiet.com continues to work exactly as before
  - Ensure new master franchise pages are accessible and functional
  - Ensure no existing pages, layouts, or components are modified
  - Ask the user if questions arise.

- [ ] 9. Phase 2 — SAFE: Shared RBAC-aware component layer
  - [ ] 9.1 Create franchise-scoped shared operational components
    - Create `src/shared/components/franchise/` directory
    - Create `FranchiseCustomers.tsx` — reuses customer table/list logic, scoped by franchise_id prop
    - Create `FranchiseRiders.tsx` — reuses rider management logic, scoped by franchise_id prop
    - Create `FranchiseInventory.tsx` — reuses inventory views, scoped by franchise_id prop
    - Create `FranchiseOrders.tsx` — reuses order/delivery views, scoped by franchise_id prop
    - Create `FranchiseReports.tsx` — reuses reporting logic, scoped by franchise_id prop
    - Each component accepts `role` and `franchiseId` props to determine scope and visibility
    - RBAC logic: FRANCHISE_ADMIN sees only their data, master-level controls hidden
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ] 9.2 Implement role-based show/hide logic in shared components
    - Create `src/shared/hooks/useFranchiseScope.ts` — hook that provides current user's role and franchise_id
    - Create `src/shared/components/shared/RBACGate.tsx` — wrapper component that conditionally renders children based on role
    - Logic: FRANCHISE_ADMIN → hide master controls, hide core data, hide onboarding tools, hide global config
    - Logic: ADMIN → show core data primary, show franchise oversight secondary
    - Logic: MASTER_ADMIN → show everything including cross-franchise views
    - Logic: no valid role → render access denied indication
    - Logic: FRANCHISE_ADMIN with no assigned franchise → render "no franchise assigned" indication
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

  - [ ]* 9.3 Write unit tests for RBAC gate and scope components
    - Test: FRANCHISE_ADMIN cannot see master controls
    - Test: ADMIN sees core data without franchise-selection step
    - Test: MASTER_ADMIN sees all controls
    - Test: Invalid role shows access denied
    - Test: FRANCHISE_ADMIN with no franchise shows appropriate message
    - **Validates: Requirements 11.2, 11.3, 11.6, 11.7**

- [ ] 10. Phase 3 — CONTROLLED RISK: Middleware changes (backward-compatible additions)
  - [ ] 10.1 Add franchise subdomain routing to middleware
    - Modify `src/middleware.ts` — ADD `franchies` to the `portals` mapping: `franchies: "/franchise"`
    - CRITICAL: This is a single-line addition to the existing portals object — all other routes unchanged
    - The admin, customer, rider, master subdomains continue to work identically
    - Add role check: if subdomain is `franchies` and role is not `FRANCHISE_ADMIN`, redirect to unauthorized
    - Add suspended franchise check: if franchise status is suspended, show suspended indication
    - _Requirements: 10.1, 10.7, 10.8, 2.7_

  - [ ] 10.2 Add franchise admin cross-portal prevention to middleware
    - In the existing gatekeeper logic section, add: if `currentSubdomain === 'admin'` and `roleCode === 'FRANCHISE_ADMIN'`, redirect to `franchies.arogyadiet.com`
    - If `currentSubdomain === 'master'` and `roleCode === 'FRANCHISE_ADMIN'`, redirect to `franchies.arogyadiet.com`
    - This prevents franchise admins from reaching the head-office portals
    - CRITICAL: Only ADDS conditions — does not change existing ADMIN/MASTER_ADMIN/RIDER checks
    - _Requirements: 10.4, 10.7_

  - [ ] 10.3 Add franchise session context injection to middleware
    - After successful FRANCHISE_ADMIN auth, resolve user's `franchise_id` from users table
    - Set franchise_id in response headers or cookies for downstream use by server components
    - If FRANCHISE_ADMIN has no franchise_id → redirect to an error page (no franchise assigned)
    - For ADMIN/MASTER_ADMIN: do NOT set franchise context (they operate globally)
    - For existing RIDER/CUSTOMER: do NOT set franchise context (core operation unchanged)
    - _Requirements: 3.3, 3.4, 10.3, 10.5, 10.6_

  - [ ]* 10.4 Write property tests for routing middleware
    - **Property 7: Routing soundness** — FRANCHISE_ADMIN always routed to franchise workspace, prevented from admin/master; Core_Admin routed to admin; undefined subdomain exposes no data
    - **Validates: Requirements 10.3, 10.4, 10.5, 10.7, 10.9**

- [ ] 11. Checkpoint — Verify middleware changes are backward-compatible
  - Test: admin.arogyadiet.com still works for ADMIN users exactly as before
  - Test: master.arogyadiet.com still works for MASTER_ADMIN users
  - Test: customer and rider portals unaffected
  - Test: franchies.arogyadiet.com routes correctly for FRANCHISE_ADMIN
  - Test: FRANCHISE_ADMIN cannot reach admin or master portals
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Phase 4 — HIGHEST RISK: RLS policies (deploy ONLY after code is tested)
  - [ ] 12.1 Create RLS policies SQL script (DO NOT ENABLE YET)
    - Create `scripts/create-franchise-rls-policies.sql`
    - Write policies for ALL tenant-isolated tables with this logic:
    - SELECT policy: `franchise_id = current_setting('app.franchise_id')::uuid OR franchise_id IS NULL AND current_setting('app.role') IN ('ADMIN', 'MASTER_ADMIN') OR franchise_id IS NOT NULL AND current_setting('app.role') IN ('ADMIN', 'MASTER_ADMIN')`
    - INSERT policy: for FRANCHISE_ADMIN, new row `franchise_id` must equal session franchise_id; for ADMIN, franchise_id must be NULL
    - UPDATE/DELETE policy: same ownership check as SELECT
    - Master bypass: ADMIN and MASTER_ADMIN see ALL rows (core + all franchises)
    - Franchise isolation: FRANCHISE_ADMIN sees only rows matching their franchise_id
    - Core user isolation: existing users (NULL franchise context) see only NULL franchise_id rows (unchanged behavior)
    - IMPORTANT: Script creates policies but does NOT run `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` yet
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2_

  - [ ] 12.2 Add Supabase session context setting to server-side clients
    - Modify `src/lib/supabase/server.ts` — after auth, call `SET LOCAL app.franchise_id = '<uuid>'` and `SET LOCAL app.role = '<role_code>'` on each request
    - Modify `src/lib/supabase/admin.ts` — ensure admin client sets `app.role = 'MASTER_ADMIN'` for unrestricted access
    - CRITICAL: When franchise features are disabled (feature flag OFF), skip the SET LOCAL calls — existing behavior preserved
    - When franchise features are enabled, set context variables that RLS policies will read
    - For ADMIN/MASTER_ADMIN: set role but do NOT set franchise_id (they bypass isolation)
    - For FRANCHISE_ADMIN: set both role and franchise_id
    - For existing RIDER/CUSTOMER: set role only, no franchise_id (they see core records as before)
    - _Requirements: 5.1, 5.7, 6.1, 12.3_

  - [ ]* 12.3 Write property tests for RLS data isolation
    - **Property 1: Total franchise isolation** — franchise user can only access records where franchise_id matches their own
    - **Property 2: Core invisibility to franchises** — franchise user never sees NULL franchise_id (core) records
    - **Property 3: Core and Master completeness** — ADMIN/MASTER_ADMIN see all records (core + all franchises)
    - **Property 8: Global consistency** — global tables return identical data to all consumers
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.7, 5.8, 6.1, 7.1, 7.4**

  - [ ] 12.4 Create RLS enablement script with rollback
    - Create `scripts/enable-franchise-rls.sql` — enables RLS on each tenant-isolated table one at a time
    - Create `scripts/disable-franchise-rls.sql` — ROLLBACK script that disables RLS if issues arise
    - Include a pre-check: verify that `app.role` and `app.franchise_id` session settings are working before enabling
    - Include a smoke test query: after enabling on each table, run a test query as admin to verify access is not broken
    - This script should ONLY be run after: (1) code is deployed with session context setting, (2) smoke tests pass in staging
    - _Requirements: 5.7, 12.3_

- [ ] 13. Checkpoint — Verify RLS is safe before enabling in production
  - Run RLS enablement script in a test/staging environment first
  - Verify: ADMIN users can still see all core records (NULL franchise_id)
  - Verify: existing API calls from admin.arogyadiet.com continue to work
  - Verify: FRANCHISE_ADMIN users see only their franchise data
  - Verify: core RIDER/CUSTOMER users still see their data unchanged
  - Have rollback script ready: `scripts/disable-franchise-rls.sql`
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 14. Phase 5 — SAFE: Franchise portal (entirely new, zero existing impact)
  - [ ] 14.1 Create franchise portal app directory and layout
    - Create `src/app/franchise/` directory structure mirroring admin portal
    - Create `src/app/franchise/layout.tsx` — franchise portal layout with franchise-scoped navigation
    - Create `src/app/franchise/(auth)/login/page.tsx` — franchise admin login page
    - Create `src/app/franchise/(main)/layout.tsx` — authenticated layout with sidebar navigation
    - Navigation items: Dashboard, Customers, Riders, Inventory, Orders, Reports
    - No master-level items (franchise onboarding, global config) in navigation
    - _Requirements: 10.1, 10.3, 11.2, 11.3_

  - [ ] 14.2 Create franchise dashboard page
    - Create `src/app/franchise/(main)/dashboard/page.tsx`
    - Display franchise-specific metrics: active subscriptions, today's deliveries, active riders, revenue this month
    - Use shared franchise-scoped components from task 9.1
    - Pass franchise_id from session context (resolved in middleware)
    - _Requirements: 11.2, 13.5_

  - [ ] 14.3 Create franchise customers management page
    - Create `src/app/franchise/(main)/customers/page.tsx`
    - Render `FranchiseCustomers` component with franchise_id from session
    - Franchise admin sees only their franchise's customers
    - Supports: view customer profiles, subscriptions, delivery history
    - _Requirements: 11.1, 11.2, 13.3_

  - [ ] 14.4 Create franchise riders management page
    - Create `src/app/franchise/(main)/riders/page.tsx`
    - Render `FranchiseRiders` component with franchise_id from session
    - Supports: view/manage rider profiles, service areas, live tracking
    - _Requirements: 11.1, 11.2, 13.4_

  - [ ] 14.5 Create franchise inventory management page
    - Create `src/app/franchise/(main)/inventory/page.tsx`
    - Render `FranchiseInventory` component with franchise_id from session
    - Supports: view/manage inventory lots, products, transactions, manufacturing
    - _Requirements: 11.1, 11.2, 13.3_

  - [ ] 14.6 Create franchise orders and delivery management page
    - Create `src/app/franchise/(main)/orders/page.tsx`
    - Render `FranchiseOrders` component with franchise_id from session
    - Supports: view today's orders, delivery batches, status tracking
    - _Requirements: 11.1, 11.2, 13.1, 13.2_

  - [ ] 14.7 Create franchise reports page
    - Create `src/app/franchise/(main)/reports/page.tsx`
    - Render `FranchiseReports` component with franchise_id from session
    - Supports: revenue, delivery counts, subscription counts — scoped to franchise only
    - _Requirements: 11.1, 11.2, 13.5_

  - [ ] 14.8 Create franchise profile/settings page
    - Create `src/app/franchise/(main)/profile/page.tsx`
    - Display franchise info (name, status, kitchen, served pincodes) — read-only for franchise admin
    - Display franchise admin profile and account settings
    - _Requirements: 10.3, 11.2_

  - [ ]* 14.9 Write integration tests for franchise portal
    - Test: franchise admin login flow resolves correct franchise_id
    - Test: all franchise pages only display data matching the franchise_id
    - Test: master-level controls are hidden from franchise admin
    - Test: suspended franchise shows suspended indication
    - **Property 1: Total franchise isolation** — portal only shows franchise's own data
    - **Property 2: Core invisibility to franchises** — no core data visible
    - **Property 7: Routing soundness** — correct portal routing for franchise admin
    - **Validates: Requirements 10.1, 10.3, 11.2, 11.3, 2.7**

- [ ] 15. Phase 5 — SAFE: Franchise-scoped daily operations
  - [ ] 15.1 Create franchise-scoped delivery routing logic
    - Create `src/lib/franchise/routing.ts`
    - Implement: `runFranchiseRouting(franchiseId, date)` — executes routing using only records matching franchise_id
    - Include only: delivery_orders, rider_profiles, customer addresses WHERE franchise_id matches
    - Exclude: all core records (NULL franchise_id) and other franchise records
    - For core routing: existing `src/lib/routing/` logic remains unchanged — operates on NULL franchise_id records as before
    - _Requirements: 12.5, 12.6, 13.1, 13.2_

  - [ ]* 15.2 Write property tests for franchise-scoped routing
    - **Property 9: Franchise routing scope isolation** — only records matching franchise_id included in computation; core records and other franchise records excluded
    - **Validates: Requirements 12.5, 12.6, 13.1, 13.2**

  - [ ] 15.3 Add franchise_id stamping to existing record creation flows
    - Modify relevant server actions to call `stampFranchiseId()` utility when creating records:
    - `customerActions.ts` — stamp customer_profiles on creation
    - `subscriptionActions.ts` — stamp subscriptions on creation
    - `adminDeliveryActions.ts` — stamp delivery_orders on creation
    - `inventoryActions.ts` — stamp inventory records on creation
    - `riderActions.ts` — stamp rider_profiles on creation
    - CRITICAL: stampFranchiseId returns NULL for non-franchise contexts (ADMIN, existing users) — so existing flows persist NULL as before, ZERO behavior change for core operation
    - Only FRANCHISE_ADMIN users will trigger non-null stamping
    - _Requirements: 4.1, 4.2, 4.6, 4.7, 8.3, 8.4, 12.3_

  - [ ] 15.4 Add franchise assignment to customer signup flow
    - Modify customer signup action to call `resolveCustomerFranchise(pincode)` before completing signup
    - If pincode → active franchise: stamp customer with franchise_id
    - If pincode → core operation: stamp with NULL (existing behavior)
    - If pincode → no match: set customer to waitlist state (accepted but cannot place orders)
    - CRITICAL: For existing core pincodes, resolver returns NULL — signup behavior unchanged
    - _Requirements: 8.1, 8.2, 8.5, 8.6_

  - [ ] 15.5 Implement global table write protection for franchise users
    - Add role check to any server actions that modify global tables (subscription_plans, meal_categories, holidays, products, system_settings)
    - If caller is FRANCHISE_ADMIN → reject modification with "not permitted" error
    - If caller is ADMIN/MASTER_ADMIN → allow modification (existing behavior)
    - FRANCHISE_ADMIN can READ global tables but not modify them
    - _Requirements: 7.2, 7.3, 7.4, 7.5_

  - [ ]* 15.6 Write property tests for global table protection and customer assignment
    - **Property 8: Global consistency** — franchise user modification of global table always rejected
    - **Property 4: Single assignment** — customer signup with pincode resolves to exactly one entity
    - **Validates: Requirements 7.4, 8.1, 8.2, 8.8**

- [ ] 16. Phase 5 — SAFE: Vercel routing configuration
  - [ ] 16.1 Update Vercel configuration for franchise subdomain
    - Update `vercel.json` to add `franchies.arogyadiet.com` domain routing
    - This is a new domain addition — does NOT affect existing domain configurations
    - The franchise portal will only become accessible after DNS is configured by the user
    - No production impact until DNS points to Vercel
    - _Requirements: 10.1_

- [ ] 17. Final checkpoint — End-to-end verification
  - Verify: admin.arogyadiet.com works exactly as before for all existing workflows
  - Verify: master.arogyadiet.com shows franchise management and consolidated metrics
  - Verify: franchies.arogyadiet.com shows franchise-scoped dashboard for FRANCHISE_ADMIN
  - Verify: RLS isolates franchise data correctly (run property tests)
  - Verify: core operation routing runs on NULL franchise_id records only
  - Verify: franchise routing runs on matching franchise_id records only
  - Verify: customer signup assigns correct franchise or waitlists correctly
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at each safety boundary
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases

### Production Safety Summary

| Phase | Risk Level | What Changes | Rollback Strategy |
|-------|-----------|--------------|-------------------|
| Phase 1 (Tasks 1-2) | ✅ SAFE | New tables, nullable columns, new files | DROP new tables/columns |
| Phase 2 (Tasks 4-9) | ✅ SAFE | New server actions, new pages, new components | Delete new files |
| Phase 3 (Tasks 10) | ⚠️ CONTROLLED | Middleware additions | Revert single file to previous version |
| Phase 4 (Tasks 12) | 🔴 HIGHEST RISK | RLS enablement | Run `disable-franchise-rls.sql` rollback script |
| Phase 5 (Tasks 14-16) | ✅ SAFE | New portal, new routing logic, Vercel config | Delete new files, revert vercel.json |

### Deploy Order (CRITICAL)

1. **Deploy Phase 1** — Run SQL scripts to add tables and columns (safe, no code impact)
2. **Deploy Phase 2** — Deploy new server actions and UI pages (safe, no existing code changed)
3. **Deploy Phase 3** — Deploy middleware changes (backward-compatible additions)
4. **TEST IN STAGING** — Verify admin.arogyadiet.com still works perfectly
5. **Deploy Phase 4** — Enable RLS ONLY after code is deployed and session context is working
6. **Deploy Phase 5** — Wire up franchise portal (no impact until DNS configured)
7. **Configure DNS** — Point franchies.arogyadiet.com to Vercel (final activation)

### Feature Flag Strategy

- Environment variable `FRANCHISE_FEATURES_ENABLED=true/false` controls whether franchise context is injected
- When OFF: all existing behavior preserved exactly, middleware skips franchise logic, RLS session vars not set
- When ON: franchise routing, session context, and RLS policies are active
- Gradual rollout: enable in staging first, then production after verification

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2"] },
    { "id": 2, "tasks": ["2.3", "4.1"] },
    { "id": 3, "tasks": ["4.2", "4.3", "4.5"] },
    { "id": 4, "tasks": ["4.4", "4.6", "4.7"] },
    { "id": 5, "tasks": ["4.8", "6.1", "7.2"] },
    { "id": 6, "tasks": ["6.2", "6.3", "7.1"] },
    { "id": 7, "tasks": ["6.4", "9.1"] },
    { "id": 8, "tasks": ["9.2", "9.3"] },
    { "id": 9, "tasks": ["10.1", "10.2"] },
    { "id": 10, "tasks": ["10.3", "10.4"] },
    { "id": 11, "tasks": ["12.1"] },
    { "id": 12, "tasks": ["12.2", "12.3"] },
    { "id": 13, "tasks": ["12.4"] },
    { "id": 14, "tasks": ["14.1", "15.1", "15.5"] },
    { "id": 15, "tasks": ["14.2", "14.3", "14.4", "14.5", "14.6", "14.7", "14.8", "15.3", "15.4"] },
    { "id": 16, "tasks": ["14.9", "15.2", "15.6", "16.1"] }
  ]
}
```
