# Implementation Plan: Master Inventory Management

## Overview

This plan relocates warehouse product CRUD from the Admin portal to the Master portal by **reusing** the existing shared warehouse components, the `inventoryEngine` service, and the `inventory-actions` Server Actions (Req 9). The work is sequenced bottom-up: a soft-delete migration, then pure authorization/portal/revalidation helpers, then the server-side guard, then service-layer changes, then action wrappers, then capability-flag/base-path props on shared components, then the Admin pages, then the new Master workspace routes, the BI "Access Warehouse" wiring, and finally the cross-portal ESLint guard. Each step builds on the previous and ends wired into a running portal — no orphaned code.

Implementation language: **TypeScript** (Next.js App Router, React Server Components/Server Actions), matching the existing stack. Property-based tests use `fast-check` with the project's configured test runner, minimum 100 iterations each, tagged `// Feature: master-inventory-management, Property {n}: ...`.

## Tasks

- [x] 1. Add soft-delete schema for warehouse products
  - Create `scripts/add-inventory-product-soft-delete.sql` adding a nullable `deleted_at timestamptz` column to `inventory_products` and a partial index `idx_inventory_products_active ON inventory_products (id) WHERE deleted_at IS NULL`
  - Use `ADD COLUMN IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` so the script is idempotent
  - _Requirements: 4.5, 4.7_

- [x] 2. Implement pure warehouse-access helpers
  - [x] 2.1 Create `src/lib/inventory/warehouse-access.ts`
    - Define types `WarehouseCapability` (`"inventory_operations" | "product_management"`), `PortalContext` (`"admin" | "master" | "unknown"`), `WarehouseArea` (`"catalog" | "manufacturing" | "mappings"`)
    - Implement pure `resolveWarehouseAuthorization(roleCode, accessLevel, capability)`: `product_management` → `MASTER_ADMIN` only; `inventory_operations` → `MASTER_ADMIN` or (`ADMIN` and `canAccess(level, "inventory")`)
    - Implement pure `resolvePortalFromHost(host)` mapping `admin.*`/`master.*` hosts to portal context and everything else to `"unknown"`
    - Implement pure `resolveRevalidationTargets(portal, areas)` using the area→path table (catalog/manufacturing/mappings for admin vs master), returning a de-duplicated array; `"unknown"` returns the union of both portals' paths
    - No I/O in this module
    - _Requirements: 1.4, 1.5, 1.6, 6.1, 6.3, 6.5, 7.1, 7.2, 7.4, 9.5_

  - [x]* 2.2 Write property test for product-management authorization
    - **Property 1: Product management is authorized for MASTER_ADMIN only**
    - **Validates: Requirements 1.4, 1.5, 1.6**
    - Generators: role codes incl. `MASTER_ADMIN`, `ADMIN`, `RIDER`, `FRANCHISE_ADMIN`, `null`, arbitrary strings; access levels across the `AdminAccessLevel` domain

  - [x]* 2.3 Write property test for inventory-operations authorization
    - **Property 2: Inventory operations are authorized for MASTER_ADMIN or inventory-access ADMIN**
    - **Validates: Requirements 6.1, 6.3, 6.5**

  - [x]* 2.4 Write property test for context-aware revalidation targets
    - **Property 8: Revalidation targets match the initiating portal context**
    - **Validates: Requirements 7.1, 7.2, 7.4**
    - Generators: power set of `catalog`/`manufacturing`/`mappings`; portal contexts admin/master/unknown

  - [x]* 2.5 Write unit tests for `resolvePortalFromHost`
    - Cover `admin.arogyadiet.com`, `master.arogyadiet.com`, localhost variants, empty/`null`, and arbitrary hosts → `"unknown"`
    - _Requirements: 7.4_

- [x] 3. Implement server-side warehouse access guard
  - [x] 3.1 Add guard functions to `src/lib/auth/adminAccess.ts`
    - Add `WarehouseAccessDeniedError` (carrying the requested `capability`)
    - Implement `assertWarehouseAccess(capability)` (throw-style) and `checkWarehouseAccess(capability)` (result-style `{ ok: true } | { ok: false; error }`) reusing `getCurrentAdminContext()` (`roleCode`, `accessLevel`) and `resolveWarehouseAuthorization`
    - `checkWarehouseAccess` returns a stable user-facing denial string ("You do not have permission to perform this action.")
    - _Requirements: 1.4, 1.5, 1.6, 6.1, 6.3, 6.5_

  - [x]* 3.2 Write unit tests for the guard
    - Assert `MASTER_ADMIN`, inventory-access `ADMIN`, and unauthorized roles map to the correct allow/deny for both capabilities; assert the denial error string
    - _Requirements: 6.3_

- [x] 4. Update warehouse service layer (`src/services/inventoryEngine.ts`)
  - [x] 4.1 Implement soft-delete and active-only reads
    - Change `deleteInventoryProduct(id)` from hard `DELETE` to `UPDATE ... SET deleted_at = now()`, returning a descriptive error when the product does not exist or is already soft-deleted; remove the lot-history block
    - Add `deleted_at IS NULL` filtering to `getInventoryMasterCatalog`, `getInventoryMetrics`, and any product read used by the workspace
    - _Requirements: 4.5, 4.7_

  - [x]* 4.2 Write property test for soft-delete semantics
    - **Property 6: Delete soft-deletes and removes the product from the catalog while retaining history**
    - **Validates: Requirements 4.5**
    - Use an in-memory/mocked Supabase client

  - [x]* 4.3 Write property test for delete error path
    - **Property 7: Deleting a non-existent or already-deleted product errors without mutation**
    - **Validates: Requirements 4.7**

  - [x] 4.4 Implement product uniqueness and edit-image retention
    - In `createInventoryProduct`, add a pre-insert existence check on `lower(trim(name))` among non-deleted products; on collision return the duplicate error
    - In `updateInventoryProduct`, replace the stored image only when a new image is supplied, otherwise retain the existing image; apply all other submitted field values
    - _Requirements: 4.4, 4.6_

  - [x]* 4.5 Write property test for edit-image replacement
    - **Property 5: Edit replaces the product image only when a new image is provided**
    - **Validates: Requirements 4.4**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Add authorization and context-aware revalidation to Warehouse Actions
  - [x] 6.1 Add per-action authorization and portal-context helper to `src/actions/inventory-actions/index.ts`
    - Add a server-only `currentPortalContext()` that reads the `host` header via `next/headers` and calls `resolvePortalFromHost`
    - Gate `addProductAction`/`editProductAction`/`deleteProductAction` with `checkWarehouseAccess("product_management")`; gate receive/dispatch/bulk/manufacturing/mapping actions with `checkWarehouseAccess("inventory_operations")`; on denial return `{ success: false, error }` with no mutation
    - Preserve ordering: authorize → validate input → mutate → revalidate
    - _Requirements: 1.4, 1.5, 1.6, 6.1, 6.2, 6.3, 6.5, 6.6_

  - [x] 6.2 Make revalidation context-aware in `src/actions/inventory-actions/index.ts`
    - Replace each hardcoded `revalidatePath("/admin/inventory...")` with `revalidatePath` over `resolveRevalidationTargets(await currentPortalContext(), areas)` for the areas each action touches
    - Return before any revalidation when the service mutation fails (no revalidation on failure)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x]* 6.3 Write property test for the action input-validation contract
    - **Property 4: Invalid input is rejected with a descriptive error and no mutation**
    - **Validates: Requirements 4.6, 6.6**
    - Mock the service and assert zero mutation calls across invalid payload variants (missing fields, whitespace-only names, missing image, duplicate name)

  - [x]* 6.4 Write integration test for action → service → revalidation
    - Valid receive/dispatch/register/edit/delete from each portal calls the shared service and revalidates only the initiating portal's routes; failed mutation revalidates nothing
    - _Requirements: 6.2, 7.3, 7.5_

- [x] 7. Add capability-flag and base-path props to shared components
  - [x] 7.1 Add base-path/navigation props to `InventoryHeader`
    - Add optional `basePath?: string` (default `/admin/inventory`), `homeHref?: string`, and `endSlot?: ReactNode`
    - Derive all nav link targets (Master Catalog, Manufacturing Hub, Product Mapping, Audit Ledger) and active-route detection from `basePath`; render the right-side control from `endSlot`
    - _Requirements: 5.5, 9.5, 2.5_

  - [x]* 7.2 Write property test for navigation link resolution
    - **Property 9: Navigation link targets resolve from the supplied base path**
    - **Validates: Requirements 9.5**

  - [x] 7.3 Add `productManagement` flag to dashboard/card/register components
    - `InventoryDashboard`: add optional `productManagement?: boolean` (default `false`) and `basePath?: string`; when `false`, never render `RegisterProductSheet` (hero CTA + empty-state CTAs); pass `productManagement` to each `ProductCard`
    - `ProductCard`: add optional `productManagement?: boolean` (default `false`); when `false`, do not render the Edit/Delete dropdown at all; always render Receive/Dispatch
    - `RegisterProductSheet`: add optional `basePath?: string` for `router.refresh` parity
    - _Requirements: 5.1, 5.2, 5.3, 5.6, 5.7_

  - [x]* 7.4 Write property test for capability-flag gating
    - **Property 3: The capability flag fully gates the product CRUD controls**
    - **Validates: Requirements 5.2, 5.3, 5.6**
    - Render across randomized catalogs with the flag enabled vs disabled/omitted

  - [x]* 7.5 Write unit tests for default (disabled) rendering
    - With the flag omitted, register/edit/delete controls are absent while receive/dispatch remain
    - _Requirements: 5.6_

- [x] 8. Update Admin inventory pages to disable product management
  - [x] 8.1 Omit the flag on Admin pages
    - Ensure `src/app/admin/inventory/*` pages render the shared components without `productManagement` (defaults to `false`) and keep the `/admin/inventory` base path and the "Admin Dashboard" end control
    - _Requirements: 1.1, 1.2, 1.3, 5.4_

  - [x]* 8.2 Write tests for Admin pages
    - Master Catalog renders without the register control; product cards render without edit/delete; non-product Inventory Operations controls remain present
    - _Requirements: 1.1, 1.2, 1.3_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Build the Master warehouse workspace routes
  - [x] 10.1 Create workspace layout `src/app/master/(main)/inventory/warehouse/layout.tsx`
    - Re-assert `MASTER_ADMIN` (defense in depth); render `InventoryHeader` with `basePath="/inventory/warehouse"` and a "Back to Inventory BI" `endSlot` linking to `/inventory`; render `OperationsCart`
    - _Requirements: 2.5, 8.1, 8.4, 6.4_

  - [x] 10.2 Create Master Catalog page `inventory/warehouse/page.tsx`
    - Read via `getInventoryMasterCatalog` + `getInventoryMetrics`; render `InventoryMetrics` + `InventoryDashboard` with `productManagement={true}` and the master base path; on service load failure show an error and retain the last view (no partial/blank data)
    - _Requirements: 3.1, 3.3, 3.4, 4.1, 4.2, 5.5, 3.7_

  - [x] 10.3 Create Manufacturing Hub page `inventory/warehouse/manufacturing/page.tsx`
    - Compose `ManufacturingHubClient` via the shared component with master base path
    - _Requirements: 3.2, 9.1_

  - [x] 10.4 Create Product Mapping page `inventory/warehouse/mappings/page.tsx`
    - Compose `ProductMappingClient` via the shared component with master base path
    - _Requirements: 3.2, 9.1_

  - [x] 10.5 Create Audit Ledger page `inventory/warehouse/ledger/page.tsx`
    - Compose `LedgerWorkspace` via the shared component with master base path
    - _Requirements: 3.2, 9.1_

  - [x]* 10.6 Write integration tests for the workspace route guard
    - `MASTER_ADMIN` renders the workspace; no session → Master login; non-master → `/unauthorized`; expired/invalid session treated as unauthenticated
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [x] 11. Wire the Inventory BI entry and return controls
  - [x] 11.1 Add the Access Warehouse control to `InventoryIntelligenceShell`
    - On the Warehouse tab only, render a labeled "Access Warehouse" `<Link>` to `/inventory/warehouse`; do not render it on the Shop Products tab; use client-side navigation (no full reload)
    - _Requirements: 2.1, 2.2, 2.3, 3.5_

  - [x] 11.2 Wire the "Back to Inventory BI" return control
    - Ensure the workspace layout's `endSlot` "Back to Inventory BI" control returns to `/inventory` (Warehouse tab) via client-side navigation
    - _Requirements: 2.5, 3.5_

  - [x]* 11.3 Write unit tests for the entry/return controls
    - "Access Warehouse" present on Warehouse tab and absent on Shop Products tab; "Back to Inventory BI" present and links to `/inventory`
    - _Requirements: 2.1, 2.2, 2.5_

- [x] 12. Enforce the cross-portal import guard
  - [x] 12.1 Add the ESLint rule to `eslint.config.mjs`
    - Add a `no-restricted-imports`/`no-restricted-paths` rule scoped to `src/app/master/**` forbidding `@/app/admin/*` and relative imports into other portal route directories, with a message naming the offending module
    - _Requirements: 9.3_

  - [x]* 12.2 Write a structural lint test
    - A planted `@/app/admin/*` import from `src/app/master/**` fails lint with the offending path; the Master workspace imports only shared/service/action/lib modules
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific granular requirements for traceability.
- Property tests validate the nine universal correctness properties from the design; unit/integration/structural tests cover rendering, route guards, wiring, and the reuse-without-rewrite constraints.
- `productManagement` governs presentation only; the action-level guard (task 6.1) is the security authority (Req 5.7).
- Apply `scripts/add-inventory-product-soft-delete.sql` before exercising delete/soft-delete behavior.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "7.1", "7.3", "11.1", "12.1"] },
    { "id": 1, "tasks": ["3.1", "4.1", "2.2", "2.3", "2.4", "2.5", "7.2", "7.4", "7.5", "8.1", "12.2"] },
    { "id": 2, "tasks": ["4.4", "3.2", "4.2", "4.3", "8.2", "10.1", "10.2", "10.3", "10.4", "10.5"] },
    { "id": 3, "tasks": ["6.1", "4.5", "11.2", "10.6"] },
    { "id": 4, "tasks": ["6.2", "11.3"] },
    { "id": 5, "tasks": ["6.3", "6.4"] }
  ]
}
```
