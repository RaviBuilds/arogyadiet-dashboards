# Implementation Plan: Multi-Tenant Franchise

## Overview

This plan implements the **franchise side** of the `Business → Kitchen → Clinic` model shipped by `core-clinic-architecture`, expanding it into the full hierarchy **Business(`Franchise`) → City → Group → Kitchen → Franchise → Clinic** in TypeScript (Next.js 16 App Router, Server Actions, Supabase). It supersedes the stale flat-franchise plan entirely; every task below is not-started and the orchestrator executes the full plan against the approved design and 21 requirements.

Work follows the design's **Production-Safety Phasing** strictly and in order:

1. **Additive idle schema** — every schema change ships as a **new** file in `scripts/` (the user runs them manually; the agent never executes SQL). New tables/columns are nullable/additive and idempotent; RLS policies are created **idle** (not enabled). Reuses the `create-clinic-hierarchy-tables.sql` shape.
2. **Application code behind `FRANCHISE_FEATURES_ENABLED`** — Scope_Resolver, master-actions surface, middleware hardening, and the Master Hierarchy UI. Core paths stay untouched; while the flag is false no franchise runtime path activates.
3. **Manual backfill / wiring** — performed by the Master_Admin through the new UI (no coding task; no Core data touched).
4. **Enable RLS LAST** — `enable-franchise-hierarchy-rls.sql` is authored and run only after scope binding is verified, with `disable-franchise-hierarchy-rls.sql` for rollback.
5. **Deprecation cleanup** — physically dropping `franchises.kitchen_id` and `franchise_pincodes` is **out of scope**.

Reuse over reinvention is mandatory: the plan builds on the live `businesses` / `cities` / `kitchens` (no geo) / `clinics` (geo + nullable `franchise_id`) tables, the `rider_service_areas` + `uq_service_area_pincode` one-pincode-one-clinic model, the `move_pincode_and_reassign` atomic RPC, `src/lib/clinic/*` (`pincode-resolver.ts`, `stamping.ts`), and the idle RLS helpers (`is_global_role`, `current_franchise_id`, `set_franchise_context`). The legacy `franchises.kitchen_id` and `franchise_pincodes` are **deprecated** (stop reading/writing) but never dropped.

The `Scope_Resolver` (`src/lib/auth/scope-resolver.ts`) is a pure, isolated module so its predicate can be property-tested with `fast-check` (minimum 100 generated cases) and proven logically identical to the RLS predicate. Each property test carries the tag comment `// Feature: multi-tenant-franchise, Property {number}`. DB-level properties (P3 one-pincode-one-entity, P5 inter-group move, P6 stock conservation) run against a seeded ephemeral test schema with the new tables + RPCs.

Key deltas from the stale plan:
- New `groups` table with `groups.kitchen_id NOT NULL UNIQUE` enforcing exactly-one-kitchen-per-group; `franchises.group_id` added; `franchises.kitchen_id` deprecated.
- New `cities.business_id` scoping a franchise City to its `Franchise` Business.
- New `franchise_agreement_documents`, `franchise_warehouses`, `franchise_warehouse_stock`, `stock_transfers` tables and two new atomic RPCs.
- One application-layer `Scope_Resolver` provably consistent with the RLS layer (defense in depth).
- Master Hierarchy tree UI under `src/app/master/(main)/hierarchy/` **replacing** the legacy flat `/franchises` page.
- Additive middleware hardening in `src/middleware.ts` (per-request DB scope binding, unknown-subdomain and franchise-bounce handling).

## Tasks

- [x] 1. Author additive idle schema, atomic RPCs, and idle RLS policies (new `scripts/` files; user runs manually)
  - [x] 1.1 Create the `groups` table with the exactly-one-kitchen constraint
    - Create `scripts/create-groups-table.sql` (additive, idempotent `CREATE TABLE IF NOT EXISTS`, mirroring `create-clinic-hierarchy-tables.sql`): `groups` with `id`, `name VARCHAR(100)` (CHECK length 1..100), `city_id UUID NOT NULL FK→cities(id)`, `kitchen_id UUID NOT NULL UNIQUE FK→kitchens(id)` (enforces Group↔Kitchen 1:1), `created_at`/`updated_at`, plus `idx_groups_city`
    - Do not add `kitchens.group_id`; the FK lives on the Group side so Core kitchens (no Group) stay untouched
    - _Requirements: 2.1, 2.2, 2.4_

  - [x] 1.2 Add `franchises.group_id` and `cities.business_id` (additive, nullable)
    - Create `scripts/add-group-id-to-franchises.sql`: `ALTER TABLE franchises ADD COLUMN IF NOT EXISTS group_id UUID NULL FK→groups(id)` + `idx_franchises_group`; add `ALTER TABLE cities ADD COLUMN IF NOT EXISTS business_id UUID NULL FK→businesses(id)` + `idx_cities_business`
    - Document `franchises.kitchen_id` as **deprecated** (left present, no longer read/written); do not drop it or `franchise_pincodes`
    - _Requirements: 1.1, 3.1, 3.4_

  - [x] 1.3 Create the agreement-documents table
    - Create `scripts/create-franchise-agreement-documents-table.sql`: `franchise_agreement_documents` with `id`, `franchise_id UUID NOT NULL FK→franchises(id)`, `storage_path TEXT`, `file_name VARCHAR`, `content_type VARCHAR CHECK IN ('application/pdf','image/jpeg','image/png')`, `size_bytes BIGINT CHECK (size_bytes <= 10485760)`, `uploaded_by UUID FK→users(id)`, `uploaded_at TIMESTAMPTZ DEFAULT now()`, plus `idx_agreement_docs_franchise`
    - _Requirements: 7.1, 7.2, 7.8_

  - [x] 1.4 Create the franchise warehouse tables
    - Create `scripts/create-franchise-warehouse-tables.sql`: `franchise_warehouses` (`franchise_id UUID NOT NULL UNIQUE FK`, `name VARCHAR`) and `franchise_warehouse_stock` (`warehouse_id UUID NOT NULL FK`, `franchise_id UUID NOT NULL FK` denormalized for RLS, `product_id UUID FK→products(id)`, `quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity >= 0)`, `UNIQUE(warehouse_id, product_id)`) with supporting indexes
    - Do NOT touch the core `inventory_*` / `manufacturing_*` tables (franchise stock is a separate model)
    - _Requirements: 19.1, 19.2, 19.6_

  - [x] 1.5 Create the stock-transfers ledger table
    - Create `scripts/create-stock-transfers-table.sql`: `stock_transfers` with `id`, `source_kind VARCHAR CHECK IN ('CORE','FRANCHISE')`, `source_franchise_id UUID NULL FK` (NULL when source=CORE), `dest_warehouse_id UUID NOT NULL FK`, `dest_franchise_id UUID NOT NULL FK`, `product_id UUID FK`, `quantity NUMERIC NOT NULL CHECK (quantity > 0)`, `created_by UUID FK`, `created_at TIMESTAMPTZ DEFAULT now()`, plus indexes on `dest_franchise_id` and `source_franchise_id`
    - _Requirements: 19.5_

  - [x] 1.6 Author the inter-group-move atomic RPC
    - Create `scripts/create-move-franchise-to-group-rpc.sql` defining `move_franchise_to_group(p_franchise_id uuid, p_dest_group_id uuid) RETURNS uuid` as `SECURITY DEFINER SET search_path = public` (mirroring `move_pincode_and_reassign`): resolve source/destination `city_id`; raise when destination group not found (Req 5.3) or cities differ (Req 5.2); else `UPDATE franchises SET group_id = p_dest_group_id` atomically and return the destination Group's `kitchen_id`; never touch `clinics`, `rider_service_areas`, or any tenant rows (Req 5.5)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 1.7 Author the stock-transfer atomic RPC
    - Create `scripts/create-transfer-stock-rpc.sql` defining `transfer_stock(p_source_kind text, p_source_franchise_id uuid, p_dest_franchise_id uuid, p_product_id uuid, p_quantity numeric, p_created_by uuid) RETURNS uuid` as `SECURITY DEFINER`: reject `quantity <= 0` (Req 19.4) and `quantity > source_available` (Req 19.3) leaving balances unchanged; else decrement source / increment destination so the total is conserved (Req 19.2) and INSERT exactly one `stock_transfers` ledger row (Req 19.5); source may be CORE warehouse or another franchise warehouse (Req 19.7)
    - _Requirements: 19.2, 19.3, 19.4, 19.5, 19.7_

  - [x] 1.8 Author the idle RLS policies for the new tables
    - Create `scripts/create-franchise-hierarchy-rls-policies.sql` (policies created, **NOT enabled**) applying the shared predicate `is_global_role() OR franchise_id = current_franchise_id() OR (franchise_id IS NULL AND current_franchise_id() IS NULL)`: full 4-policy (SELECT/INSERT/UPDATE/DELETE) set on `franchise_warehouses`, `franchise_warehouse_stock`, `stock_transfers` (also matching `source_franchise_id` on SELECT); `franchise_agreement_documents` read = `is_global_role() OR franchise_id = current_franchise_id()`, write = `is_global_role()`; structure tables `groups` (and write-guard for `cities`/`franchises`) get `SELECT USING (true)`, write `is_global_role()`
    - Reuse the existing `is_global_role()` / `current_franchise_id()` helpers; do not enable RLS here
    - _Requirements: 7.5, 9.2, 9.3, 10.1, 10.7, 18.7_

- [x] 2. Define shared types and Zod schemas for the franchise hierarchy
  - [x] 2.1 Define shared TypeScript types
    - Create `src/types/franchise.ts` with `FranchiseStatus` (`"active" | "onboarding" | "suspended"`), `Group`, `Franchise` (with `group_id`, `owner_user_id`; **no** `kitchen_id` usage), `FranchiseCity`, `FranchiseClinic`, `AgreementDocMeta`, `FranchiseWarehouseStock`, `StockTransfer`, `Scope` (`{kind:"full_network"} | {kind:"franchise"; franchiseId} | {kind:"core"}`), and reuse the shared `ActionResult<T>` discriminated union
    - _Requirements: 3.1, 3.3, 6.1, 7.2, 18.1, 19.1_

  - [x] 2.2 Define Zod validation schemas
    - Create `src/validations/franchise.ts` with `franchiseCitySchema` (name 1..100, `businessId` uuid), `groupSchema` (name 1..100, `cityId` uuid), `franchiseSchema` (name 1..100, `groupId` uuid, `ownerUserId` uuid, status enum), `franchiseClinicSchema` (name 1..120, address 1..255, latitude -90..90, longitude -180..180), `agreementDocMetaSchema` (content type ∈ {pdf,jpeg,png}, size ≤ 10485760), and `stockTransferSchema` (sourceKind enum, conditional `sourceFranchiseId`, `destFranchiseId` uuid, `productId` uuid, `quantity > 0`); reuse `validateClinicInput`/`validateCityName` from `src/lib/clinic/validation.ts`
    - _Requirements: 1.2, 2.6, 3.6, 6.4, 6.5, 7.8, 19.4_

- [x] 3. Implement the Scope_Resolver and franchise-hierarchy repositories
  - [x] 3.1 Implement `src/lib/auth/scope-resolver.ts`
    - Implement `resolveScope()` (role + `franchise_id` → exactly one `Scope`; error `"no_franchise"` for a `FRANCHISE_ADMIN` with null `franchise_id`, `"unresolved"` when indeterminate), the **pure** `scopePermits(scope, rowFranchiseId)` mirroring the RLS predicate exactly, `applyScope(query, scope)` (`.eq('franchise_id', f)` for franchise, `.is('franchise_id', null)` for core, no filter for full_network), and `bindDbScope(scope, role)` calling the existing `set_franchise_context` RPC
    - Keep `scopePermits`/`applyScope` free of Supabase imports so they are property-testable in isolation
    - _Requirements: 8.3, 8.4, 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

  - [x]* 3.2 Write property test for tenant isolation soundness (app ≡ RLS predicate)
    - **Property 1: Tenant isolation soundness** — `// Feature: multi-tenant-franchise, Property 1`
    - **Validates: Requirements 10.1, 10.2, 18.7**

  - [x]* 3.3 Write property test for scope soundness / no leakage
    - **Property 2: Scope soundness / no leakage** over generated multi-franchise datasets — `// Feature: multi-tenant-franchise, Property 2`
    - **Validates: Requirements 10.1, 10.4, 10.8**

  - [x] 3.4 Create franchise-hierarchy repositories
    - Add `src/repositories/franchise/` data-access functions for cities (scoped to a business), groups (+ owned kitchen create/delete in one tx), franchises (group association, status, owner), franchise clinics, agreement-doc metadata, warehouse stock, and dependency counts, using `createAdminClient` per the layering rules and applying `applyScope` where a scope is in play
    - _Requirements: 1.1, 2.3, 2.7, 3.1, 6.1, 7.3, 19.1, 19.6_

  - [x] 3.5 Add the global-table read/write guard
    - Add a helper (e.g. in `scope-resolver.ts` or `src/lib/auth/global-tables.ts`) that returns Global_Table reads identically for all scopes (no `franchise_id` filter) and rejects writes from any non-`MASTER_ADMIN`/`ADMIN` caller; wire it into the global-config write paths (`system_settings`, `roles`, `subscription_plans`, `meal_categories`, `holidays`, `products`)
    - _Requirements: 13.1, 13.4, 13.5_

- [x] 4. Checkpoint - schema authored, types/validations, and Scope_Resolver
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement City and Group master actions
  - [x] 5.1 Implement city Server Actions (under a Franchise Business)
    - Create `src/actions/master-actions/cityActions.ts` with `createFranchiseCity`, `updateFranchiseCity`, `deleteFranchiseCity`; validate the business exists AND is type `Franchise` (Req 1.1/1.3), name 1..100 unique case-insensitively within the business (reuse `validateCityName`), dependency-guard delete against Groups (Req 1.4/1.5); `MASTER_ADMIN` only, gated by `FRANCHISE_FEATURES_ENABLED`, resolving scope before any data access
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 5.2 Implement group Server Actions (atomic Group + Kitchen)
    - Create `src/actions/master-actions/groupActions.ts` with `createGroup` (one tx: INSERT kitchen with `business_id := city.business_id`, `city_id`, **no geo**, then INSERT group with `kitchen_id` set), `updateGroup` (rename only; never reassign `kitchen_id`; reject attaching a second Kitchen), `deleteGroup` (one tx delete Group + its Kitchen, guarded by zero Franchises); validate name 1..100 and existing city
    - _Requirements: 2.3, 2.5, 2.6, 2.7, 2.8_

  - [ ]* 5.3 Write property test for the Group↔Kitchen one-to-one invariant
    - **Property 4: Group has exactly one Kitchen** — `// Feature: multi-tenant-franchise, Property 4`
    - **Validates: Requirements 2.2**

  - [ ]* 5.4 Write unit tests for city/group happy-paths and rejection branches
    - Cover create/edit/delete success, duplicate-name, non-existent reference, and dependency-guarded deletion examples
    - _Requirements: 1.2, 1.5, 2.3, 2.6, 2.8_

- [x] 6. Implement franchise registry, lifecycle, and inter-group move
  - [x] 6.1 Implement franchise create/update with owner association
    - Create `src/actions/master-actions/franchiseActions.ts` with `createFranchise` (persist status `onboarding`, stamp `group_id`, require exactly one `FRANCHISE_ADMIN` owner, write the owner's `users.franchise_id`; never write legacy `kitchen_id`) and `updateFranchise`; reject empty/>100/duplicate name, non-existent group, missing owner, out-of-set status
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 4.1, 4.2, 8.1, 8.2_

  - [x] 6.2 Implement franchise lifecycle transitions with overlap guard
    - Add `activateFranchise`, `suspendFranchise`, `reactivateFranchise` to `franchiseActions.ts`: reject no-op transitions (activate-when-active, suspend-when-suspended) leaving status unchanged (Req 4.8); complete within 5s; `activate`/`reactivate` additionally refuse while any unresolved pincode-overlap conflict exists for the franchise (Req 15.6); suspended franchises deny Franchise_Admin dashboard ops while retaining historical records
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 15.5, 15.6_

  - [x] 6.3 Implement the inter-group move action
    - Add `moveFranchiseToGroup(franchiseId, destGroupId)` as a thin wrapper over the `move_franchise_to_group` RPC; surface the re-resolved Kitchen + cascade preview before commit (Req 5.4); preserve `franchise_id`, tenant data, clinic wiring, and pincodes (Req 5.5)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x]* 6.4 Write property test for franchise status-transition validity
    - **Property 9: Franchise status transition validity** (incl. activation blocked by unresolved overlap) — `// Feature: multi-tenant-franchise, Property 9`
    - **Validates: Requirements 4.8, 15.6**

  - [ ]* 6.5 Write property test for inter-group move preserving identity (seeded DB)
    - **Property 5: Inter-group move preserves franchise identity** against a seeded test schema + the `move_franchise_to_group` RPC — `// Feature: multi-tenant-franchise, Property 5`
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.5**

  - [ ]* 6.6 Write unit tests for franchise create/lifecycle/move branches
    - Cover missing-owner, duplicate-name, invalid status transition, cross-city move, and dest-group-not-found examples
    - _Requirements: 3.6, 4.2, 4.8, 5.2, 5.3_

- [x] 7. Implement franchise-to-clinic wiring and pincode-overlap detection
  - [x] 7.1 Implement clinic wiring Server Actions
    - Create `src/actions/master-actions/clinicWiringActions.ts` with `wireClinicToFranchise` and `updateFranchiseClinic`: persist a `clinics` row with `franchise_id` set and `kitchen_id` resolved as the Franchise's Group's single Kitchen (Clinic → Franchise → Group → Kitchen); reuse `validateClinicInput`; reject missing/out-of-range geo and missing name/address (Req 6.5); never store geo on the Kitchen
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 7.2 Implement pincode assignment + overlap detection
    - Add `assignPincodeToFranchiseClinic(pincode, clinicId)` delegating to the existing `move_pincode_and_reassign` RPC (franchise stamp derived from destination clinic); detect overlap via the `uq_service_area_pincode` invariant and surface a conflict naming the pincode and every entity it maps to within 2s, evaluated at setup time (not signup), blocking only activation
    - _Requirements: 6.6, 15.1, 15.2, 15.3, 15.4, 15.7_

  - [ ]* 7.3 Write property test for the one-pincode-one-entity invariant (seeded DB)
    - **Property 3: One-pincode-one-entity** over sequences of assignment ops against a seeded schema + `uq_service_area_pincode` — `// Feature: multi-tenant-franchise, Property 3`
    - **Validates: Requirements 15.1**

  - [ ]* 7.4 Write unit tests for clinic-geo rejection and overlap surfacing
    - Cover out-of-range lat/lng, missing name/address, and duplicate-pincode conflict examples
    - _Requirements: 6.5, 15.2_

- [x] 8. Wire franchise stamping into the reused Assignment_Resolver
  - [x] 8.1 Extend customer stamping to carry `franchise_id` and waitlist promotion
    - Build on `src/lib/clinic/stamping.ts` + `pincode-resolver.ts` so signup resolves the **Primary_Address** pincode to a Clinic and stamps both `clinic_id` and the Clinic's `franchise_id` (NULL for Core); unresolved → Waitlist_State (block ordering, show "area not served"); when a franchise Clinic begins serving a waitlisted pincode, reuse the `assignment-resolver` batch pattern to stamp `franchise_id`/`clinic_id` and clear the waitlist; Delivery_Address selection never changes the association
    - Derive franchise stamping of operational records from the customer's resolved Clinic (Req 14.3/14.4)
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8_

  - [ ]* 8.2 Write property test for assignment determinism by Primary_Address
    - **Property 8: Assignment determinism by Primary_Address** — `// Feature: multi-tenant-franchise, Property 8`
    - **Validates: Requirements 14.1, 14.2, 14.5, 14.8**

- [x] 9. Implement agreement-document management
  - [x] 9.1 Implement agreement-document Server Actions over the private bucket
    - Create `src/actions/master-actions/agreementDocActions.ts` with `uploadAgreementDocument` (validate content type + ≤10MB BEFORE upload; store in private `franchise-documents` bucket under `{franchise_id}/...`; record metadata; `MASTER_ADMIN` only), `listAgreementDocuments` (this franchise's docs only), `replaceAgreementDocument` (keeps `franchise_id`), and `getAgreementDocumentUrl` (short-lived signed URL; access only to `MASTER_ADMIN`/`ADMIN`/owning `FRANCHISE_ADMIN`; generic not-permitted without disclosing existence; never a public URL); provision the private bucket
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9_

  - [ ]* 9.2 Write property test for document access control
    - **Property 7: Document access control** over (role, franchise_id, document) triples — `// Feature: multi-tenant-franchise, Property 7`
    - **Validates: Requirements 7.5, 7.6, 7.7**

- [x] 10. Implement franchise warehouse and stock transfer
  - [x] 10.1 Implement stock-transfer and warehouse-stock Server Actions
    - Create `src/actions/master-actions/stockTransferActions.ts` with `initiateStockTransfer` (delegates to the `transfer_stock` RPC; conserves total; rejects qty>available and qty≤0; records a ledger row; full-network scope only) and `listFranchiseWarehouseStock` (franchise scope sees only its own stock via `applyScope`)
    - _Requirements: 19.2, 19.3, 19.4, 19.5, 19.6, 19.7_

  - [ ]* 10.2 Write property test for stock conservation on transfer (seeded DB)
    - **Property 6: Stock conservation on transfer** against a seeded schema + `transfer_stock` RPC — `// Feature: multi-tenant-franchise, Property 6`
    - **Validates: Requirements 19.2, 19.3, 19.4, 19.5**

  - [ ]* 10.3 Write property test for core coexistence invariance
    - **Property 10: Core coexistence invariance** (core-scope ops never observe/mutate/stamp a non-null `franchise_id`) — `// Feature: multi-tenant-franchise, Property 10`
    - **Validates: Requirements 9.6, 20.1, 20.2, 20.5**

- [x] 11. Checkpoint - master-actions surface, stamping, docs, and stock transfer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Harden middleware and scope-wire the routing/shared-data reads (behind the flag)
  - [x] 12.1 Harden subdomain routing and bind DB scope per request
    - In `src/middleware.ts` (additive, backward-compatible): after resolving role + `franchise_id`, call `bindDbScope` (→ `set_franchise_context`) so RLS enforces the middleware boundary; preserve subdomain on the unauthenticated→login redirect; route unknown named subdomains to `/unauthorized`; redirect a `FRANCHISE_ADMIN` reaching admin/master back to the franchise portal root; retain the suspended-franchise denial; all gated by `FRANCHISE_FEATURES_ENABLED`
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7, 16.8, 16.9, 16.10, 18.7, 20.8_

  - [x] 12.2 Scope-wire the routing engine for franchises
    - Make `src/actions/system-actions/routeEngine.ts` scope-aware: Core routing runs over `franchise_id IS NULL` with no franchise filter (unchanged); franchise routing scopes orders/riders/addresses to one `franchise_id` using the franchise Clinic as origin; Core_Admin can drive routing for Core or any Franchise
    - _Requirements: 20.5, 20.6, 21.1, 21.2, 21.6_

  - [x] 12.3 Scope-wire shared dashboard data reads
    - Apply `applyScope` + the resolved Scope to the shared customer/rider/inventory/order/report data reads so a `FRANCHISE_ADMIN` sees only their franchise's records, `ADMIN` sees Core + oversight, and `MASTER_ADMIN` sees the full network; surface the no-franchise and access-denied indications (Req 17.6/17.7); building the components themselves is out of scope
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7, 17.8, 21.3, 21.4, 21.5_

  - [ ]* 12.4 Write unit/routing tests for middleware gating and scope wiring
    - Cover subdomain→portal mapping, role gating, franchise bounce-back, unknown-subdomain, suspended denial, and franchise-scoped routing/data reads
    - _Requirements: 16.1, 16.5, 16.10, 17.2, 21.1_

- [x] 13. Implement the Master Hierarchy UI (replaces the legacy flat `/franchises` page)
  - [x] 13.1 Build the Hierarchy tree page and tree component
    - Create `src/app/master/(main)/hierarchy/page.tsx` (Server Component, `MASTER_ADMIN` only) loading the City→Group→Kitchen→Franchise→Clinic tree, and `_components/HierarchyTree.tsx` (expandable City > Group + its single Kitchen (no geo) > Franchise + status badge > wired Clinics); remove the legacy flat franchise list from navigation
    - _Requirements: 12.1, 12.2, 12.3, 12.6_

  - [x] 13.2 Build City and Group form dialogs
    - Create `_components/CityFormDialog.tsx` (→ `cityActions`) and `_components/GroupFormDialog.tsx` (→ `groupActions`, creates Group + its Kitchen) using React Hook Form + Zod mirroring the action validators
    - _Requirements: 12.2, 1.2, 2.3_

  - [x] 13.3 Build Franchise form and status controls
    - Create `_components/FranchiseFormDialog.tsx` (create/edit + assign owner → `franchiseActions`) and `_components/FranchiseStatusControls.tsx` (activate/suspend/reactivate with the unresolved-overlap activation guard)
    - _Requirements: 12.2, 3.5, 4.1, 4.3, 4.4, 4.7, 15.6_

  - [x] 13.4 Build the Inter-Group Move dialog
    - Create `_components/InterGroupMoveDialog.tsx` listing only destination Groups in the **same City**, previewing the re-resolved Kitchen + cascade implications, then calling `moveFranchiseToGroup`
    - _Requirements: 12.4, 5.2, 5.4_

  - [x] 13.5 Build the Clinic wiring dialog and pincode-conflict banner
    - Create `_components/ClinicWiringDialog.tsx` (wire/edit franchise Clinic geo + assign pincodes → `clinicWiringActions`) and `_components/PincodeConflictBanner.tsx` surfacing overlap conflicts within 2s naming the pincode + all mapped entities
    - _Requirements: 6.4, 6.5, 15.2, 15.3_

  - [x] 13.6 Build the Agreement Documents panel
    - Create `_components/AgreementDocsPanel.tsx` (upload/list/replace with client-side type/size checks for UX; downloads open via short-lived signed URL only) wired to `agreementDocActions`
    - _Requirements: 12.5, 7.2, 7.3, 7.4, 7.7_

  - [x] 13.7 Wire consolidated cross-franchise reporting on the Master home
    - In the existing Master dashboard home, read consolidated revenue + network-health metrics with `full_network` scope for a selectable period defaulting to the current month, support single-franchise drill-down, zero-value empty states, and per-metric error isolation
    - _Requirements: 11.1, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9_

  - [ ]* 13.8 Write unit tests for Hierarchy UI gating and tree rendering
    - Cover `MASTER_ADMIN`-only gating (no structure leak to non-master), same-city move list, and tree structure rendering examples
    - _Requirements: 12.1, 12.3, 12.6_

- [x] 14. Checkpoint - middleware, scope wiring, and Master Hierarchy UI
  - Ensure all tests pass, ask the user if questions arise.

- [x] 15. Enable RLS last with rollback, then verify isolation
  - [x] 15.1 Author the RLS enable/disable scripts
    - Create `scripts/enable-franchise-hierarchy-rls.sql` (`ENABLE ROW LEVEL SECURITY` on `groups`, `franchises` write-guard, `franchise_agreement_documents`, `franchise_warehouses`, `franchise_warehouse_stock`, `stock_transfers`; companion to `enable-franchise-rls.sql`) and `scripts/disable-franchise-hierarchy-rls.sql` for rollback; the user runs these manually only after scope binding is verified — the agent does not execute SQL
    - _Requirements: 10.7, 18.7, 20.8_

  - [ ]* 15.2 Write integration isolation tests (RLS enabled)
    - Verify a `FRANCHISE_ADMIN` can never read/list/aggregate/modify/delete another franchise's rows; cross-franchise reads are indistinguishable from non-existent; `MASTER_ADMIN`/`ADMIN` see Core + all franchises; core users see only `NULL` `franchise_id`; and the Scope_Resolver ≡ RLS matrix holds for sampled (role, franchise_id, row) triples
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.7, 10.8, 11.1, 11.2, 18.7_

  - [ ]* 15.3 Write regression tests for flag-off core behavior
    - With `FRANCHISE_FEATURES_ENABLED` false (and RLS disabled), verify the Core operation behaves identically to today — no franchise filtering, no franchise-selection step, no new runtime paths
    - _Requirements: 20.3, 20.4, 20.7, 20.8, 20.9_

- [x] 16. Final checkpoint - full hierarchy, isolation, and core coexistence
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- All `scripts/*.sql` files are **authored** by these tasks and run **manually** by the user; the agent never executes SQL. RLS is enabled **last** (Task 15) with a rollback script.
- Every task references specific sub-requirement clauses for traceability and builds on prior tasks; the plan ends by wiring the Master UI and turning on isolation, with no orphaned code.
- Property tests use `fast-check` (≥100 cases) and carry the tag `// Feature: multi-tenant-franchise, Property {n}`. DB-level properties (P3, P5, P6) run against a seeded test schema with the new tables + RPCs.
- Reuse is mandatory: `src/lib/clinic/*`, `move_pincode_and_reassign`, the assignment-resolver batch pattern, and the idle RLS helpers. Legacy `franchises.kitchen_id` and `franchise_pincodes` are deprecated, never dropped (cleanup is out of scope).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "1.4", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.5", "1.8", "2.2"] },
    { "id": 2, "tasks": ["1.6", "1.7", "3.1", "3.4"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.5", "5.1", "5.2"] },
    { "id": 4, "tasks": ["5.3", "5.4", "6.1", "7.1", "9.1", "10.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "7.2", "8.1", "10.2", "10.3"] },
    { "id": 6, "tasks": ["6.4", "6.5", "6.6", "7.3", "7.4", "8.2", "9.2"] },
    { "id": 7, "tasks": ["12.1", "12.2", "12.3"] },
    { "id": 8, "tasks": ["12.4", "13.1"] },
    { "id": 9, "tasks": ["13.2", "13.3", "13.4", "13.5", "13.6", "13.7"] },
    { "id": 10, "tasks": ["13.8", "15.1"] },
    { "id": 11, "tasks": ["15.2", "15.3"] }
  ]
}
```
