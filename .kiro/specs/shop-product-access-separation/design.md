# Design Document: Shop Product Access Separation

## Overview

This feature separates shop product management access between two admin portals by introducing an `accessMode` prop to the existing `InventoryPageClient` component. The Operations Admin portal (`/kitchen-shop/inventory`) becomes view-only with only status toggle capability, while the Inventory portal gains a new `/admin/inventory/shop-products` page with full CRUD access. Both portals share the same underlying component, server actions, and database table — the only difference is which UI controls are rendered.

### Design Rationale

Rather than duplicating the shop product management UI, we extend the existing `InventoryPageClient` with a configurable access mode. This approach:
- Eliminates code duplication between portals
- Ensures both views stay synchronized since they read from the same `products` table
- Keeps the status toggle server action (`adminToggleProductVisibility`) shared across both portals
- Aligns with the project's shared component strategy (`src/shared/components/`)

## Architecture

```mermaid
graph TD
    subgraph "Operations Admin Portal"
        A["/kitchen-shop/inventory page.tsx"] -->|accessMode="view-only"| C[InventoryPageClient]
    end

    subgraph "Inventory Portal"
        B["/admin/inventory/shop-products page.tsx"] -->|accessMode="full-access"| C
    end

    C -->|Status Toggle| D[adminToggleProductVisibility]
    C -->|Create/Edit| E[adminUpsertProduct]
    C -->|Delete| F[adminDeleteProduct]
    D --> G[(products table)]
    E --> G
    F --> G

    subgraph "Navigation"
        H[InventoryHeader] -->|"Shop Products" link| B
    end

    subgraph "Access Control"
        I[inventory layout.tsx] -->|canAccess 'inventory'| B
        J[guardAdminGroup 'shop_products'] --> A
    end
```

### Data Flow

1. Both pages server-side fetch products via `adminGetProducts()` (no cache, `revalidate = 0`)
2. Products are passed as props to `InventoryPageClient`
3. The `accessMode` prop controls conditional rendering of action buttons
4. Status toggle calls `adminToggleProductVisibility` → updates `products.is_active` → `router.refresh()` re-fetches
5. Inventory portal CRUD operations go through existing `adminUpsertProduct` / `adminDeleteProduct` server actions

## Components and Interfaces

### Modified: `InventoryPageClient`

**File:** `src/shared/components/admin/product-inventory/InventoryPageClient.tsx`

```typescript
type AccessMode = "view-only" | "full-access";

interface InventoryPageClientProps {
  products: AdminInventoryProduct[];
  accessMode?: AccessMode;     // defaults to "full-access"
  pageTitle?: string;          // defaults to "Inventory", max 100 chars
  pageDescription?: string;    // defaults to "Manage shop product catalog...", max 300 chars
}
```

**Conditional rendering logic:**
- `accessMode === "view-only"`: Hides "+Add New Product" button, removes Actions column entirely, retains Status toggle in Status column, does not render product form Dialog
- `accessMode === "full-access"` (default): Renders all existing UI — Add, Edit, Delete, Franchises buttons, and product form Dialog

**Column definitions change:**
- The `columns` useMemo will conditionally include/exclude the `actions` column based on `accessMode`
- The Status column with Switch remains regardless of mode

### Modified: `InventoryHeader`

**File:** `src/shared/components/admin/inventory/InventoryHeader.tsx`

Add "Shop Products" to the `buildNavItems` function after "Audit Ledger":

```typescript
function buildNavItems(basePath: string) {
  return [
    { label: "Master Catalog", href: basePath },
    { label: "Manufacturing Hub", href: `${basePath}/manufacturing` },
    { label: "Product Mapping", href: `${basePath}/mappings` },
    { label: "Audit Ledger", href: `${basePath}/ledger` },
    { label: "Shop Products", href: `${basePath}/shop-products` },
  ];
}
```

The existing `isActive` logic (startsWith for sub-routes) already handles active state highlighting for the new path.

### New: Shop Products Page (Inventory Portal)

**File:** `src/app/admin/inventory/shop-products/page.tsx`

```typescript
import { adminGetProducts } from "@/actions/admin-actions/inventoryActions";
import InventoryPageClient from "@/shared/components/admin/product-inventory/InventoryPageClient";

export const revalidate = 0;

export default async function ShopProductsPage() {
  const products = await adminGetProducts();

  return (
    <InventoryPageClient
      products={products}
      accessMode="full-access"
      pageTitle="Shop Products"
      pageDescription="Manage shop product catalog, stock levels, and availability."
    />
  );
}
```

Access control is inherited from the parent `inventory/layout.tsx` which already enforces `canAccess(accessLevel, "inventory")`.

### Modified: Operations Admin Inventory Page

**File:** `src/app/admin/(main)/kitchen-shop/inventory/page.tsx`

```typescript
import { adminGetProducts } from "@/actions/admin-actions/inventoryActions";
import InventoryPageClient from "@/shared/components/admin/product-inventory/InventoryPageClient";
import { guardAdminGroup } from "@/lib/auth/adminAccess";

export const revalidate = 0;

export default async function InventoryPage() {
  await guardAdminGroup("shop_products");
  const products = await adminGetProducts();

  return (
    <InventoryPageClient
      products={products}
      accessMode="view-only"
      pageTitle="Shop Products"
      pageDescription="View shop products and control their visibility status."
    />
  );
}
```

## Data Models

### Existing: `products` Table (No Changes)

The feature does not modify the database schema. Both portals read/write the same `products` table:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid | Primary key |
| name | text | Required |
| sku | text | Required |
| category | text | Nullable |
| original_price | numeric | Required |
| sale_price | numeric | Nullable |
| stock_quantity | integer | Required |
| tax_percent | numeric | Nullable |
| description | text | Nullable |
| short_description | text | Nullable |
| image_urls | text[] | Nullable |
| banner_image_url | text | Nullable |
| is_active | boolean | Toggle target |
| in_stock | boolean | Derived from stock_quantity |
| deleted_at | timestamptz | Soft delete marker |
| created_at | timestamptz | Auto |
| updated_at | timestamptz | Auto |

### Existing: Server Actions (Minor Modifications)

The `adminToggleProductVisibility` action currently calls `checkGroupManage("shop_products")`. For the view-only Operations Admin to toggle visibility, the guard must allow both "manage" and "view" permission levels for the toggle action specifically. Two options:

**Option A (Recommended):** Change the toggle action's guard to a lower threshold that allows view-level access to the `shop_products` group:
```typescript
// In adminToggleProductVisibility:
const gate = await checkGroupManage("shop_products"); 
// Keep as-is — Operations admins with shop_products group access already have manage rights for this group
```

Since the existing `guardAdminGroup("shop_products")` on the Operations page already succeeds for operations admins (they have the `shop_products` group configured), and `checkGroupManage` checks the same group configuration, no server action changes are needed. The existing permission model already allows operations admins to toggle visibility.

**Revalidation paths:** The `INVENTORY_PATH` constant in `inventoryActions.ts` should be updated to revalidate both portal paths, or use a broader revalidation strategy:
```typescript
// Update revalidation to cover both portals
revalidatePath("/admin/kitchen-shop/inventory");
revalidatePath("/admin/inventory/shop-products");
```

### Type: `AccessMode`

```typescript
// Can be co-located in InventoryPageClient or extracted to src/types/
type AccessMode = "view-only" | "full-access";
```



## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Toggle visibility round-trip

*For any* shop product with any `is_active` state (true or false), calling `adminToggleProductVisibility(product.id, product.is_active)` SHALL result in the product's `is_active` value in the database being the logical negation of its previous value.

**Validates: Requirements 1.5, 5.4**

### Property 2: Navigation path active classification

*For any* URL pathname string, the `isActive` function for the "Shop Products" nav item (href = `basePath/shop-products`) SHALL return `true` if and only if the pathname starts with `basePath/shop-products`.

**Validates: Requirements 2.4, 2.5**

### Property 3: Inventory access control truth table

*For any* `AdminAccessLevel` value, `canAccess(level, "inventory")` SHALL return `true` if and only if the level is `"inventory"` or `"inventory_operations"`. Specifically: `"operations"` → `false`; `"inventory"` → `true`; `"inventory_operations"` → `true`.

**Validates: Requirements 3.9, 6.1, 6.4**

### Property 4: Form validation rejects incomplete product submissions

*For any* product form data where at least one required field (name, SKU, original_price, or stock_quantity) is missing or empty, `adminUpsertProduct(formData)` SHALL return `{ success: false }` without modifying the `products` table.

**Validates: Requirements 3.10**

### Property 5: Failed toggle preserves product state

*For any* shop product, if the database update in `adminToggleProductVisibility` fails (e.g., due to a DB error), the product's `is_active` value SHALL remain unchanged and the action SHALL return `{ success: false }`.

**Validates: Requirements 1.7, 5.5**

## Error Handling

| Scenario | Behavior | User Feedback |
|----------|----------|---------------|
| Status toggle DB failure | Revert Switch to previous state; `is_active` unchanged | Toast error: "Failed to update product visibility." |
| Product upsert validation failure | Form not submitted; action returns error | Toast error with first Zod validation message |
| Product upsert DB failure | No record created/updated | Toast error: "Failed to save product." |
| Product delete (archive) DB failure | No record modified | Toast error: "Failed to archive product." |
| Franchise data fetch failure | Dialog shows error state, no stale data | Error message in dialog body |
| Unauthorized access to inventory shop-products | Redirect before page renders | User sees their landing page (e.g., /dashboard) |
| Non-ADMIN role access attempt | Redirect before page renders | User sees /unauthorized |
| Invalid accessMode prop value | Falls back to "full-access" behavior | No error shown; full CRUD rendered |

### Error Recovery Patterns

- **Optimistic UI revert:** The status toggle uses `useTransition` — if the server action fails, `router.refresh()` is NOT called, so the UI stays at the original state. The Switch component's `checked` prop is bound to `product.is_active` from the server-fetched data, so on next render after error it reverts.
- **Form validation:** Zod schema validation runs server-side in the action. Client-side HTML5 `required` attributes provide immediate feedback. Both layers must pass for the mutation to proceed.
- **Stale data prevention:** `revalidate = 0` on both pages ensures every navigation fetches fresh data. `router.refresh()` after successful mutations triggers RSC re-render with latest DB state.

## Testing Strategy

### Unit Tests (Example-Based)

Focus on rendering behavior and specific interaction scenarios:

| Test | What it verifies |
|------|-----------------|
| Render with `accessMode="view-only"` | No Edit, Delete, Franchises, Add buttons; no Actions column; Status toggle present |
| Render with `accessMode="full-access"` | All buttons present (Edit, Delete, Franchises, Add, Status toggle) |
| Render with custom `pageTitle` / `pageDescription` | Header displays provided title/description |
| Render with invalid `accessMode` | Falls back to full-access rendering |
| InventoryHeader nav items order | "Shop Products" appears after "Audit Ledger" |
| InventoryHeader link href | "Shop Products" link points to `basePath/shop-products` |
| Click Add New Product (full-access) | Dialog opens with empty fields |
| Click Edit on product row | Dialog opens pre-populated with product data |
| Click Delete on product row | Confirmation dialog appears |
| Toggle fails → error toast | Toast error shown, switch reverts |

### Property-Based Tests

**Library:** fast-check (TypeScript PBT library)
**Configuration:** Minimum 100 iterations per property

| Property Test | Tag |
|---------------|-----|
| Toggle flips is_active | Feature: shop-product-access-separation, Property 1: Toggle visibility round-trip |
| isActive path classification | Feature: shop-product-access-separation, Property 2: Navigation path active classification |
| canAccess inventory truth table | Feature: shop-product-access-separation, Property 3: Inventory access control truth table |
| Form rejects missing required fields | Feature: shop-product-access-separation, Property 4: Form validation rejects incomplete product submissions |
| Failed toggle preserves state | Feature: shop-product-access-separation, Property 5: Failed toggle preserves product state |

### Integration Tests

| Test | What it verifies |
|------|-----------------|
| Operations admin loads view-only page | Page renders with products, no CRUD buttons |
| Inventory admin loads full-access page | Page renders with products, all CRUD buttons |
| Status toggle persists to DB | Toggle, then re-fetch — is_active flipped |
| Cross-portal consistency | Toggle in one portal, load other portal — sees updated state |
| Access control redirect (operations user → inventory page) | Redirect to /dashboard |
| Access control redirect (non-ADMIN → inventory page) | Redirect to /unauthorized |
| Product create flow | Fill form, submit, product appears in table |
| Product edit flow | Edit fields, submit, product updated in table |
| Product delete flow | Confirm archive, product removed from table |
