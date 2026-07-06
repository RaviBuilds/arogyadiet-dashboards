# Implementation Plan: Shop Product Access Separation

## Overview

This plan separates shop product management access between the Operations Admin portal (view-only with status toggle) and the Inventory portal (full CRUD). The approach extends the existing `InventoryPageClient` with a configurable `accessMode` prop, adds a "Shop Products" navigation link to the Inventory header, creates a new `/admin/inventory/shop-products` page, and modifies the existing Operations Admin page to pass `accessMode="view-only"`.

## Tasks

- [x] 1. Extend InventoryPageClient with accessMode prop
  - [x] 1.1 Add `accessMode`, `pageTitle`, and `pageDescription` props to InventoryPageClient
    - Update the `InventoryPageClientProps` interface to include `accessMode?: "view-only" | "full-access"` (default `"full-access"`), `pageTitle?: string` (default `"Inventory"`, max 100 chars), and `pageDescription?: string` (default `"Manage shop product catalog, stock levels, and availability."`, max 300 chars)
    - If an invalid `accessMode` value is provided, fall back to `"full-access"` behavior
    - Update the component function signature to destructure the new props with defaults
    - _Requirements: 4.1, 4.5, 4.6, 4.7_

  - [x] 1.2 Implement conditional rendering based on accessMode in InventoryPageClient
    - When `accessMode === "view-only"`: hide the "+Add New Product" button from `AdminPageHeader`, remove the Actions column entirely from the `columns` useMemo definition, do not render the product form `Dialog` wrapper
    - When `accessMode === "full-access"` (default): render all existing UI unchanged — Add, Edit, Delete, Franchises buttons, and product form Dialog
    - The Status column with `Switch` toggle remains in both modes, invoking the same `adminToggleProductVisibility` server action
    - Use the `pageTitle` and `pageDescription` props in the `AdminPageHeader` component
    - _Requirements: 4.2, 4.3, 4.4, 1.1, 1.2, 1.3, 1.4, 1.6, 1.8_

  - [ ]* 1.3 Write property test for toggle visibility round-trip
    - **Property 1: Toggle visibility round-trip**
    - **Validates: Requirements 1.5, 5.4**

  - [ ]* 1.4 Write property test for failed toggle preserving state
    - **Property 5: Failed toggle preserves product state**
    - **Validates: Requirements 1.7, 5.5**

- [x] 2. Add "Shop Products" navigation to InventoryHeader
  - [x] 2.1 Add "Shop Products" nav item to InventoryHeader's buildNavItems function
    - Insert `{ label: "Shop Products", href: \`\${basePath}/shop-products\` }` after the "Audit Ledger" entry in the `buildNavItems` function
    - The existing `isActive` logic (which uses `pathname.startsWith(href)` for sub-routes) already correctly handles active state highlighting for the new path
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ]* 2.2 Write property test for navigation path active classification
    - **Property 2: Navigation path active classification**
    - **Validates: Requirements 2.4, 2.5**

- [x] 3. Checkpoint - Verify component changes
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Create Shop Products page in Inventory Portal
  - [x] 4.1 Create the `/admin/inventory/shop-products/page.tsx` route
    - Create `src/app/admin/inventory/shop-products/page.tsx` as a React Server Component
    - Set `export const revalidate = 0` for fresh data on every navigation
    - Call `adminGetProducts()` to fetch products server-side
    - Render `InventoryPageClient` with `products`, `accessMode="full-access"`, `pageTitle="Shop Products"`, and `pageDescription="Manage shop product catalog, stock levels, and availability."`
    - Access control is inherited from the parent `inventory/layout.tsx` which enforces `canAccess(accessLevel, "inventory")`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 6.3, 6.4, 7.1, 7.2, 7.3_

  - [ ]* 4.2 Write property test for inventory access control truth table
    - **Property 3: Inventory access control truth table**
    - **Validates: Requirements 3.9, 6.1, 6.4**

- [x] 5. Modify Operations Admin page to use view-only mode
  - [x] 5.1 Update the existing `/kitchen-shop/inventory/page.tsx` to pass accessMode="view-only"
    - Modify `src/app/admin/(main)/kitchen-shop/inventory/page.tsx` to pass `accessMode="view-only"`, `pageTitle="Shop Products"`, and `pageDescription="View shop products and control their visibility status."` to `InventoryPageClient`
    - The existing `guardAdminGroup("shop_products")` guard and `adminGetProducts()` fetch remain unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [x] 6. Update revalidation paths in server actions
  - [x] 6.1 Update `adminToggleProductVisibility` revalidation to cover both portal paths
    - In `src/actions/admin-actions/inventoryActions.ts`, ensure `revalidatePath` is called for both `/admin/kitchen-shop/inventory` and `/admin/inventory/shop-products` after a successful toggle
    - Verify that both `adminUpsertProduct` and `adminDeleteProduct` also revalidate both paths so cross-portal data stays consistent
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 6.2 Write property test for form validation rejecting incomplete submissions
    - **Property 4: Form validation rejects incomplete product submissions**
    - **Validates: Requirements 3.10**

- [x] 7. Checkpoint - Verify access control and cross-portal consistency
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Integration wiring and final verification
  - [x] 8.1 Verify access control redirects work end-to-end
    - Confirm operations-level admin navigating to `/admin/inventory/shop-products` gets redirected to `/dashboard` by the inventory layout guard
    - Confirm non-ADMIN role navigating to `/admin/inventory/shop-products` gets redirected to `/unauthorized`
    - Confirm inventory/inventory_operations level admin can access the page without denial
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 8.2 Write integration tests for cross-portal data consistency
    - Test that toggling status in one portal is reflected when loading the other portal
    - Test that CRUD operations on the inventory portal page are visible from the operations portal
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- No database schema changes are needed — both portals share the existing `products` table
- Access control for the new page is inherited from the existing `inventory/layout.tsx` — no additional middleware changes required
- The `InventoryHeader` `isActive` function already handles sub-route matching via `startsWith`, so the new "Shop Products" link will get active styling automatically

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2"] },
    { "id": 2, "tasks": ["1.3", "1.4", "4.1", "5.1"] },
    { "id": 3, "tasks": ["4.2", "6.1"] },
    { "id": 4, "tasks": ["6.2", "8.1"] },
    { "id": 5, "tasks": ["8.2"] }
  ]
}
```
