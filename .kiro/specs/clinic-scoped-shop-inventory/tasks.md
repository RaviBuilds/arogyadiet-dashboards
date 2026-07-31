# Implementation Plan: Clinic-Scoped Shop Inventory

## Overview

Implementation proceeds bottom-up in the layering the design establishes: idempotent SQL migrations and `SECURITY DEFINER` RPCs first, then the pure decision layer in `src/lib/shop/clinicStock.ts` (which every property test targets), then repositories, server actions, auth scoping, and finally the three UI surfaces plus the franchise behaviours and the data migration.

Language and stack are fixed by the design: TypeScript 5 / Next.js 16 App Router for application code, `plpgsql` for the RPCs, Vitest 4 + fast-check 4 for tests. Migration scripts are flat files in `scripts/` following the house banner-header + ORDERING + Rollback convention.

Ordering rationale: the RPCs and the pure logic are built and property-tested before any UI, so the invariants (no negative stock, stock equals ledger IN − OUT, all-or-nothing submissions) are locked down before there is a surface that can violate them.

## Tasks

- [x] 1. Database foundation — clinic overlay and ledger schema
  - [x] 1.1 Create `scripts/create-clinic-product-settings-table.sql`
    - `clinic_product_settings` table with `uq_clinic_product` unique on (`clinic_id`, `product_id`), `stock_quantity` CHECK between 0 and 1,000,000, `is_visible` defaulting to `true`
    - `idx_cps_clinic` and `idx_cps_product` indexes
    - Triggers: `trg_cps_updated_at`, `trg_cps_core_clinic_only` (rejects a `clinic_id` whose `clinics.franchise_id` is not null, `CLINIC_NOT_CORE:` prefix), `trg_cps_increase_guard` (rejects any increase unless `current_setting('app.clinic_stock_in', true) = 'on'`, `CLINIC_STOCK_INCREASE_FORBIDDEN:` prefix)
    - Backfill triggers `trg_products_seed_clinic_settings` (products AFTER INSERT) and `trg_clinics_seed_product_settings` (clinics AFTER INSERT WHEN `franchise_id IS NULL`)
    - `ENABLE ROW LEVEL SECURITY`, `GRANT SELECT TO authenticated`, policy `cps_read_authenticated`
    - Fully idempotent (`IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP POLICY IF EXISTS`) with an ORDERING section and a Rollback block
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 8.2, 8.3_

  - [x] 1.2 Create `scripts/create-clinic-product-ledger-table.sql`
    - `clinic_ledger_direction` and `clinic_movement_source` enums via `DO $$ ... pg_type` guards
    - `clinic_product_ledger` table with `id BIGINT GENERATED ALWAYS AS IDENTITY`, quantity CHECK (1..1,000,000), `ck_cpl_direction_source`, `ck_cpl_reference`
    - `reject_clinic_ledger_mutation()` + `trg_cpl_append_only` BEFORE UPDATE OR DELETE (`CLINIC_STOCK_LEDGER_IMMUTABLE:` prefix), plus `REVOKE UPDATE, DELETE ... FROM authenticated, anon`
    - `idx_cpl_clinic_time` and `idx_cpl_clinic_product` indexes
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.8, 2.9, 2.10, 2.11, 2.12, 9.7_

  - [x] 1.3 Create the column-addition migrations
    - `scripts/add-inventory-product-link-to-products.sql`: `products.inventory_product_id` nullable FK to `inventory_products` with `ON DELETE SET NULL` and a partial index
    - `scripts/add-clinic-stamp-to-addon-orders.sql`: `addon_orders.clinic_id` nullable FK, stamp-immutability trigger rejecting any change to an already-set value while permitting `NULL → value` (`CLINIC_STAMP_IMMUTABLE:` prefix), `(clinic_id, created_at DESC)` partial index
    - `scripts/add-admin-clinic-id-to-users.sql`: `users.admin_clinic_id` nullable FK, partial index, Core-clinic-only trigger reading `clinics.franchise_id`
    - _Requirements: 3.1, 10.1, 10.12, 13.1, 13.12_

  - [x]* 1.4 Write integration tests for the schema guards
    - Backfill triggers create one overlay row per Core Clinic on product insert and one per non-deleted product on Core Clinic insert; a forced trigger failure rolls back the parent insert
    - Direct `UPDATE` raising `stock_quantity` outside the stock-in flow is rejected; `UPDATE`/`DELETE` on `clinic_product_ledger` both raise; setting `addon_orders.clinic_id` from a set value raises while `NULL → value` succeeds
    - RLS smoke: an `authenticated` client can `SELECT` `clinic_product_settings` and cannot mutate `clinic_product_ledger`
    - _Requirements: 1.10, 1.11, 1.12, 2.9, 8.3, 10.12_

- [x] 2. Types, validation schemas, and the pure decision layer
  - [x] 2.1 Create `src/types/clinicShop.ts`
    - `ClinicLedgerDirection`, `ClinicMovementSource`, `ClinicProductOverlayRow`, `ClinicLedgerEntry` (BIGINT `id` as string), `ClinicShopProductRow`
    - _Requirements: 1.1, 2.1, 5.5_

  - [x] 2.2 Create `src/validations/clinicShopInventory.ts`
    - `clinicStockQuantitySchema`, `movementQuantitySchema`, `stockInLineSchema`, `stockInSubmissionSchema`, `clinicVisibilitySchema`, `productInventoryLinkSchema`, `clinicScopeAssignmentSchema`
    - _Requirements: 1.5, 1.7, 1.8, 2.2, 2.3, 7.13, 10.7, 13.11_

  - [x] 2.3 Create `src/lib/shop/clinicStock.ts` pure logic module
    - `STOCK_QUANTITY_MAXIMUM`, `resolveEffectiveOverlay`, `computeAggregateStock`, `isExposedInClinicShop`, `validateMovementQuantity`, `validateStockLevel`, `mergeStockInLine`, `planFifoDepletion`, `evaluateStockInSubmission`, `evaluateSaleSubmission`, `resolveDestination`
    - No Supabase import, no I/O
    - _Requirements: 1.13, 3.10, 5.3, 5.6, 5.11, 5.12, 6.3, 7.4, 7.8, 7.12, 7.14, 9.5, 10.7, 11.1, 19.5_

  - [x]* 2.4 Create shared test arbitraries and the RPC semantics model
    - `src/test/shop/clinicStockArbitraries.ts`: `arbStockQuantity` (biased to 0, 1, 999,999, 1,000,000), `arbMovementQuantity`, `arbOverlayRow`, `arbMissingOverlay`, `arbLotSet`, `arbMovementSequence`, `arbLedgerEntrySet`, `arbDestinationParam`, `arbAdminScope`, `arbSaleChannel`, `arbRejectionCause`
    - `src/test/shop/clinicStockModel.ts`: TypeScript model of `clinic_shop_stock_in`, `clinic_shop_apply_sale`, `set_clinic_product_visibility`, `franchise_shop_stock_in`, and `migrate_shop_stock_to_clinics` semantics
    - _Requirements: 2.7, 7.6, 7.10, 11.2_

  - [x]* 2.5 Write property test for movement quantity validation
    - **Property 15: Movement quantity validation accepts exactly the valid range**
    - **Validates: Requirements 1.7, 1.8, 2.2, 2.3, 7.13, 10.7, 17.4, 18.7, 18.8**

  - [x]* 2.6 Write property test for missing overlay resolution
    - **Property 10: Missing overlay reads as zero and hidden**
    - **Validates: Requirements 1.13, 5.6, 9.5, 19.5**

  - [x]* 2.7 Write property test for customer-shop exposure
    - **Property 11: Customer-shop exposure requires all four conditions**
    - **Validates: Requirements 6.1, 6.2, 6.3, 15.1**

  - [x]* 2.8 Write property test for aggregate stock
    - **Property 12: Aggregate stock equals the sum of clinic stocks**
    - **Validates: Requirements 3.10, 5.3, 20.8**

  - [x]* 2.9 Write property test for stock-in cart line merging
    - **Property 14: Cart lines are unique per destination and product**
    - **Validates: Requirements 7.3, 7.4**

  - [x]* 2.10 Write property test for destination resolution
    - **Property 19: Destination resolution always yields a renderable mode**
    - **Validates: Requirements 5.2, 5.7, 5.8, 5.11, 5.12, 19.2, 19.3**

- [x] 3. Checkpoint - schema and pure logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Atomic mutation RPCs and the clinic data access layer
  - [x] 4.1 Create `scripts/create-clinic-shop-stock-in-rpc.sql`
    - `clinic_shop_stock_in(p_clinic_id, p_lines jsonb, p_actor_user_id)` as `plpgsql SECURITY DEFINER SET search_path = public`
    - `SELECT ... FOR UPDATE` on overlay rows ordered by `product_id`; validate every line (linked product, warehouse availability, 1,000,000 cap, quantity range) before any mutation; reject a franchise destination outright
    - FIFO deplete `inventory_lots`, insert `OUT` `inventory_transactions` with `reason = 'shop-clinic:<clinic_uuid>'`, `set_config('app.clinic_stock_in','on',true)` then raise the overlay, insert one `IN` ledger entry per line referencing the transaction; return a jsonb report
    - Raise with the design's stable prefixes: `CLINIC_STOCK_INSUFFICIENT_WAREHOUSE:`, `CLINIC_STOCK_EXCEEDS_MAXIMUM:`, `CLINIC_STOCK_UNLINKED_PRODUCT:`
    - _Requirements: 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.14, 7.15, 7.16, 2.5, 2.6, 2.8, 2.11, 3.6, 19.4, 19.9_

  - [x] 4.2 Create `scripts/create-clinic-shop-apply-sale-rpc.sql`
    - `clinic_shop_apply_sale(p_clinic_id, p_addon_order_id, p_lines, p_movement_source, p_actor_user_id)`: conditional `UPDATE ... WHERE stock_quantity >= qty` so oversell is structurally impossible, one `OUT` ledger entry per line referencing the order, `RAISE` with `CLINIC_STOCK_INSUFFICIENT_CLINIC:` naming every shortfall product and its available quantity
    - `set_clinic_product_visibility(p_clinic_id, p_product_id, p_is_visible)` upsert-shaped so a missing overlay is created at stock 0
    - _Requirements: 10.8, 10.9, 10.10, 10.11, 11.1, 11.2, 11.3, 11.4, 6.4, 6.6, 19.6_

  - [x] 4.3 Add `verify_clinic_stock_ledger_parity()`
    - Returns every (`clinic_id`, `product_id`) pair whose `stock_quantity` diverges from ledger IN − OUT; detector only, no repair
    - _Requirements: 2.7_

  - [x] 4.4 Create `src/repositories/clinic/clinicProductRepository.ts` and `clinicProductLedgerRepository.ts`
    - `listClinicOverlays`, `listOverlaysForProduct`, `getOverlay`, `listAggregateStockByProduct`, `setVisibility` (via RPC), `applyStockIn` (via RPC)
    - `listLedgerEntries(clinicId, filter?)` ordered by `occurred_at DESC, id DESC`
    - Data access only: module-level `*_COLUMNS`, `createAdminClient()` inside each function, `throw new Error('Failed to ...')` on failure, no validation, no `"use server"`
    - _Requirements: 5.5, 5.13, 9.4, 9.6, 9.7, 9.8, 9.12, 9.13_

  - [x]* 4.5 Write property test for the non-negative stock invariant
    - **Property 1: Clinic stock is never negative**
    - **Validates: Requirements 1.5, 1.6, 11.2, 11.4**
    - Run 500 iterations (movement-sequence exploration)

  - [x]* 4.6 Write property test for stock/ledger parity
    - **Property 2: Stock equals ledger IN minus ledger OUT**
    - **Validates: Requirements 2.5, 2.7, 10.10**
    - Run 500 iterations

  - [x]* 4.7 Write property test for one ledger entry per accepted change
    - **Property 3: Every accepted stock change writes exactly one ledger entry**
    - **Validates: Requirements 2.5, 2.8, 10.8**

  - [x]* 4.8 Write property test for warehouse decrement and FIFO depletion
    - **Property 4: Stock In of Q decrements warehouse stock by exactly Q**
    - **Validates: Requirements 3.6, 7.6, 7.8, 7.16**

  - [x]* 4.9 Write property test for all-or-nothing rejection
    - **Property 5: A rejected submission changes nothing**
    - **Validates: Requirements 7.10, 7.12, 7.14, 7.15, 20.3**
    - Generate the rejection cause and the failing line index rather than splitting per cause

  - [x]* 4.10 Write property test for overlay uniqueness
    - **Property 9: One overlay record per (clinic, product) pair**
    - **Validates: Requirements 1.3, 1.4, 1.10, 1.11, 6.4, 7.7, 20.9**

  - [x]* 4.11 Write property test for concurrent movement composition
    - **Property 16: Concurrent movements compose additively**
    - **Validates: Requirements 7.11, 10.10, 18.5**
    - Run 500 iterations

  - [x]* 4.12 Write property test for ledger immutability
    - **Property 6: Ledger entries are immutable**
    - **Validates: Requirements 2.9, 1.14**

  - [x]* 4.13 Write property test for ledger ordering and filtering
    - **Property 23: Ledger ordering is total and stable**
    - **Validates: Requirements 9.6, 9.7, 9.8**

  - [x]* 4.14 Write integration tests pinning the model to the real RPCs
    - `clinic_shop_stock_in` end to end: overlay increases, lots deplete FIFO, `inventory_transactions` carries `shop-clinic:<uuid>`, one `IN` ledger entry references that transaction
    - Forced mid-transaction failure leaves all four tables untouched; `verify_clinic_stock_ledger_parity()` returns empty after a mixed workload
    - Unit tests for RPC error-prefix to user-message mapping
    - _Requirements: 7.6, 7.9, 7.10, 2.7, 11.1_

- [x] 5. Checkpoint - RPCs and repositories
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Clinic scope in the auth layer and master portal
  - [x] 6.1 Extend `src/lib/auth/adminAccessCore.ts`
    - `CLINIC_SCOPED_GROUPS`, `isClinicScoped`, `validateClinicScopeAssignment`, `resolveReadableClinicId` — all pure and edge-safe
    - _Requirements: 12.9, 13.7, 13.8, 13.11, 13.12, 13.13, 13.14, 14.6, 14.7_

  - [x] 6.2 Extend `src/lib/auth/adminAccess.ts`
    - Add `clinicId: string | null` to `AdminContext` via one extra column on the existing `getCurrentAdminContext` select; add `assertClinicScope` (throw-style) and `checkClinicScope` (result-style)
    - _Requirements: 14.6, 14.7, 14.8, 14.9, 16.5_

  - [x]* 6.3 Write property test for clinic scope confinement
    - **Property 17: Clinic scope confines Shop Products reads and nothing else**
    - **Validates: Requirements 12.1, 12.9, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.9**

  - [x]* 6.4 Write property test for clinic scope assignment validation and round-trip
    - **Property 26: Clinic scope assignment validates and round-trips**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.7, 13.8, 13.9, 13.11, 13.12, 13.13, 13.14, 13.15, 13.16, 13.17**

  - [x] 6.5 Extend `createAdminUser` / `updateAdminUser` in `src/actions/master-actions/adminActions.ts`
    - Accept `clinicId?: string | null`, validate through `validateClinicScopeAssignment`, persist level, assignment, and only the selected clinic-scoped groups in one transaction, reject `operations`/`franchises` groups alongside a scope, reject a scope on a non-`operations` level, clear the assignment when clinic access is unchecked
    - _Requirements: 13.9, 13.10, 13.11, 13.12, 13.13, 13.14, 13.15, 13.16, 13.18_

  - [x] 6.6 Add the Clinic Access checkbox to the `UserManagement` form
    - "This user has clinic level access" shown only for `operations`; dependent Core Clinic dropdown with empty-state and load-failure handling; exactly the four clinic-scoped groups with `manage`/`view`; edit-mode prefill of checkbox, clinic, and stored permission levels
    - _Requirements: 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.17_

  - [x]* 6.7 Write unit tests for scope assignment rejections
    - Clinic access with no clinic selected, `operations`/`franchises` group with a scope set, scope on a non-`operations` level, clinic with a non-null `franchise_id`
    - _Requirements: 13.11, 13.12, 13.13, 13.14_

- [x] 7. Warehouse Shop Products page — destination modes and Stock In
  - [x] 7.1 Create `src/actions/admin-actions/clinicShopInventoryActions.ts`
    - `clinicStockInAction`, `setClinicProductVisibilityAction`, `setProductInventoryLinkAction`, `getDestinationOptionsAction`, `getClinicShopViewAction`, `getClinicLedgerAction`
    - Each: auth gate (`checkWarehouseAccess("inventory_operations")` / `checkWarehouseAccess("product_management")` / clinic-scope check) → Zod → repository or RPC → `revalidatePath`, returning the project's existing `{ success, error? }` shape with the design's message mapping
    - _Requirements: 5.1, 5.10, 5.12, 5.14, 6.2, 6.4, 6.9, 7.6, 9.4, 9.6, 9.14, 14.4, 14.6, 14.7, 16.1, 16.2, 16.3, 16.4, 16.5, 16.8, 16.9, 19.4, 19.9_

  - [ ]* 7.2 Write property test for Stock In authorization
    - **Property 18: Stock In authorization admits only warehouse admins**
    - **Validates: Requirements 4.7, 4.8, 16.1, 16.2, 16.3, 16.4, 16.5, 16.8, 16.9, 19.4**

  - [x] 7.3 Add the page guard and destination resolution to `/admin/inventory/shop-products/page.tsx`
    - `await guardAdminPage("inventory")`; await the `searchParams` Promise (Next.js 16), resolve `destination` through `resolveDestination`, fetch only the selected destination's overlay server-side, render the mode-specific error and empty states
    - _Requirements: 5.2, 5.9, 5.11, 5.12, 5.13, 5.14, 16.7, 19.1, 19.8_

  - [x] 7.4 Build `ShopProductsDestinationSelector` and `MasterCatalogProductSelector`
    - Selector is a client leaf calling `router.replace` with the new destination; catalog selector lists `inventory_products` by name + `base_uom` and always offers "Not linked", with empty-state and load-failure copy
    - _Requirements: 3.2, 3.3, 3.4, 5.1, 5.9, 5.10_

  - [x] 7.5 Add the discriminated `mode` prop to `InventoryPageClient`
    - `all-clinics` (aggregate stock, global visibility, full CRUD, no stock entry), `clinic` (clinic stock, exactly visibility + stock-in), `franchise` (franchise stock, visibility only), `operations-view` (read-only + ledger)
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 9.11, 19.1, 19.2, 19.3_

  - [x] 7.6 Add the isolated `shopStockInCart` slice to `useInventoryStore`
    - `ShopStockInLine`, `addShopStockInLine` (merge on duplicate `(clinicId, productId)`), `removeShopStockInLine`, `clearShopStockInCart`; `OperationsCart` behaviour untouched
    - _Requirements: 7.1, 7.3, 7.4_

  - [x] 7.7 Build `ShopStockInDialog` and `ShopStockInCart`
    - Quantity entry validated through `validateMovementQuantity`, blocked for an unlinked product; cart presents exactly one outbound submission option, empty-state disables submission, submitted lines clear only after the transaction commits and are retained on rejection
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.13, 7.15, 7.10, 7.12, 7.14_

  - [x] 7.8 Update `adminUpsertProduct` and product-link persistence in `inventoryActions.ts`
    - Drop `stockQuantity` from the schema and stop writing `stock_quantity` / `in_stock`; add `inventoryProductId` with the aggregate-stock-is-zero guard and existence check; change the gate on create/edit/delete and `adminToggleProductVisibility` to `checkWarehouseAccess("product_management")`
    - _Requirements: 3.7, 3.8, 3.9, 3.11, 3.12, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 6.8, 6.9_

  - [ ]* 7.9 Write property test for product link gating
    - **Property 21: Product link changes are gated on zero aggregate stock**
    - **Validates: Requirements 3.1, 3.7, 3.8, 3.9, 3.11, 3.12**

  - [ ]* 7.10 Write property test for visibility toggling
    - **Property 13: Visibility toggling is an involution and concurrency-safe**
    - **Validates: Requirements 6.5, 6.6**

  - [ ]* 7.11 Write unit tests for form validation, error mapping, and destination branches
    - Missing name / SKU / price indicates each missing field; a price with three decimals, zero, or negative is rejected naming the field; each RPC exception prefix maps to the requirement's wording; `resolveDestination` on absent, `all`, valid clinic, valid franchise, unknown uuid, malformed string
    - _Requirements: 4.4, 4.5, 4.9, 4.10, 5.11, 6.7, 7.12, 7.14, 7.15_

- [x] 8. Checkpoint - warehouse page and authorization
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Sales paths — clinic attribution, deduction, and oversell prevention
  - [x] 9.1 Create `scripts/extend-place-assisted-addon-order-for-clinic.sql`
    - `CREATE OR REPLACE` of `place_assisted_addon_order` taking `clinic_id` and `movement_source`, stamping `addon_orders.clinic_id`, and performing the clinic decrement plus `OUT` ledger inserts inline after `addon_order_items`, all in the one implicit transaction; existing franchise and walk-in branches unchanged
    - _Requirements: 10.3, 10.4, 10.5, 10.8, 10.9, 10.10, 10.11, 11.1, 11.2, 11.3_

  - [x] 9.2 Thread the fulfilling clinic through `assistedOrderActions.ts` and `AssistedOrderService`
    - Resolve the clinic from the admin's scope assignment or the explicit selection for an unscoped admin; reject a submission with no fulfilling clinic; reject a product not presented for the admin's clinic and a quantity above effective clinic stock; preserve existing pricing, eligibility, delivery-date, and walk-in validation
    - _Requirements: 10.3, 10.4, 10.5, 10.6, 10.7, 15.9, 15.10, 15.11, 15.12_

  - [x] 9.3 Add `availableStock` to `AssistedOrderProduct` and cap the builder input
    - Present only products visible with stock > 0 at the admin's clinic, display the clinic's effective stock, cap quantity entry, render the no-products and load-failure states, keep customer search unfiltered by clinic, and point "See orders" at the scoped shop orders page
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7, 15.8_

  - [x] 9.4 Add the core-clinic branch to `src/actions/shop-actions.ts`
    - `createAddonCheckoutOrder` / `processStandaloneCheckout`: resolve `customer_profiles.clinic_id`, present nothing and reject when unset, pre-check `Effective_Clinic_Stock`, stamp `addon_orders.clinic_id`
    - `verifyAddonPayment`: call `clinic_shop_apply_sale` for core clinic orders alongside the existing franchise failsafe, flagging `fulfillment_status = UNFULFILLABLE_STOCK` on a post-capture shortfall
    - _Requirements: 10.2, 10.11, 10.13, 11.1, 11.5, 11.6_

  - [ ]* 9.5 Write property test for oversell rejection
    - **Property 8: Oversell is rejected**
    - **Validates: Requirements 10.11, 11.1, 11.3, 11.5, 11.6, 15.10**
    - Generate the sale channel rather than splitting per channel

  - [ ]* 9.6 Write property test for the order clinic stamp
    - **Property 7: The order clinic stamp is immutable and complete**
    - **Validates: Requirements 10.1, 10.12, 13.18**

  - [ ]* 9.7 Write property test for Dispatch Stock isolation
    - **Property 22: Dispatch Stock leaves clinic shop stock untouched**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 7.9**

  - [ ]* 9.8 Write unit tests for `place_assisted_addon_order` payload construction
    - Scoped admin with a selected customer, scoped admin walk-in, unscoped admin with an explicit clinic, unscoped admin with no clinic (rejection)
    - _Requirements: 10.3, 10.4, 10.5, 10.6_

- [x] 10. Operations Shop Products page, clinic ledger view, and shop orders scoping
  - [x] 10.1 Add `ClinicSelector` and wire the Operations Shop Products page
    - Clinic dropdown over Core Clinics, fixed to the assignment for a clinic-scoped admin with no other selectable value; no-selection prompt, no-clinics empty state, assigned-clinic-unavailable error; per-clinic stock and visibility resolved server-side under `resolveReadableClinicId`; no stock-in action, no visibility toggle, no CRUD actions
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.11, 9.13, 9.14, 14.4, 14.5, 14.8, 16.6_

  - [x] 10.2 Build `ClinicLedgerView`
    - Mirrors `LedgerWorkspace` sectioning with IN/OUT sections only; each entry shows timestamp, product name, direction, quantity, movement source; separate IN and OUT filters; no-movements, no-filter-match, and load-failure states
    - _Requirements: 9.6, 9.7, 9.8, 9.9, 9.10, 9.12_

  - [x] 10.3 Scope the shop orders page by clinic stamp
    - Clinic-scoped admin sees only their stamped orders with no selector; unscoped admin gets a selector, all clinics when unselected, and an `Unassigned` grouping for unstamped orders; rows show buyer, total, status, and clinic name; reject a request naming a clinic outside scope server-side; empty-state and load-failure copy
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8, 12.9_

- [x] 11. Franchise behaviours
  - [x] 11.1 Harden `receive_franchise_transfer` line validation
    - `CREATE OR REPLACE` adding per-line integrality and 1..1,000,000 range validation before any lot insert, identifying each out-of-range line; existing single-transaction, idempotent, no-confirm-step behaviour and untouched `franchise_product_settings` preserved
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.6, 17.7_

  - [x] 11.2 Create `franchise_shop_stock_in` and its server action
    - `scripts/create-franchise-shop-stock-in-rpc.sql` over `franchise_inventory_lots`: FIFO depletion, `franchise_product_settings` row created at stock 0 and `is_visible = false` when missing, one `OUT` franchise ledger entry with a shop-stock-in reason, quantity range and 1,000,000 cap checks, unlinked-product rejection
    - `franchiseShopStockInAction` in `src/actions/franchise-actions/franchiseInventoryActions.ts` taking the franchise id from `resolveScope()`, never the client; Stock In action on `FranchiseShopProductsClient` for linked products only, with the stock load-failure state
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7, 18.8, 18.9, 18.10, 18.11, 18.12_

  - [x] 11.3 Extend `toggleFranchiseProductVisibility` for Franchise_Mode
    - Optional explicit franchise id honoured only for an authorized Inventory_Admin, franchise-session path unchanged; creates a missing settings row at stock 0 with the submitted visibility; optimistic toggle reverts on failure
    - _Requirements: 19.1, 19.2, 19.3, 19.5, 19.6, 19.7, 19.8, 19.10_

  - [ ]* 11.4 Write property test for franchise shop stock-in
    - **Property 24: Franchise shop stock-in mirrors the clinic guarantees**
    - **Validates: Requirements 18.2, 18.3, 18.4, 18.5, 18.6, 18.8, 18.9, 18.10, 18.11**

  - [ ]* 11.5 Write property test for franchise transfer receipt
    - **Property 25: Franchise transfer receipt is atomic and idempotent**
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.5, 17.6, 17.7**

- [x] 12. Data migration of existing shared shop stock
  - [x] 12.1 Create `scripts/migrate-shared-shop-stock-to-clinics.sql`
    - `migrate_shop_stock_to_clinics()`: abort with a report when no Core Clinic exists; pre-scan and abort when any non-deleted product exceeds 1,000,000; resolve the earliest-created Core Clinic as target; `INSERT ... ON CONFLICT (clinic_id, product_id) DO NOTHING` for every (Core Clinic × non-deleted product) pair with `is_visible = products.is_active`, target stock `COALESCE(products.stock_quantity, 0)` clamped to 0 when negative or non-integral, others 0; one `MIGRATION` `IN` entry per inserted row with positive stock; return a jsonb report; leaves `products.stock_quantity`, product links, and `franchise_product_settings` untouched
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9, 20.10, 20.11, 20.12, 20.13_

  - [ ]* 12.2 Write property test for the migration
    - **Property 20: Migration is quantity-preserving and idempotent**
    - **Validates: Requirements 20.1, 20.4, 20.5, 20.7, 20.8, 20.9, 20.10, 20.12**

  - [ ]* 12.3 Write integration test for migration idempotency
    - `migrate_shop_stock_to_clinics()` run twice produces identical overlay quantities and ledger entries; a no-Core-Clinic run creates nothing and reports it
    - _Requirements: 20.2, 20.9, 20.10, 20.13_

- [ ] 13. Accessibility coverage for the new surfaces
  - [ ]* 13.1 Add `axe-core` checks to the new interactive components
    - Destination Selector, Stock In dialog, stock-in cart, clinic ledger table, Clinic Access checkbox with its dependent dropdown, using the existing `@testing-library` + `axe-core` setup
    - _Requirements: 5.1, 7.1, 7.5, 9.6, 13.2, 13.4_

- [x] 14. Final checkpoint - full suite
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Every multi-table mutation lives in a `plpgsql SECURITY DEFINER` RPC; no JS loop performs a multi-table stock movement
- All 26 correctness properties from the design are covered by exactly one property test each, placed next to the code they constrain
- Properties 1, 2, and 16 run 500 iterations; every other property runs at least 100
- Properties needing real transactional behaviour run against `src/test/shop/clinicStockModel.ts`, which task 4.14 pins to the real RPCs
- Migration scripts stay idempotent and carry a Rollback block, so re-running is always safe
- One open judgement call from the design carries into task 9.4: a post-payment-capture shortfall flags the order `UNFULFILLABLE_STOCK` rather than failing the order, which is narrower than Requirement 11.1's unconditional rejection

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "2.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "6.1"] },
    { "id": 2, "tasks": ["2.4", "4.1", "4.2", "4.3", "6.2", "11.1"] },
    { "id": 3, "tasks": ["1.4", "2.5", "2.6", "2.7", "2.8", "2.9", "2.10", "4.4", "6.5", "11.2"] },
    { "id": 4, "tasks": ["4.5", "4.6", "4.7", "4.8", "4.9", "4.10", "4.11", "4.12", "4.13", "4.14", "6.3", "6.4", "6.6", "6.7", "7.1", "11.3", "12.1"] },
    { "id": 5, "tasks": ["7.2", "7.3", "7.4", "7.5", "7.6", "7.8", "9.1", "11.4", "11.5", "12.2", "12.3"] },
    { "id": 6, "tasks": ["7.7", "7.9", "7.10", "7.11", "9.2", "9.3", "10.1", "10.2", "10.3"] },
    { "id": 7, "tasks": ["9.4"] },
    { "id": 8, "tasks": ["9.5", "9.6", "9.7", "9.8"] },
    { "id": 9, "tasks": ["13.1"] }
  ]
}
```
