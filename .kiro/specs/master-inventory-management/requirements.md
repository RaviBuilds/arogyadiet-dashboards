# Requirements Document

## Introduction

This feature relocates warehouse product management from the Admin portal (`admin.arogyadiet.com`) to the Master portal (`master.arogyadiet.com`). Today, the product CRUD capabilities — register a new product, edit a product, and delete a product — are performed by an inventory-access `ADMIN` on the Admin warehouse inventory pages. This feature removes those product CRUD capabilities from the Admin portal and makes the complete warehouse inventory experience (Master Catalog, metrics, Manufacturing Hub, Product Mapping, Audit Ledger, receive/dispatch, category browsing) available to the `MASTER_ADMIN` from the Master portal, with the product CRUD capabilities added on top.

The Master portal already exposes an "Inventory BI" view with a "Warehouse" tab (`master.arogyadiet.com/inventory`). From that Warehouse view, the Master user will open a full warehouse workspace that mirrors the Admin warehouse experience plus product CRUD. The implementation MUST reuse the existing shared warehouse components (`src/shared/components/admin/inventory/*`) and the warehouse service layer (`src/services/inventoryEngine.ts`) rather than re-implementing the warehouse for the Master portal.

## Glossary

- **Admin_Portal**: The portal served at `admin.arogyadiet.com`, whose routes live under `src/app/admin/`.
- **Master_Portal**: The portal served at `master.arogyadiet.com`, whose routes live under `src/app/master/`.
- **ADMIN_Role**: A user whose role code is `ADMIN`. Inventory access is governed by `canAccess(accessLevel, "inventory")`.
- **MASTER_ADMIN_Role**: A user whose role code is `MASTER_ADMIN`, treated as the super-admin with full access; this user authenticates only through the Master_Portal.
- **Admin_Inventory_Pages**: The Admin_Portal warehouse routes at `src/app/admin/inventory/` (Master Catalog page, `/manufacturing`, `/mappings`, `/ledger`).
- **Master_Warehouse_Workspace**: The new Master_Portal view that renders the complete warehouse inventory experience, reached from the Inventory BI Warehouse view.
- **Inventory_BI_Warehouse_View**: The existing Master_Portal "Inventory Intelligence" page (`master.arogyadiet.com/inventory`) "Warehouse" tab rendered by `InventoryIntelligenceShell`.
- **Access_Warehouse_Control**: The UI control on the Inventory_BI_Warehouse_View that opens the Master_Warehouse_Workspace.
- **Return_To_BI_Control**: The UI control within the Master_Warehouse_Workspace that returns the user to the Inventory_BI_Warehouse_View Warehouse tab.
- **Shared_Warehouse_Components**: The portal-agnostic warehouse UI components under `src/shared/components/admin/inventory/` (e.g., `InventoryDashboard`, `InventoryMetrics`, `InventoryHeader`, `RegisterProductSheet`, `ProductCard`, `ManufacturingHubClient`, `ProductMappingClient`, `ledger/LedgerWorkspace`, `OperationsCart`, `modals/*`).
- **Warehouse_Service**: The warehouse business/data layer at `src/services/inventoryEngine.ts`, which uses the service-role admin client and is not bound to an admin session.
- **Warehouse_Actions**: The warehouse Server Actions at `src/actions/inventory-actions/index.ts` (e.g., `addProductAction`, `editProductAction`, `deleteProductAction`, receive/dispatch/manufacturing/mapping actions).
- **Product_CRUD_Capabilities**: The register-new-product, edit-product, and delete-product operations.
- **Product_Management_Capability_Flag**: A capability indicator passed to Shared_Warehouse_Components that controls whether Product_CRUD_Capabilities UI is rendered.
- **Inventory_Operations**: The non-CRUD warehouse operations available to an inventory-access ADMIN_Role today: receive stock, dispatch stock, bulk receive/dispatch, send-to-manufacturing, process manufacturing output, revert pending manufacturing, create/update/delete manufacturing mappings, view metrics, browse categories, and view the audit ledger.

## Requirements

### Requirement 1: Remove product management from the Admin portal

**User Story:** As a platform owner, I want the register, edit, and delete product capabilities removed from the Admin warehouse pages, so that product management is owned exclusively by the Master role.

#### Acceptance Criteria

1. WHEN an ADMIN_Role user with inventory access views the Admin_Inventory_Pages Master Catalog, THE Admin_Portal SHALL render the catalog without a register-new-product control.
2. WHEN an ADMIN_Role user with inventory access views a product on the Admin_Inventory_Pages, THE Admin_Portal SHALL render the product without an edit-product control and without a delete-product control.
3. THE Admin_Portal SHALL continue to render all non-product Inventory_Operations controls on the Admin_Inventory_Pages for an ADMIN_Role user with inventory access.
4. IF an `addProductAction` request originates from an ADMIN_Role user, THEN THE Warehouse_Actions SHALL reject the request, perform no product creation, and return a response indicating the action failed due to insufficient permissions.
5. IF an `editProductAction` request originates from an ADMIN_Role user, THEN THE Warehouse_Actions SHALL reject the request, leave the targeted product record unchanged, and return a response indicating the action failed due to insufficient permissions.
6. IF a `deleteProductAction` request originates from an ADMIN_Role user, THEN THE Warehouse_Actions SHALL reject the request, retain the targeted product record in the Master Catalog, and return a response indicating the action failed due to insufficient permissions.

### Requirement 2: Access the warehouse from the Master Inventory BI Warehouse view

**User Story:** As a MASTER_ADMIN, I want a clearly labeled control on the Inventory BI Warehouse view, so that I can open the full warehouse inventory workspace.

#### Acceptance Criteria

1. WHILE the Inventory_BI_Warehouse_View Warehouse tab is active, THE Master_Portal SHALL display the Access_Warehouse_Control labeled "Access Warehouse".
2. WHILE the Inventory_BI_Warehouse_View Shop Products tab is active, THE Master_Portal SHALL render the Access_Warehouse_Control as neither visible nor activatable.
3. WHEN a MASTER_ADMIN_Role user activates the Access_Warehouse_Control, THE Master_Portal SHALL open the Master_Warehouse_Workspace and render its initial content within 2 seconds.
4. IF a user whose role is not MASTER_ADMIN_Role activates the Access_Warehouse_Control, THEN THE Master_Portal SHALL NOT navigate to the Master_Warehouse_Workspace, SHALL leave the current view unchanged, and SHALL present a restricted-access indication.
5. WHILE the Master_Warehouse_Workspace is open, THE Master_Portal SHALL display a Return_To_BI_Control labeled "Back to Inventory BI" that returns the user to the Inventory_BI_Warehouse_View Warehouse tab.

### Requirement 3: Master warehouse workspace mirrors the Admin warehouse experience

**User Story:** As a MASTER_ADMIN, I want the warehouse workspace to show the same complete warehouse inventory that exists on the Admin portal today, so that I can manage the warehouse without switching portals.

#### Acceptance Criteria

1. WHEN the Master_Warehouse_Workspace finishes loading, THE Master_Portal SHALL render the Master Catalog, inventory metrics cards, and category browsing using the Shared_Warehouse_Components.
2. WHEN the Master_Warehouse_Workspace finishes loading, THE Master_Portal SHALL provide access to the Manufacturing Hub, Product Mapping, and Audit Ledger views using the Shared_Warehouse_Components.
3. THE Master_Warehouse_Workspace SHALL render the receive-stock and dispatch-stock controls for each catalog product using the Shared_Warehouse_Components.
4. WHEN the Master_Warehouse_Workspace reads warehouse data, THE Master_Portal SHALL retrieve the same warehouse catalog and metrics that the Admin_Inventory_Pages retrieve through the Warehouse_Service.
5. WHEN a MASTER_ADMIN_Role user navigates between the Master Catalog, Manufacturing Hub, Product Mapping, and Audit Ledger views within the Master_Warehouse_Workspace, THE Master_Portal SHALL render the selected view without a full-page reload.
6. WHEN a MASTER_ADMIN_Role user submits a receive-stock or dispatch-stock operation from the Master_Warehouse_Workspace, THE Master_Portal SHALL process the operation through the Warehouse_Service and SHALL update the displayed inventory metrics to reflect the result.
7. IF the Warehouse_Service fails to return warehouse data while the Master_Warehouse_Workspace is loading or refreshing, THEN THE Master_Portal SHALL present an error indication, SHALL retain the last successfully rendered view, and SHALL NOT display partial or blank warehouse data.

### Requirement 4: Product management available on the Master portal

**User Story:** As a MASTER_ADMIN, I want to register, edit, and delete warehouse products from the Master warehouse workspace, so that I own the full product lifecycle.

#### Acceptance Criteria

1. WHEN a MASTER_ADMIN_Role user views the Master_Warehouse_Workspace Master Catalog, THE Master_Portal SHALL display the register-new-product control.
2. WHEN a MASTER_ADMIN_Role user views a product in the Master_Warehouse_Workspace, THE Master_Portal SHALL display the edit-product control and the delete-product control for that product.
3. WHEN a MASTER_ADMIN_Role user submits a register-new-product request from the Master_Warehouse_Workspace that includes all required fields, a unique SKU, and exactly one product image, THE Warehouse_Actions SHALL create the product through the Warehouse_Service and return a success result containing the new product identifier within 5 seconds.
4. WHEN a MASTER_ADMIN_Role user submits a valid edit-product request from the Master_Warehouse_Workspace, THE Warehouse_Actions SHALL update the product through the Warehouse_Service, replace the stored product image when a new image is provided and otherwise retain the existing image, and return a success result within 5 seconds.
5. WHEN a MASTER_ADMIN_Role user submits a delete-product request for an existing, not-already-deleted product from the Master_Warehouse_Workspace, THE Warehouse_Actions SHALL soft-delete the product through the Warehouse_Service by setting its deleted_at timestamp and return a success result within 5 seconds.
6. IF a Product_CRUD_Capabilities request submitted from the Master_Warehouse_Workspace fails input validation due to a missing required field, a missing product image on registration, or a duplicate SKU, THEN THE Warehouse_Actions SHALL return a descriptive error result and SHALL NOT modify warehouse data.
7. IF a delete-product request targets a product that does not exist or is already deleted, THEN THE Warehouse_Actions SHALL return a descriptive error result and SHALL NOT modify warehouse data.

### Requirement 5: Capability-flag gating of product CRUD UI

**User Story:** As a developer, I want the product CRUD controls gated by an explicit capability flag in the shared components, so that the same components show product management on the Master portal and hide it on the Admin portal.

#### Acceptance Criteria

1. THE Shared_Warehouse_Components SHALL accept a boolean Product_Management_Capability_Flag that determines whether the Product_CRUD_Capabilities controls (register-new-product, edit-product, delete-product) are rendered.
2. WHERE the Product_Management_Capability_Flag is enabled, THE Shared_Warehouse_Components SHALL render the register-new-product, edit-product, and delete-product controls.
3. WHERE the Product_Management_Capability_Flag is disabled, THE Shared_Warehouse_Components SHALL render none of the register-new-product, edit-product, and delete-product controls as visible or interactable.
4. WHEN the Admin_Inventory_Pages render the Shared_Warehouse_Components, THE Admin_Portal SHALL set the Product_Management_Capability_Flag to disabled.
5. WHEN the Master_Warehouse_Workspace renders the Shared_Warehouse_Components, THE Master_Portal SHALL set the Product_Management_Capability_Flag to enabled.
6. IF the Product_Management_Capability_Flag is not provided to the Shared_Warehouse_Components, THEN THE Shared_Warehouse_Components SHALL default the flag to disabled.
7. THE Product_Management_Capability_Flag SHALL govern presentation only and SHALL NOT replace the authorization enforced by the Warehouse_Actions.

### Requirement 6: Master role authorization for warehouse actions

**User Story:** As a MASTER_ADMIN, I want to perform every warehouse operation from the Master portal that an inventory-access admin can perform, so that I am not required to log in through the Admin portal.

#### Acceptance Criteria

1. WHEN a MASTER_ADMIN_Role user invokes any Warehouse_Action for an Inventory_Operations request, THE Warehouse_Actions SHALL perform a per-action role check and authorize the request.
2. WHEN a MASTER_ADMIN_Role user submits an Inventory_Operations request that passes input validation from the Master_Warehouse_Workspace, THE Warehouse_Actions SHALL complete the operation through the Warehouse_Service and return a success result identifying the completed operation.
3. IF a Warehouse_Action request originates from a user whose role is neither ADMIN_Role with inventory access nor MASTER_ADMIN_Role, THEN THE Warehouse_Actions SHALL reject the request, leave warehouse data unchanged, and return a response indicating an authorization error.
4. WHEN a MASTER_ADMIN_Role user requests the Master_Warehouse_Workspace, THE Master_Portal SHALL serve the workspace without redirecting the user to the Admin_Portal.
5. WHEN an ADMIN_Role user with inventory access submits an Inventory_Operations request that passes input validation, THE Warehouse_Actions SHALL complete the operation through the Warehouse_Service and return a success result.
6. IF an Inventory_Operations request from any authorized role fails input validation, THEN THE Warehouse_Actions SHALL return a descriptive error result and SHALL leave warehouse data unchanged.

### Requirement 7: Context-aware cache revalidation

**User Story:** As a MASTER_ADMIN, I want the warehouse views to reflect my changes immediately after an operation, so that the data I see stays current regardless of which portal initiated the change.

#### Acceptance Criteria

1. WHEN a Warehouse_Action initiated from the Master_Warehouse_Workspace persists its data mutation successfully, THE Warehouse_Actions SHALL revalidate the Master_Warehouse_Workspace route(s) affected by that action and SHALL NOT revalidate Admin_Inventory_Pages routes.
2. WHEN a Warehouse_Action initiated from the Admin_Inventory_Pages persists its data mutation successfully, THE Warehouse_Actions SHALL revalidate the Admin_Inventory_Pages route(s) affected by that action and SHALL NOT revalidate Master_Warehouse_Workspace routes.
3. WHEN a Warehouse_Action completes successfully, THE Master_Warehouse_Workspace SHALL display the resulting warehouse state on the next render without requiring a manual page refresh.
4. IF a Warehouse_Action persists its data mutation successfully but the initiating portal context is absent or unrecognized, THEN THE Warehouse_Actions SHALL revalidate both the Master_Warehouse_Workspace and Admin_Inventory_Pages routes as a fallback.
5. IF a Warehouse_Action fails to persist its data mutation, THEN THE Warehouse_Actions SHALL NOT revalidate any route, SHALL preserve the existing warehouse state unchanged, and SHALL return an error indication identifying the failure to the caller.

### Requirement 8: Master warehouse route access guard

**User Story:** As a platform owner, I want the Master warehouse workspace restricted to the Master role, so that only authorized super-admins can manage the warehouse from the Master portal.

#### Acceptance Criteria

1. WHEN a request carrying an authenticated MASTER_ADMIN_Role session targets the Master_Warehouse_Workspace route, THE Master_Portal SHALL render the Master_Warehouse_Workspace.
2. IF a request for the Master_Warehouse_Workspace route has no authenticated session, THEN THE Master_Portal SHALL redirect the request to the Master_Portal login route without rendering any part of the workspace.
3. IF a request for the Master_Warehouse_Workspace route comes from an authenticated user whose role is not MASTER_ADMIN_Role, THEN THE Master_Portal SHALL redirect the request to the unauthorized route without rendering any part of the workspace.
4. WHEN a request targets the Master_Warehouse_Workspace route, THE Master_Portal SHALL enforce the MASTER_ADMIN_Role guard at the middleware layer before the route handler renders, independent of the layout-level guard.
5. IF a request for the Master_Warehouse_Workspace route carries an expired or invalid session, THEN THE Master_Portal SHALL treat the request as unauthenticated and redirect it to the Master_Portal login route.

### Requirement 9: Reuse without rewriting the warehouse codebase

**User Story:** As a developer, I want the Master warehouse experience built by reusing existing shared code, so that we avoid duplicating and diverging the warehouse implementation.

#### Acceptance Criteria

1. THE Master_Warehouse_Workspace SHALL render every warehouse view using the existing Shared_Warehouse_Components, and SHALL NOT contain any Master-portal-specific component file that duplicates the rendering logic of an existing Shared_Warehouse_Component.
2. THE Master_Warehouse_Workspace SHALL read warehouse data exclusively through the existing Warehouse_Service and SHALL mutate warehouse data exclusively through the existing Warehouse_Actions, without introducing a Master-portal-specific data-access or mutation path.
3. IF any module within the Master_Portal route directories imports a module from another portal's route directories (including the Admin_Portal directories under `src/app/admin/`), THEN THE build process SHALL fail with an error indicating the forbidden cross-portal import and the offending module path.
4. WHERE warehouse behavior must differ between the Admin_Portal and the Master_Portal, THE Shared_Warehouse_Components SHALL accept the differing behavior as one or more props, and SHALL NOT branch on which portal is rendering through portal-specific component copies or hardcoded portal detection.
5. WHEN the Master_Warehouse_Workspace renders a Shared_Warehouse_Component that contains navigation link targets (including InventoryHeader links such as Master Catalog and Manufacturing Hub), THE Shared_Warehouse_Component SHALL resolve each link target from a prop supplied by the rendering portal rather than from a hardcoded `/admin/inventory` path.
