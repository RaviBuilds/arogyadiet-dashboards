# Requirements Document

## Introduction

This feature reorganizes shop product management by separating access concerns between two admin portals. The Admin Operations portal (`/kitchen-shop/inventory`) becomes view-only with status toggle capability, while the Inventory portal (`/admin/inventory`) gains a new "Shop Products" page with full CRUD access. Shared reusable components ensure UI consistency and avoid code duplication.

## Glossary

- **Operations_Admin**: An admin user with `operations` access level who manages day-to-day business operations (customers, subscriptions, riders, shop visibility)
- **Inventory_Admin**: An admin user with `inventory` access level who manages warehouse inventory, manufacturing, product catalog, and shop product CRUD
- **Shop_Product**: A product listed in the customer-facing shop, stored in the `shop_products` table with attributes like name, SKU, price, stock, and active status
- **InventoryPageClient**: The existing client component (`src/shared/components/admin/product-inventory/InventoryPageClient.tsx`) that renders the shop products table and CRUD form
- **Product_Table**: The data table displaying shop products with columns: Image, Name, SKU, Category, Stock Quantity, Sale Price, Status, and Actions
- **Status_Toggle**: A Switch UI control that sets a shop product's `is_active` flag to true (Active/visible) or false (Inactive/hidden)
- **Inventory_Header**: The navigation header component (`InventoryHeader.tsx`) used within the `/admin/inventory` portal section
- **Access_Configuration**: The resolved access configuration object that determines which operations groups and permission levels an admin possesses

## Requirements

### Requirement 1: View-Only Mode for Operations Admin Shop Products Page

**User Story:** As an Operations Admin, I want the Shop Products page at `/kitchen-shop/inventory` to be view-only with only status toggle capability, so that I can control product visibility without accidentally modifying product details.

#### Acceptance Criteria

1. WHEN an Operations_Admin navigates to `/kitchen-shop/inventory`, THE Product_Table SHALL display all shop products without the "Edit" action button in the Actions column
2. WHEN an Operations_Admin navigates to `/kitchen-shop/inventory`, THE Product_Table SHALL display all shop products without the "Delete" action button in the Actions column
3. WHEN an Operations_Admin navigates to `/kitchen-shop/inventory`, THE page SHALL NOT display the "+Add New Product" button in the page header
4. WHEN an Operations_Admin navigates to `/kitchen-shop/inventory`, THE Product_Table SHALL retain the Status_Toggle in the Status column for each product row
5. WHEN an Operations_Admin toggles a product's Status_Toggle, THE system SHALL update the product's `is_active` field in the database and display the new status (Active or Inactive) without requiring a manual page refresh
6. WHEN an Operations_Admin navigates to `/kitchen-shop/inventory`, THE Product_Table SHALL NOT display the "Franchises" action button in the Actions column
7. IF the status toggle server action fails, THEN THE system SHALL revert the Status_Toggle to its previous state and display an error message indicating the visibility update failed
8. WHEN an Operations_Admin navigates to `/kitchen-shop/inventory`, THE Product_Table SHALL NOT display the Actions column header or column cells since no action buttons are available

### Requirement 2: Shop Products Navigation in Inventory Portal

**User Story:** As an Inventory Admin, I want a "Shop Products" navigation item in the Inventory portal header, so that I can access shop product management from within the warehouse system.

#### Acceptance Criteria

1. WHEN an Inventory_Admin is in the `/admin/inventory` portal, THE Inventory_Header SHALL display a "Shop Products" navigation link pointing to `/admin/inventory/shop-products`
2. WHEN an Inventory_Admin clicks the "Shop Products" link, THE system SHALL navigate to `/admin/inventory/shop-products`
3. THE "Shop Products" navigation item SHALL appear immediately after the "Audit Ledger" item and before any end-slot controls in the Inventory_Header navigation bar
4. WHILE an Inventory_Admin is on the `/admin/inventory/shop-products` path or any path prefixed with `/admin/inventory/shop-products/`, THE Inventory_Header SHALL apply the active visual style to the "Shop Products" link, matching the same active indicator used for other navigation items
5. WHILE an Inventory_Admin is on a path that does not start with `/admin/inventory/shop-products`, THE Inventory_Header SHALL display the "Shop Products" link in the inactive style, matching the inactive style of other navigation items

### Requirement 3: Full CRUD Shop Products Page in Inventory Portal

**User Story:** As an Inventory Admin, I want a full-access Shop Products page at `/admin/inventory/shop-products`, so that I can create, edit, delete, and manage all shop product operations from the inventory section.

#### Acceptance Criteria

1. WHEN an Inventory_Admin navigates to `/admin/inventory/shop-products`, THE page SHALL display the "+Add New Product" button in the page header area above the Product_Table
2. WHEN an Inventory_Admin navigates to `/admin/inventory/shop-products`, THE Product_Table SHALL display an "Edit" action button for each product row that is visible and enabled
3. WHEN an Inventory_Admin navigates to `/admin/inventory/shop-products`, THE Product_Table SHALL display a "Delete" action button for each product row that is visible and enabled
4. WHEN an Inventory_Admin navigates to `/admin/inventory/shop-products`, THE Product_Table SHALL display a "Franchises" action button for each product row that opens the franchise availability dialog
5. WHEN an Inventory_Admin navigates to `/admin/inventory/shop-products`, THE Product_Table SHALL display the Status_Toggle (active/inactive switch) for each product row, reflecting the product's current is_active state
6. WHEN an Inventory_Admin clicks "+Add New Product", THE system SHALL open the product creation dialog with empty fields for name (required), SKU (required), category, description, original price (required), sale price, stock quantity (required), tax percent, and media upload
7. WHEN an Inventory_Admin clicks "Edit" on a product row, THE system SHALL open the product edit dialog pre-populated with the selected product's current stored values for all fields (name, SKU, category, description, pricing, stock, tax, and media)
8. WHEN an Inventory_Admin clicks "Delete" on a product row, THE system SHALL display a confirmation dialog indicating the product will be archived (soft-deleted) before executing the archive operation
9. IF a user without the "inventory" or "inventory_operations" access level navigates to `/admin/inventory/shop-products`, THEN THE system SHALL redirect the user to their designated landing route based on their access level
10. IF the product creation or edit form is submitted with missing required fields (name, SKU, original price, or stock quantity), THEN THE system SHALL prevent submission and indicate the required fields that need to be completed

### Requirement 4: Reusable Component Architecture

**User Story:** As a developer, I want the shop product UI components to be reusable with configurable access modes, so that both the operations view-only page and inventory full-access page share the same codebase without duplication.

#### Acceptance Criteria

1. THE InventoryPageClient component SHALL accept an `accessMode` prop of type `"view-only" | "full-access"` that determines which action buttons are rendered, defaulting to `"full-access"` when omitted
2. WHEN `accessMode` is set to "view-only", THE InventoryPageClient SHALL hide the "+Add New Product" button, "Edit" button, "Delete" button, and "Franchises" button, and SHALL NOT render the product create/edit form dialog
3. WHEN `accessMode` is set to "full-access", THE InventoryPageClient SHALL display all action buttons: "+Add New Product", "Edit", "Delete", "Franchises", and Status_Toggle
4. WHILE `accessMode` is "view-only", THE InventoryPageClient SHALL retain the Status_Toggle as the only interactive action per product row, invoking the same visibility-toggle server action as in full-access mode
5. THE InventoryPageClient component SHALL accept an optional `pageTitle` prop (string, maximum 100 characters) to customize the page header title, defaulting to "Inventory" when omitted
6. THE InventoryPageClient component SHALL accept an optional `pageDescription` prop (string, maximum 300 characters) to customize the page header description, defaulting to "Manage shop product catalog, stock levels, and availability." when omitted
7. IF an `accessMode` value other than "view-only" or "full-access" is provided, THEN THE InventoryPageClient SHALL fall back to "full-access" behavior

### Requirement 5: Shared Data Consistency

**User Story:** As an Inventory Admin, I want to see real-time status changes made by Operations Admins, so that I have an accurate view of product availability.

#### Acceptance Criteria

1. WHEN an Operations_Admin toggles a Shop_Product status to Inactive, THE system SHALL persist the `is_active` value as `false` in the shared products table within 2 seconds
2. WHEN an Inventory_Admin navigates to or refreshes `/admin/inventory/shop-products` after an Operations_Admin has toggled a Shop_Product status, THE page SHALL display the current `is_active` value as persisted in the database without serving stale cached data
3. WHEN an Inventory_Admin toggles a Shop_Product status at `/admin/inventory/shop-products`, THE Operations_Admin SHALL see the updated status reflected on next page load or browser refresh at `/kitchen-shop/inventory`
4. THE system SHALL use the same database table and the same server action (`adminToggleProductVisibility`) for status changes initiated from either portal
5. IF the status toggle server action fails due to a database error or permission denial, THEN THE system SHALL return an error result to the initiating admin and SHALL NOT modify the product's current `is_active` value

### Requirement 6: Access Control Enforcement

**User Story:** As a system administrator, I want proper access control on the new inventory shop products page, so that only authorized Inventory Admins can access the full CRUD interface.

#### Acceptance Criteria

1. WHEN a user with `operations` access level navigates to `/admin/inventory/shop-products`, THE system SHALL redirect the user to `/dashboard` (the landing route for operations-level admins)
2. WHEN a user whose role is not `ADMIN` (e.g., unauthenticated or non-admin role) navigates to `/admin/inventory/shop-products`, THE system SHALL redirect the user to `/unauthorized`
3. THE `/admin/inventory/shop-products` page SHALL be protected by the same `canAccess(accessLevel, "inventory")` guard in the inventory layout that protects all other inventory pages
4. WHEN a user with `inventory` or `inventory_operations` access level navigates to `/admin/inventory/shop-products`, THE system SHALL render the page without access denial

### Requirement 7: Inventory Portal Design Consistency

**User Story:** As an Inventory Admin, I want the Shop Products page to match the inventory portal's design language, so that the user experience is consistent across all warehouse pages.

#### Acceptance Criteria

1. THE Shop Products page at `/admin/inventory/shop-products` SHALL render within the existing inventory layout (Inventory_Header, muted background, flex column structure)
2. THE Shop Products page SHALL use the same `AdminPageHeader` component pattern used by other inventory pages for its title and action area
3. THE Shop Products page at `/admin/inventory/shop-products` SHALL inherit all shared layout elements (sticky header, notification bell, navigation highlighting) from the inventory layout

### Requirement 8: Franchise Stock Visibility for Inventory Admin

**User Story:** As an Inventory Admin, I want to see and manage franchise-level product availability from the inventory shop products page, so that I can control distribution across franchise locations.

#### Acceptance Criteria

1. WHEN an Inventory_Admin clicks the "Franchises" button on a product row, THE system SHALL open the `ProductFranchiseAvailabilityDialog` and fetch franchise availability data for that product before displaying results
2. THE franchise availability dialog SHALL display a table with columns: Franchise name (with status badge if not active), Visibility (Shown/Hidden indicator), and Stock quantity (with "not set" annotation when unconfigured)
3. IF the franchise availability data fetch fails, THEN THE system SHALL display an error message indicating the data could not be loaded, and SHALL NOT display stale or partial data
4. WHEN the franchise availability dialog is opened and no franchise records exist for the product, THE system SHALL display an empty-state message indicating no franchises are configured
