# Requirements Document

## Introduction

Today the CORE business shares a single Shop Products catalogue and a single stock number per product (`public.products.stock_quantity`) across every Core Clinic. Because stock is shared, the platform cannot report how much stock a given clinic held or how much that clinic sold. This feature replaces the single shared shop stock with **per-clinic shop stock** plus a **per-clinic audit ledger**, links each Shop Product to a Master Catalog Product so shop stock-in draws down warehouse stock, and introduces a **clinic-scoped admin** whose Shop Products access is limited to one clinic.

Scope is the CORE business, with three explicitly-called-out franchise behaviours (Requirements 17, 18, 19): received franchise transfers land directly in the franchise warehouse inventory with no confirm-stock-in step, the franchise Shop Products page gains the same Stock In action clinics have, and the warehouse Shop Products destination selector lists franchises in a view-plus-hide-only mode.

Two boundaries define the shape of this feature:

- **Stock only enters a clinic through Stock In.** A Master Catalog dispatch sent directly to a clinic through the existing Dispatch Stock flow does not become clinic shop stock. Clinic shop stock is created only from the warehouse Shop Products page by selecting a clinic and performing a Stock In for a specific product.
- **Clinic scoping applies to the Shop Products module only.** A Clinic_Scoped_Admin sees all Core business Customers, Subscriptions and Riders exactly like any other Operations admin; only Shop Products data and the assisted-order product list are restricted to the assigned clinic.

Key invariants established by this feature:

- Every Core Clinic holds its own shop stock quantity and its own visibility flag per Shop Product.
- Clinic shop stock is never negative, and every change to it is recorded as exactly one Clinic_Shop_Ledger entry, so a clinic's current stock always equals its ledger IN total minus its ledger OUT total.
- A Stock In of quantity Q into a clinic decrements the linked Master Catalog Product's warehouse stock by exactly Q (1 shop item = 1 Master Catalog base unit).
- Every Shop_Order carries an immutable Order_Clinic_Stamp identifying the clinic whose stock fulfilled it.
- Overselling is blocked: a sale is rejected when the requested quantity exceeds the fulfilling clinic's stock for that product.

## Glossary

- **Shop_Product**: A customer-facing shop catalogue row in `public.products` (columns include `id`, `sku`, `name`, `original_price`, `sale_price`, `stock_quantity`, `tax_percent`, `image_urls`, `is_active`, `deleted_at`).
- **Master_Catalog_Product**: A warehouse catalogue row in `public.inventory_products` (columns include `name`, `type`, `base_uom`), whose physical stock lives in `public.inventory_lots.quantity_remaining` and is depleted oldest-lot-first (FIFO).
- **Product_Link**: The nullable association from a Shop_Product to exactly one Master_Catalog_Product, stored as `products.inventory_product_id`.
- **Linked_Shop_Product**: A Shop_Product whose Product_Link is set.
- **Unlinked_Shop_Product**: A Shop_Product whose Product_Link is `NULL`.
- **Base_Unit_Equivalence**: The fixed rule that one Shop_Product item equals one base unit (`inventory_products.base_uom`) of the linked Master_Catalog_Product.
- **Clinic**: A row in `public.clinics`. A Clinic with `franchise_id` `NULL` is a Core_Clinic.
- **Core_Clinic**: A Clinic whose `franchise_id` is `NULL`.
- **Franchise**: A row in `public.franchises`, which owns a franchise warehouse (`franchise_inventories`, `franchise_inventory_lots`) and a franchise shop stock overlay (`franchise_product_settings`).
- **Clinic_Shop_Stock**: The per-clinic, per-product shop stock and visibility record (`clinic_product_settings`: `clinic_id`, `product_id`, `stock_quantity`, `is_visible`, unique on (`clinic_id`, `product_id`)). The Core_Clinic analogue of the existing `franchise_product_settings`.
- **Stock_Quantity_Maximum**: The inclusive upper bound of 1,000,000 applied to any single shop stock quantity value and to any single stock movement quantity.
- **Clinic_Shop_Ledger**: The per-clinic append-only audit ledger of shop stock movements (`clinic_product_ledger`), holding one entry per movement with a direction of `IN` or `OUT`, a positive quantity, a movement source, an actor, and a timestamp. Modelled on the existing `franchise_inventory_ledger` and presented in the same style as the warehouse Audit_Ledger.
- **Audit_Ledger**: The existing warehouse transaction ledger at `/admin/inventory/ledger`, backed by `public.inventory_transactions` and rendered by `LedgerWorkspace`.
- **Movement_Source**: The classification recorded on a Clinic_Shop_Ledger entry, one of `WAREHOUSE_STOCK_IN`, `CUSTOMER_APP_SALE`, `ASSISTED_SALE`, `WALKIN_SALE`, or `MIGRATION`.
- **Stock_In**: The operation that moves a chosen quantity of a Linked_Shop_Product from warehouse Master_Catalog_Product stock into one Core_Clinic's Clinic_Shop_Stock.
- **Shop_Products_Cart**: The outbound-only cart used to submit one or more pending Stock_In quantities together, following the existing `OperationsCart` pattern backed by `useInventoryStore`.
- **Stock_In_Reason_Prefix**: The literal prefix `shop-clinic:` written into `inventory_transactions.reason` for a Stock_In, followed by the destination Core_Clinic identifier. Distinct from the existing `clinic:` Dispatch_Stock prefix.
- **Dispatch_Stock**: The existing warehouse outbound flow (`dispatchStockAction`, `bulkDispatchAction`, `DispatchStockModal`) that sends Master_Catalog_Product stock to a destination using an `inventory_transactions.reason` value, including destinations prefixed `clinic:` and `franchise:`.
- **Warehouse_Shop_Products_Page**: The inventory-portal page at `/admin/inventory/shop-products`.
- **Operations_Shop_Products_Page**: The operations-portal page at `/kitchen-shop/inventory`.
- **Franchise_Shop_Products_Page**: The franchise-portal page at `/shop-products`.
- **Destination_Selector**: The dropdown added to the Warehouse_Shop_Products_Page offering `All Clinics`, each Core_Clinic, and each active Franchise.
- **All_Clinics_Mode**: The Warehouse_Shop_Products_Page state while `All Clinics` is selected in the Destination_Selector.
- **Clinic_Mode**: The Warehouse_Shop_Products_Page state while a specific Core_Clinic is selected in the Destination_Selector.
- **Franchise_Mode**: The Warehouse_Shop_Products_Page state while a specific Franchise is selected in the Destination_Selector.
- **Aggregate_Stock**: For one Shop_Product, the sum of `stock_quantity` across the Clinic_Shop_Stock records of all Core_Clinics.
- **Global_Visibility**: The Shop_Product-level `products.is_active` flag.
- **Clinic_Visibility**: The per-clinic `clinic_product_settings.is_visible` flag.
- **Effective_Clinic_Stock**: For one Core_Clinic and one Shop_Product, the Clinic_Shop_Stock `stock_quantity` when a Clinic_Shop_Stock record exists for that pair, and 0 when no such record exists.
- **Effective_Clinic_Visibility**: For one Core_Clinic and one Shop_Product, the Clinic_Visibility value when a Clinic_Shop_Stock record exists for that pair, and hidden when no such record exists.
- **Shop_Order**: A shop purchase recorded in `public.addon_orders` with line items in `public.addon_order_items`, covering customer-app purchases, admin assisted orders, and walk-in counter sales.
- **Order_Clinic_Stamp**: The `clinic_id` value recorded on a Shop_Order at creation time, identifying the Core_Clinic whose Clinic_Shop_Stock fulfilled the order. Immutable after creation.
- **Aligned_Clinic**: The Core_Clinic stamped on a customer's profile (`customer_profiles.clinic_id`), assigned from the customer's primary address pincode by the core-clinic-architecture feature.
- **Assisted_Order_Page**: The admin page "Place Shop Order for Customer" at `/customers/assisted-order`, rendered by `AssistedOrderBuilder` and served by `assistedOrderActions`.
- **Shop_Orders_Page**: The admin page listing shop orders at `/customers/shop-orders` ("See orders").
- **Access_Level**: The value of `users.admin_access_level`, one of `inventory`, `operations`, `inventory_operations`, or `dietitian`.
- **Operations_Group**: A configurable operations capability group in `OPERATIONS_GROUPS`: `customers`, `subscriptions`, `riders`, `operations`, `franchises`, `shop_products`. Each configured group carries a Permission_Level of `manage` or `view` in `users.admin_operations_access`.
- **Permission_Level**: `manage` (read and write) or `view` (read only).
- **Clinic_Scope_Assignment**: The Core_Clinic assigned to an Admin, stored as `users.admin_clinic_id`.
- **Clinic_Scoped_Admin**: An Admin whose Access_Level is `operations` and whose Clinic_Scope_Assignment is set.
- **Unscoped_Operations_Admin**: An Admin who holds the `shop_products` Operations_Group and whose Clinic_Scope_Assignment is `NULL`.
- **Inventory_Admin**: An Admin whose Access_Level is `inventory` or `inventory_operations`.
- **Master_Admin**: A super-admin user with role code `MASTER_ADMIN` operating the master portal.
- **User_Management_Form**: The master-portal admin create/edit form rendered by `UserManagement` at `/user-management`, persisted by `createAdminUser` and `updateAdminUser`.
- **Clinic_Access_Checkbox**: The new "This user has clinic level access" checkbox in the User_Management_Form.
- **Clinic_Scoped_Groups**: The four Operations_Groups offered when the Clinic_Access_Checkbox is checked: `customers`, `subscriptions`, `riders`, `shop_products`.
- **Franchise_Stock_Transfer**: A core-to-franchise transfer row in `public.franchise_stock_transfers` with a `state` in `franchise_transfer_state` (`DISPATCHED`, `ACCEPTED`, `RECEIVED`, `REJECTED`) and per-batch lines in `franchise_stock_transfer_lines`.
- **Franchise_Warehouse_Inventory**: The franchise-portal warehouse at `/inventory`, backed by `franchise_inventory_lots` with movements recorded in `franchise_inventory_ledger`.
- **Migration_Target_Clinic**: The Core_Clinic with the earliest `clinics.created_at` value, used as the single destination for pre-existing shared shop stock during data migration.

## Requirements

### Requirement 1: Per-Clinic Shop Stock Record

**User Story:** As an Inventory Admin, I want each Core Clinic to hold its own stock figure and its own visibility flag for every Shop Product, so that stock and sales can be attributed to a specific clinic.

#### Acceptance Criteria

1. THE System SHALL persist a Clinic_Shop_Stock record with a NOT NULL `clinic_id` referencing an existing Core_Clinic row, a NOT NULL `product_id` referencing an existing Shop_Product row, a NOT NULL integer `stock_quantity` defaulting to 0, and a NOT NULL boolean `is_visible` defaulting to `true`.
2. IF a write attempts to create a Clinic_Shop_Stock record whose `clinic_id` or `product_id` references a row that does not exist, THEN THE System SHALL reject the write, create no record, and return an error message identifying the reference that was not found.
3. THE System SHALL enforce a database-level unique constraint on the pair (`clinic_id`, `product_id`) in Clinic_Shop_Stock such that one Core_Clinic holds at most one record per Shop_Product.
4. IF a write attempts to create a Clinic_Shop_Stock record for a (`clinic_id`, `product_id`) pair that already holds a record, THEN THE System SHALL reject the write, leave the existing record's `stock_quantity` and `is_visible` values unchanged, create no additional record, and return an error message indicating that the Core_Clinic already holds a record for that Shop_Product.
5. THE System SHALL enforce a database-level constraint that `stock_quantity` in every Clinic_Shop_Stock record is an integer greater than or equal to 0 and less than or equal to Stock_Quantity_Maximum.
6. IF a write attempts to set a Clinic_Shop_Stock `stock_quantity` to a value below 0, THEN THE System SHALL reject the write, leave the stored `stock_quantity` unchanged, and return an error message indicating that stock cannot go below 0.
7. IF a write attempts to set a Clinic_Shop_Stock `stock_quantity` to a value above Stock_Quantity_Maximum, THEN THE System SHALL reject the write, leave the stored `stock_quantity` unchanged, and return an error message stating the maximum stock quantity of 1,000,000.
8. IF a write supplies a Clinic_Shop_Stock `stock_quantity` value that is not an integer, THEN THE System SHALL reject the write, leave the stored `stock_quantity` unchanged, and return an error message indicating that the stock quantity must be a whole number.
9. IF a write attempts to create a Clinic_Shop_Stock record whose `clinic_id` references a Clinic with a non-`NULL` `franchise_id`, THEN THE System SHALL reject the write, create no record, and return an error message indicating that Clinic_Shop_Stock applies to Core_Clinics only.
10. WHEN a Shop_Product is created, THE System SHALL create, within the same database transaction as the Shop_Product insert, one Clinic_Shop_Stock record for every Core_Clinic with `stock_quantity` set to 0 and `is_visible` set to `true`.
11. WHEN a Core_Clinic is created, THE System SHALL create, within the same database transaction as the Core_Clinic insert, one Clinic_Shop_Stock record for that Core_Clinic for every Shop_Product whose `deleted_at` is `NULL`, with `stock_quantity` set to 0 and `is_visible` set to `true`.
12. IF any Clinic_Shop_Stock record creation required by criterion 10 or criterion 11 fails, THEN THE System SHALL roll back that database transaction, leaving no new Clinic_Shop_Stock record, no new Shop_Product row, and no new Core_Clinic row, and SHALL return an error message indicating that the record set could not be created.
13. WHERE no Clinic_Shop_Stock record exists for a (Core_Clinic, Shop_Product) pair, THE System SHALL read the Effective_Clinic_Stock of that pair as 0 and the Effective_Clinic_Visibility of that pair as hidden.
14. WHEN a Shop_Product's `deleted_at` value is set, THE System SHALL retain every Clinic_Shop_Stock record and every Clinic_Shop_Ledger entry that references that Shop_Product, with their stored values unchanged.
15. THE System SHALL derive every Core_Clinic shop stock display, shop availability decision, and shop sale deduction defined by this feature from the Effective_Clinic_Stock of the Core_Clinic concerned, and SHALL retain the existing `products.stock_quantity` column as a pre-migration historical value.

### Requirement 2: Clinic Shop Ledger

**User Story:** As an Inventory Admin, I want every clinic shop stock movement recorded in an append-only ledger, so that I can audit how much stock each clinic received and sold.

#### Acceptance Criteria

1. THE System SHALL persist a Clinic_Shop_Ledger entry with a NOT NULL `clinic_id` referencing an existing Core_Clinic row, a NOT NULL `product_id` referencing an existing Shop_Product row, a NOT NULL direction of `IN` or `OUT`, a NOT NULL integer quantity, a NOT NULL Movement_Source, a NOT NULL acting user identifier referencing an existing user row, a nullable Shop_Order reference, a nullable warehouse transaction reference, and a NOT NULL occurrence timestamp recorded in UTC and defaulting to the transaction commit time.
2. THE System SHALL enforce a database-level constraint that the quantity on every Clinic_Shop_Ledger entry is an integer greater than 0 and less than or equal to Stock_Quantity_Maximum.
3. IF a write supplies a Clinic_Shop_Ledger quantity that is not an integer between 1 and Stock_Quantity_Maximum inclusive, THEN THE System SHALL reject the write, create no entry, leave the related Clinic_Shop_Stock `stock_quantity` unchanged, and return an error message indicating that the movement quantity must be a whole number between 1 and 1,000,000.
4. IF a write supplies a Clinic_Shop_Ledger `clinic_id`, `product_id`, acting user identifier, Shop_Order reference, or warehouse transaction reference that references a row that does not exist, THEN THE System SHALL reject the write, create no entry, and return an error message identifying the reference that was not found.
5. WHEN the System changes a Clinic_Shop_Stock `stock_quantity`, THE System SHALL record exactly one Clinic_Shop_Ledger entry for that change within the same database transaction, with direction `IN` for an increase and `OUT` for a decrease, and with a quantity equal to the absolute size of the change.
6. IF the Clinic_Shop_Ledger entry required by criterion 5 cannot be recorded, THEN THE System SHALL roll back that database transaction, leave the Clinic_Shop_Stock `stock_quantity` at its value before the change, record no Clinic_Shop_Ledger entry, and return an error message indicating that the stock movement could not be recorded.
7. THE System SHALL maintain, for every (`clinic_id`, `product_id`) pair, the equality: the Clinic_Shop_Stock `stock_quantity` equals the sum of the quantities of all `IN` Clinic_Shop_Ledger entries for that pair minus the sum of the quantities of all `OUT` Clinic_Shop_Ledger entries for that pair.
8. THE System SHALL record a Movement_Source of `WAREHOUSE_STOCK_IN` on every `IN` entry produced by a Stock_In, `CUSTOMER_APP_SALE` on every `OUT` entry produced by a customer-application purchase, `ASSISTED_SALE` on every `OUT` entry produced by an Assisted_Order_Page order for a selected customer, `WALKIN_SALE` on every `OUT` entry produced by a walk-in counter sale, and `MIGRATION` on every `IN` entry produced by the data migration in Requirement 20.
9. IF a request attempts to update or delete an existing Clinic_Shop_Ledger entry, THEN THE System SHALL reject the request, leave the stored entry unchanged, and return an error message indicating that ledger entries are immutable.
10. WHERE a Clinic_Shop_Ledger entry has a Movement_Source of `CUSTOMER_APP_SALE`, `ASSISTED_SALE`, or `WALKIN_SALE`, THE System SHALL record the identifier of the existing Shop_Order that caused the movement on that entry.
11. WHERE a Clinic_Shop_Ledger entry has a Movement_Source of `WAREHOUSE_STOCK_IN`, THE System SHALL record the identifier of the existing warehouse `inventory_transactions` entry that recorded the corresponding warehouse decrement on that entry.
12. WHERE a Clinic_Shop_Ledger entry has a Movement_Source of `MIGRATION`, THE System SHALL leave the Shop_Order reference and the warehouse transaction reference on that entry unset.

### Requirement 3: Master Catalog Product Linking

**User Story:** As an Inventory Admin, I want to link a Shop Product to a Master Catalog Product, so that the shop listing can carry its own name, images and marketing copy while drawing stock from the warehouse item it really is.

#### Acceptance Criteria

1. THE System SHALL persist a Product_Link on each Shop_Product as a nullable reference to exactly one Master_Catalog_Product, and SHALL require that a set Product_Link references an existing `inventory_products` row.
2. WHEN an Inventory_Admin creates or edits a Shop_Product on the Warehouse_Shop_Products_Page, THE System SHALL offer a Master_Catalog_Product selector listing every Master_Catalog_Product by name and base unit of measure, together with an option to leave the Shop_Product unlinked.
3. WHEN the Master_Catalog_Product selector renders while no Master_Catalog_Product exists, THE Warehouse_Shop_Products_Page SHALL display an empty-state message indicating that no Master Catalog Products are available and SHALL offer only the unlinked option.
4. IF the Master_Catalog_Product list cannot be loaded, THEN THE Warehouse_Shop_Products_Page SHALL display an error message indicating that the Master Catalog Product list could not be loaded, offer only the unlinked option, and leave any existing Product_Link unchanged.
5. THE System SHALL allow a Linked_Shop_Product to carry a display name, image set, short description, and description that differ from the linked Master_Catalog_Product's name and image.
6. THE System SHALL apply Base_Unit_Equivalence, treating a Stock_In quantity of N shop items as N base units of the linked Master_Catalog_Product.
7. WHEN an Inventory_Admin submits a Product_Link referencing a Master_Catalog_Product identifier that exists, THE System SHALL persist the Product_Link and report that the save succeeded.
8. IF an Inventory_Admin submits a Product_Link referencing a Master_Catalog_Product identifier that does not exist, THEN THE System SHALL reject the save, leave any existing Shop_Product record unchanged, and return an error message indicating that the selected Master_Catalog_Product was not found.
9. THE System SHALL allow more than one Shop_Product to reference the same Master_Catalog_Product.
10. THE System SHALL compute the Aggregate_Stock of a Shop_Product as the sum of the Effective_Clinic_Stock of that Shop_Product across every Core_Clinic.
11. IF an Inventory_Admin changes the Product_Link of a Shop_Product whose Aggregate_Stock is greater than 0, THEN THE System SHALL reject the change, leave the existing Product_Link unchanged, and return an error message indicating that the Product_Link can be changed only while every clinic holds 0 stock of that Shop_Product.
12. THE System SHALL evaluate the Aggregate_Stock restriction of criterion 11 and the Inventory_Admin authorization of the Product_Link change in the server action that persists the Product_Link, in addition to any user-interface gating.

### Requirement 4: Add New Product Creates a Catalogue Entry Without Stock

**User Story:** As an Inventory Admin, I want a newly added Shop Product to appear in every shop products section with zero stock, so that stock is only ever created by an explicit Stock In.

#### Acceptance Criteria

1. WHEN an Inventory_Admin adds a Shop_Product from the Warehouse_Shop_Products_Page, THE System SHALL make that Shop_Product appear in the product list of the Warehouse_Shop_Products_Page, of the Operations_Shop_Products_Page for every Core_Clinic, and of the Franchise_Shop_Products_Page for every active Franchise.
2. THE Shop_Product create form on the Warehouse_Shop_Products_Page SHALL NOT present a stock quantity input, and THE System SHALL set the created Shop_Product's Effective_Clinic_Stock to 0 for every Core_Clinic.
3. WHEN an Inventory_Admin submits the Shop_Product create form with a name, an SKU, and an original price, THE System SHALL persist the Shop_Product and report that the save succeeded.
4. IF an Inventory_Admin submits the Shop_Product create or edit form without a name, without an SKU, or without an original price, THEN THE System SHALL reject the submission, persist no change, and indicate each missing required field.
5. IF an Inventory_Admin submits the Shop_Product create or edit form with an `original_price` or a `sale_price` that is not a number greater than 0 with at most two decimal places, THEN THE System SHALL reject the submission, persist no change, and return an error message identifying each price field outside the accepted range.
6. THE System SHALL retain the existing Shop_Product edit, delete, and Franchises actions on the Warehouse_Shop_Products_Page while the Destination_Selector is in All_Clinics_Mode.
7. IF an Admin whose Access_Level is `operations` submits a Shop_Product create, edit, or delete request, THEN THE System SHALL reject the request, persist no change, and return an error message indicating that Shop_Product catalogue changes require warehouse inventory access.
8. THE System SHALL enforce the authorization of criterion 7 in the server actions that create, edit, and delete a Shop_Product, in addition to any user-interface gating.
9. WHEN a shop products list renders while no Shop_Product whose `deleted_at` is `NULL` exists, THE Warehouse_Shop_Products_Page, the Operations_Shop_Products_Page, and the Franchise_Shop_Products_Page SHALL each display an empty-state message indicating that no shop products exist.
10. IF the Shop_Product list cannot be loaded, THEN the requesting page SHALL display an error message indicating that the shop product list could not be loaded and SHALL display no Shop_Product rows.

### Requirement 5: Destination Selector on the Warehouse Shop Products Page

**User Story:** As an Inventory Admin, I want to switch the warehouse Shop Products page between all clinics, a single clinic, and a single franchise, so that I can review per-destination stock and visibility from one page.

#### Acceptance Criteria

1. THE Warehouse_Shop_Products_Page SHALL present a Destination_Selector containing an `All Clinics` option, one option for every Core_Clinic, and one option for every active Franchise.
2. WHEN an Inventory_Admin opens the Warehouse_Shop_Products_Page without choosing a destination, THE Warehouse_Shop_Products_Page SHALL default the Destination_Selector to `All Clinics`.
3. WHILE the Destination_Selector is in All_Clinics_Mode, THE Warehouse_Shop_Products_Page SHALL display, for every Shop_Product, the Aggregate_Stock and the Global_Visibility state.
4. WHILE the Destination_Selector is in All_Clinics_Mode, THE Warehouse_Shop_Products_Page SHALL NOT present a stock entry input or a Stock_In action for any Shop_Product.
5. WHILE the Destination_Selector is in Clinic_Mode, THE Warehouse_Shop_Products_Page SHALL display, for every Shop_Product, the selected Core_Clinic's Effective_Clinic_Stock and Effective_Clinic_Visibility state.
6. WHILE the Destination_Selector is in Clinic_Mode and the selected Core_Clinic holds no Clinic_Shop_Stock record for a Shop_Product, THE Warehouse_Shop_Products_Page SHALL display that Shop_Product with a stock figure of 0 and a visibility state of hidden.
7. WHILE the Destination_Selector is in Clinic_Mode, THE Warehouse_Shop_Products_Page SHALL present exactly two actions per Shop_Product row: a Clinic_Visibility toggle and a Stock_In action.
8. WHILE the Destination_Selector is in Clinic_Mode, THE Warehouse_Shop_Products_Page SHALL NOT present the Add New Product action, the Edit action, the Delete action, or the Franchises action.
9. WHEN an Inventory_Admin changes the Destination_Selector value, THE Warehouse_Shop_Products_Page SHALL display the stock and visibility values of the newly selected destination for every Shop_Product without requiring a manual page refresh.
10. WHEN the Destination_Selector renders while no Core_Clinic and no active Franchise exists, THE Warehouse_Shop_Products_Page SHALL present the `All Clinics` option only and display an empty-state message indicating that no destinations are configured.
11. IF the Destination_Selector value references a Core_Clinic or Franchise identifier that does not exist, THEN THE Warehouse_Shop_Products_Page SHALL fall back to All_Clinics_Mode and display a message indicating that the selected destination is unavailable.
12. IF the Destination_Selector option list cannot be loaded, THEN THE Warehouse_Shop_Products_Page SHALL fall back to All_Clinics_Mode and display an error message indicating that the destination list could not be loaded.
13. IF the per-destination stock and visibility values cannot be loaded for the selected destination, THEN THE Warehouse_Shop_Products_Page SHALL display an error message indicating that the destination data could not be loaded and SHALL display no Shop_Product rows.
14. THE System SHALL resolve the Destination_Selector options and the per-destination stock and visibility values only for an Inventory_Admin, enforcing that check in the server-side data path in addition to any user-interface gating.

### Requirement 6: Global and Per-Clinic Visibility

**User Story:** As an Inventory Admin, I want one switch that hides a product everywhere and a per-clinic switch that hides it for one clinic, so that I can control shop exposure at both levels.

#### Acceptance Criteria

1. WHEN an Inventory_Admin sets Global_Visibility to hidden while the Destination_Selector is in All_Clinics_Mode, THE System SHALL exclude that Shop_Product from the customer-facing shop of every Core_Clinic regardless of each Core_Clinic's Effective_Clinic_Visibility value.
2. WHEN an Inventory_Admin sets Clinic_Visibility to hidden for a Shop_Product while the Destination_Selector is in Clinic_Mode, THE System SHALL exclude that Shop_Product from the customer-facing shop of the selected Core_Clinic only, and SHALL leave the Clinic_Visibility value of every other Core_Clinic unchanged.
3. THE System SHALL expose a Shop_Product in a Core_Clinic's customer-facing shop only while that Shop_Product's `deleted_at` is `NULL`, its Global_Visibility is shown, that Core_Clinic's Effective_Clinic_Visibility is shown, and that Core_Clinic's Effective_Clinic_Stock is greater than 0.
4. WHEN an Inventory_Admin sets Clinic_Visibility for a Shop_Product while the selected Core_Clinic holds no Clinic_Shop_Stock record for that Shop_Product, THE System SHALL create that Clinic_Shop_Stock record with `stock_quantity` set to 0 and `is_visible` set to the submitted value.
5. WHEN an Inventory_Admin toggles Global_Visibility or Clinic_Visibility twice in succession without any intervening change, THE System SHALL leave the stored visibility value equal to its value before the first toggle.
6. WHEN two visibility changes for the same Clinic_Shop_Stock record are submitted concurrently, THE System SHALL apply the changes serially and leave the stored `is_visible` value equal to the value carried by the later-committed change.
7. IF a visibility toggle fails, THEN THE System SHALL leave the stored visibility value unchanged, restore the toggle control to its previous displayed state, and display an error message indicating that the visibility update failed.
8. THE System SHALL continue to use the existing `adminToggleProductVisibility` server action for Global_Visibility changes.
9. THE System SHALL enforce Inventory_Admin authorization for every Global_Visibility change and every Clinic_Visibility change in the server action that persists the visibility value, in addition to any user-interface gating.

### Requirement 7: Stock In From Warehouse to a Clinic

**User Story:** As an Inventory Admin, I want to move a chosen quantity of a product from warehouse stock into a specific clinic's shop stock, so that the clinic can sell it and the warehouse figure stays accurate.

#### Acceptance Criteria

1. WHILE the Destination_Selector is in Clinic_Mode, WHEN an Inventory_Admin activates the Stock_In action for a Shop_Product and enters a quantity, THE System SHALL add that Shop_Product and quantity to the Shop_Products_Cart as a pending Stock_In line for the selected Core_Clinic.
2. THE Shop_Products_Cart SHALL present exactly one submission option, labelled outbound, and SHALL NOT present an inbound option.
3. THE System SHALL allow an Inventory_Admin to hold pending Stock_In lines for more than one Shop_Product in the Shop_Products_Cart before submission.
4. WHEN an Inventory_Admin adds a Stock_In line for a Shop_Product that already holds a pending line for the same destination Core_Clinic, THE System SHALL keep exactly one pending line for that (destination Core_Clinic, Shop_Product) pair and SHALL set that line's quantity to the newly entered quantity.
5. WHEN the Shop_Products_Cart holds no pending Stock_In line, THE Shop_Products_Cart SHALL display an empty-state message indicating that no stock-in lines are pending and SHALL present the outbound submission option as unavailable.
6. WHEN an Inventory_Admin submits the Shop_Products_Cart and every pending line's quantity is less than or equal to the available warehouse stock of that line's linked Master_Catalog_Product, THE System SHALL, within a single database transaction, for every pending line, increase the destination Core_Clinic's Clinic_Shop_Stock `stock_quantity` by the line quantity, decrease the linked Master_Catalog_Product's warehouse stock by the same line quantity, record one Clinic_Shop_Ledger `IN` entry, and record one `inventory_transactions` entry of type `OUT`, and SHALL clear the submitted lines from the Shop_Products_Cart after that transaction commits.
7. WHERE the destination Core_Clinic holds no Clinic_Shop_Stock record for a pending line's Shop_Product, THE System SHALL create that Clinic_Shop_Stock record with `stock_quantity` set to 0 and `is_visible` set to `true` within the same database transaction before applying the increase.
8. THE System SHALL deplete warehouse stock for a Stock_In from `inventory_lots` oldest-lot-first, consistent with the existing FIFO depletion used by Dispatch_Stock.
9. THE System SHALL write the Stock_In_Reason_Prefix followed by the destination Core_Clinic identifier into the `reason` field of every `inventory_transactions` entry it records for a Stock_In.
10. IF any write within a Shop_Products_Cart submission fails, THEN THE System SHALL roll back the entire database transaction, leave every Clinic_Shop_Stock record, every `inventory_lots` quantity, every Clinic_Shop_Ledger entry, and every `inventory_transactions` entry unchanged, retain every pending line in the Shop_Products_Cart, and return an error message indicating that the stock-in submission failed.
11. THE System SHALL serialise concurrent writes to the same Clinic_Shop_Stock record, such that two concurrent Stock_In submissions of quantities A and B for the same Core_Clinic and Shop_Product leave that record's `stock_quantity` equal to its starting value plus A plus B.
12. IF an Inventory_Admin submits the Shop_Products_Cart while any pending line's quantity exceeds the available warehouse stock of that line's linked Master_Catalog_Product, THEN THE System SHALL reject the entire submission, leave every Clinic_Shop_Stock record and all warehouse stock unchanged, retain all pending lines in the Shop_Products_Cart, and return an error message identifying each Shop_Product whose quantity exceeds available warehouse stock.
13. IF an Inventory_Admin enters a Stock_In quantity that is not an integer between 1 and Stock_Quantity_Maximum inclusive, THEN THE System SHALL reject the entry, add no line to the Shop_Products_Cart, and display an error message indicating that the quantity must be a whole number between 1 and 1,000,000.
14. IF an Inventory_Admin submits the Shop_Products_Cart while any pending line would raise the destination Core_Clinic's Effective_Clinic_Stock above Stock_Quantity_Maximum, THEN THE System SHALL reject the entire submission, leave every Clinic_Shop_Stock record and all warehouse stock unchanged, retain all pending lines in the Shop_Products_Cart, and return an error message stating the maximum stock quantity of 1,000,000.
15. IF an Inventory_Admin activates the Stock_In action for an Unlinked_Shop_Product, THEN THE System SHALL reject the action, add no line to the Shop_Products_Cart, and display an error message indicating that the Shop_Product must be linked to a Master_Catalog_Product before stock-in.
16. WHEN a Stock_In of quantity N completes for a Shop_Product linked to a Master_Catalog_Product that held warehouse stock S before the operation, THE System SHALL leave that Master_Catalog_Product holding warehouse stock equal to S minus N.

### Requirement 8: Direct Dispatch Does Not Create Clinic Shop Stock

**User Story:** As an Inventory Admin, I want the existing Dispatch Stock flow to stay a warehouse operation, so that clinic shop stock only ever changes through an explicit Stock In.

#### Acceptance Criteria

1. WHEN an Inventory_Admin dispatches Master_Catalog_Product stock to a Core_Clinic through the existing Dispatch_Stock flow, THE System SHALL leave every Clinic_Shop_Stock `stock_quantity` unchanged and record no Clinic_Shop_Ledger entry.
2. THE System SHALL create Clinic_Shop_Stock increases only through the Stock_In operation defined in Requirement 7 and the data migration defined in Requirement 20.
3. IF a request attempts to increase a Clinic_Shop_Stock `stock_quantity` through an operation other than the Stock_In defined in Requirement 7 or the data migration defined in Requirement 20, THEN THE System SHALL reject the request, leave the stored `stock_quantity` unchanged, record no Clinic_Shop_Ledger entry, and return an error message indicating that clinic shop stock increases only through stock-in.
4. WHEN an Inventory_Admin dispatches Master_Catalog_Product stock to a Core_Clinic through the existing Dispatch_Stock flow, THE System SHALL write the existing `clinic:` prefix into the `reason` field of the recorded `inventory_transactions` entry, so that Dispatch_Stock entries are distinguishable from entries carrying the Stock_In_Reason_Prefix.
5. THE System SHALL preserve the existing outcomes, accepted inputs, destination options, and recorded `inventory_transactions` entries of the Dispatch_Stock flow.

### Requirement 9: Clinic Selection and Ledger on the Operations Shop Products Page

**User Story:** As an Operations Admin, I want to pick a clinic on the Shop Products page and see that clinic's available stock alongside its stock in and out history, so that I can hold each clinic accountable for its stock and sales.

#### Acceptance Criteria

1. THE Operations_Shop_Products_Page SHALL present a clinic dropdown listing every Core_Clinic.
2. WHEN an Unscoped_Operations_Admin opens the Operations_Shop_Products_Page without selecting a Core_Clinic, THE Operations_Shop_Products_Page SHALL select no Core_Clinic, display a message prompting the Admin to select a clinic, and display no stock figures and no ledger entries.
3. WHEN the clinic dropdown renders while no Core_Clinic exists, THE Operations_Shop_Products_Page SHALL display an empty-state message indicating that no clinics are configured and SHALL display no stock figures and no ledger entries.
4. WHEN an Unscoped_Operations_Admin selects a Core_Clinic in the clinic dropdown, THE Operations_Shop_Products_Page SHALL display, for every Shop_Product, that Core_Clinic's Effective_Clinic_Stock and Effective_Clinic_Visibility state.
5. WHILE a Core_Clinic is selected and that Core_Clinic holds no Clinic_Shop_Stock record for a Shop_Product, THE Operations_Shop_Products_Page SHALL display that Shop_Product with a stock figure of 0 and a visibility state of hidden.
6. WHEN a Core_Clinic is selected on the Operations_Shop_Products_Page, THE Operations_Shop_Products_Page SHALL display a clinic ledger view containing every Clinic_Shop_Ledger entry for that Core_Clinic, with each entry showing its occurrence timestamp, Shop_Product name, direction, quantity, and Movement_Source.
7. THE clinic ledger view SHALL order Clinic_Shop_Ledger entries by occurrence timestamp descending, breaking ties by the ledger entry identifier descending.
8. THE clinic ledger view SHALL offer separate filters for `IN` entries and `OUT` entries, matching the incoming and outgoing filter behaviour of the warehouse Audit_Ledger.
9. WHEN a Core_Clinic is selected on the Operations_Shop_Products_Page and that Core_Clinic has no Clinic_Shop_Ledger entries, THE clinic ledger view SHALL display an empty-state message indicating that the clinic has no recorded stock movements.
10. WHEN an applied `IN` or `OUT` filter matches no Clinic_Shop_Ledger entry for the selected Core_Clinic, THE clinic ledger view SHALL display an empty-state message indicating that no movements match the applied filter.
11. THE Operations_Shop_Products_Page SHALL NOT present the Add New Product action, the Edit action, the Delete action, or the Franchises action, retaining the view-only behaviour established by the shop-product-access-separation feature.
12. IF the clinic ledger data cannot be loaded, THEN THE Operations_Shop_Products_Page SHALL display an error message indicating that the ledger could not be loaded and SHALL display no ledger entries.
13. IF the per-clinic stock and visibility data cannot be loaded, THEN THE Operations_Shop_Products_Page SHALL display an error message indicating that the clinic stock data could not be loaded and SHALL display no Shop_Product rows.
14. THE System SHALL resolve the clinic dropdown options and the per-clinic stock and ledger data in the server-side data path, restricting both to the Core_Clinics the requesting Admin is permitted to read, in addition to any user-interface gating.

### Requirement 10: Clinic Attribution and Stock Deduction on Shop Orders

**User Story:** As an Operations Admin, I want every shop order stamped with the clinic that fulfilled it and that clinic's stock reduced, so that per-clinic sales figures are accurate across all three selling channels.

#### Acceptance Criteria

1. THE System SHALL persist an Order_Clinic_Stamp on every Shop_Order as a nullable reference to a Core_Clinic, recorded at Shop_Order creation time, and SHALL require that a set Order_Clinic_Stamp references an existing Core_Clinic row.
2. WHEN a meal customer completes a shop purchase in the customer application, THE System SHALL set the Order_Clinic_Stamp to that customer's Aligned_Clinic and decrease that Aligned_Clinic's Clinic_Shop_Stock `stock_quantity` by the ordered quantity for every line item.
3. WHEN a Clinic_Scoped_Admin places a Shop_Order on the Assisted_Order_Page for a selected customer, THE System SHALL set the Order_Clinic_Stamp to that Admin's Clinic_Scope_Assignment and decrease that Core_Clinic's Clinic_Shop_Stock `stock_quantity` by the ordered quantity for every line item, irrespective of the selected customer's Aligned_Clinic.
4. WHEN a Clinic_Scoped_Admin records a walk-in counter sale on the Assisted_Order_Page, THE System SHALL set the Order_Clinic_Stamp to that Admin's Clinic_Scope_Assignment and decrease that Core_Clinic's Clinic_Shop_Stock `stock_quantity` by the sold quantity for every line item.
5. WHEN an Unscoped_Operations_Admin places a Shop_Order or records a walk-in counter sale on the Assisted_Order_Page, THE System SHALL require the Admin to select a Core_Clinic for fulfilment, set the Order_Clinic_Stamp to the selected Core_Clinic, and decrease that Core_Clinic's Clinic_Shop_Stock `stock_quantity` by the ordered quantity for every line item.
6. IF an Unscoped_Operations_Admin submits a Shop_Order or a walk-in counter sale on the Assisted_Order_Page with no Core_Clinic selected for fulfilment, THEN THE System SHALL reject the submission, create no Shop_Order and no line item, leave every Clinic_Shop_Stock record unchanged, and return an error message indicating that a fulfilling clinic must be selected.
7. IF a Shop_Order line item quantity is not an integer between 1 and Stock_Quantity_Maximum inclusive, THEN THE System SHALL reject the submission, create no Shop_Order and no line item, leave every Clinic_Shop_Stock record unchanged, and return an error message indicating that each ordered quantity must be a whole number between 1 and 1,000,000.
8. WHEN the System decreases a Clinic_Shop_Stock `stock_quantity` for a Shop_Order line item, THE System SHALL record one Clinic_Shop_Ledger `OUT` entry referencing that Shop_Order within the same database transaction as the Shop_Order creation.
9. IF any write within a Shop_Order submission fails, THEN THE System SHALL roll back the entire database transaction, create no Shop_Order and no line item, leave every Clinic_Shop_Stock record unchanged, record no Clinic_Shop_Ledger entry, and return an error message indicating that the order could not be completed.
10. THE System SHALL serialise concurrent writes to one Clinic_Shop_Stock record arising from customer-application purchases, Assisted_Order_Page orders, walk-in counter sales, and Stock_In submissions, applying those writes one at a time so that the stored `stock_quantity` equals its starting value plus every applied `IN` quantity minus every applied `OUT` quantity.
11. WHERE the fulfilling Core_Clinic holds no Clinic_Shop_Stock record for an ordered Shop_Product, THE System SHALL treat the available quantity as an Effective_Clinic_Stock of 0 and SHALL reject the Shop_Order as defined in Requirement 11.
12. THE System SHALL treat the Order_Clinic_Stamp as immutable after Shop_Order creation, rejecting any request to change it and returning an error message indicating that the clinic stamp cannot be changed.
13. IF a meal customer whose Aligned_Clinic is unset opens the customer-application shop, THEN THE System SHALL present zero Shop_Products and display a message indicating that shop purchases are unavailable for that customer's service area.

### Requirement 11: Overselling Prevention

**User Story:** As an Operations Admin, I want a sale rejected when the fulfilling clinic does not hold enough stock, so that a clinic can never sell stock it does not have.

#### Acceptance Criteria

1. IF a Shop_Order submission requests a quantity of a Shop_Product greater than the fulfilling Core_Clinic's Effective_Clinic_Stock for that Shop_Product, THEN THE System SHALL reject the entire Shop_Order, create no Shop_Order or line item, leave every Clinic_Shop_Stock record unchanged, record no Clinic_Shop_Ledger entry, and return an error message identifying each Shop_Product with insufficient clinic stock and the quantity currently available.
2. THE System SHALL evaluate available clinic stock and decrease Clinic_Shop_Stock within a single database transaction, such that two concurrent Shop_Order submissions for the same Core_Clinic and Shop_Product cannot together reduce that Clinic_Shop_Stock `stock_quantity` below 0.
3. THE System SHALL apply criteria 1 and 2 identically to customer-application purchases, Assisted_Order_Page orders for a selected customer, and walk-in counter sales.
4. WHEN a Shop_Order is created successfully, THE System SHALL leave the fulfilling Core_Clinic's Clinic_Shop_Stock `stock_quantity` for every ordered Shop_Product greater than or equal to 0.
5. IF a customer-application checkout requests a Shop_Product whose Effective_Clinic_Stock for the customer's Aligned_Clinic is 0, THEN THE System SHALL reject the checkout, create no Shop_Order, and return an error message indicating that the Shop_Product is out of stock.
6. THE System SHALL evaluate the available-stock check of criterion 1 in the server action that creates the Shop_Order, in addition to any user-interface gating.

### Requirement 12: Shop Orders List Scoped by Clinic

**User Story:** As an Operations Admin, I want the shop orders list filtered by clinic, so that a clinic-scoped admin sees only that clinic's sales while a full-access admin can review any clinic.

#### Acceptance Criteria

1. WHEN a Clinic_Scoped_Admin opens the Shop_Orders_Page, THE System SHALL display only the Shop_Orders whose Order_Clinic_Stamp equals that Admin's Clinic_Scope_Assignment, including Shop_Orders created from the customer application.
2. WHEN an Unscoped_Operations_Admin opens the Shop_Orders_Page, THE Shop_Orders_Page SHALL present a Core_Clinic selector and display the Shop_Orders whose Order_Clinic_Stamp equals the selected Core_Clinic.
3. WHEN an Unscoped_Operations_Admin opens the Shop_Orders_Page without selecting a Core_Clinic, THE Shop_Orders_Page SHALL apply no clinic filter and display the Shop_Orders of every Core_Clinic.
4. THE Shop_Orders_Page SHALL NOT present a Core_Clinic selector to a Clinic_Scoped_Admin.
5. THE Shop_Orders_Page SHALL display, for every listed Shop_Order, the buyer identity, the order total, the order status, and the Order_Clinic_Stamp clinic name.
6. WHERE a Shop_Order has an unset Order_Clinic_Stamp, THE Shop_Orders_Page SHALL exclude that Shop_Order from every clinic-filtered result and SHALL include it in an `Unassigned` grouping available to an Unscoped_Operations_Admin.
7. WHEN no Shop_Order matches the applied clinic filter, THE Shop_Orders_Page SHALL display an empty-state message indicating that no shop orders exist for the applied filter.
8. IF the Shop_Orders data cannot be loaded, THEN THE Shop_Orders_Page SHALL display an error message indicating that the shop orders could not be loaded and SHALL display no Shop_Order rows.
9. THE System SHALL apply the Clinic_Scoped_Admin filter of criterion 1 in the server-side data path, rejecting a Shop_Orders_Page request that names a Core_Clinic other than that Admin's Clinic_Scope_Assignment and returning an error message indicating that the clinic is outside the Admin's assigned scope, in addition to any user-interface gating.

### Requirement 13: Clinic Level Access Configuration in the Master Portal

**User Story:** As a Master Admin, I want to mark an admin as clinic level and pick that admin's clinic, so that the admin's Shop Products access is confined to one clinic.

#### Acceptance Criteria

1. THE System SHALL persist a Clinic_Scope_Assignment on each user as a nullable reference to a Core_Clinic, and SHALL require that a set Clinic_Scope_Assignment references an existing Clinic row whose `franchise_id` is `NULL`.
2. WHILE the Access_Level selected in the User_Management_Form is `operations`, THE User_Management_Form SHALL present the Clinic_Access_Checkbox labelled "This user has clinic level access".
3. WHILE the Access_Level selected in the User_Management_Form is `inventory`, `inventory_operations`, or `dietitian`, THE User_Management_Form SHALL NOT present the Clinic_Access_Checkbox.
4. WHEN a Master_Admin checks the Clinic_Access_Checkbox, THE User_Management_Form SHALL present a dropdown listing every Core_Clinic.
5. WHEN the Core_Clinic dropdown renders while no Core_Clinic exists, THE User_Management_Form SHALL display an empty-state message indicating that no clinics are available for assignment and SHALL offer no selectable Core_Clinic.
6. IF the Core_Clinic list cannot be loaded while the Clinic_Access_Checkbox is checked, THEN THE User_Management_Form SHALL display an error message indicating that the clinic list could not be loaded, offer no selectable Core_Clinic, and leave the stored Clinic_Scope_Assignment unchanged.
7. WHILE the Clinic_Access_Checkbox is checked and a Core_Clinic is selected in the dropdown, THE User_Management_Form SHALL present exactly the four Clinic_Scoped_Groups, each with a Permission_Level choice of `manage` or `view`.
8. WHILE the Clinic_Access_Checkbox is checked, THE User_Management_Form SHALL NOT present the `operations` Operations_Group or the `franchises` Operations_Group.
9. WHEN a Master_Admin submits the User_Management_Form with the Clinic_Access_Checkbox checked, a selected Core_Clinic, and at least one Clinic_Scoped_Group, THE System SHALL persist the Access_Level as `operations`, persist the selected Core_Clinic as the Clinic_Scope_Assignment, persist only the selected Clinic_Scoped_Groups with their Permission_Levels, all within a single database transaction, and report that the save succeeded.
10. IF any write within the submission described in criterion 9 fails, THEN THE System SHALL roll back that database transaction, leave the stored Access_Level, Clinic_Scope_Assignment, and Operations_Group configuration unchanged, and return an error message indicating that the user could not be saved.
11. IF a Master_Admin submits the User_Management_Form with the Clinic_Access_Checkbox checked and no Core_Clinic selected, THEN THE System SHALL reject the submission, persist no change to the user record, and display an error message indicating that a clinic must be selected.
12. IF a Master_Admin submits a Clinic_Scope_Assignment referencing a Clinic that does not exist or whose `franchise_id` is not `NULL`, THEN THE System SHALL reject the submission, persist no change to the user record, and return an error message indicating that the selected clinic is unavailable for clinic level access.
13. IF a write attempts to persist an `operations` or `franchises` Operations_Group for a user whose Clinic_Scope_Assignment is set, THEN THE System SHALL reject the write, leave the stored access configuration unchanged, and return an error message indicating that those groups are unavailable for clinic level access.
14. IF a write attempts to persist a Clinic_Scope_Assignment for a user whose Access_Level is not `operations`, THEN THE System SHALL reject the write, leave the stored user record unchanged, and return an error message indicating that clinic level access requires the `operations` Access_Level.
15. THE System SHALL enforce criteria 11 through 14 in `createAdminUser` and `updateAdminUser`, in addition to any user-interface gating.
16. WHEN a Master_Admin unchecks the Clinic_Access_Checkbox and submits the User_Management_Form, THE System SHALL set the Clinic_Scope_Assignment to unset and present the full set of Operations_Groups for selection.
17. WHEN a Master_Admin opens the User_Management_Form to edit a Clinic_Scoped_Admin, THE User_Management_Form SHALL display the Clinic_Access_Checkbox as checked, the dropdown set to that Admin's Clinic_Scope_Assignment, and each stored Clinic_Scoped_Group set to its stored Permission_Level.
18. WHEN a Master_Admin changes an existing Admin's Clinic_Scope_Assignment, THE System SHALL leave every previously created Shop_Order's Order_Clinic_Stamp unchanged.

### Requirement 14: Clinic Scope Applies to the Shop Products Module Only

**User Story:** As a clinic-scoped admin, I want full Core business access to customers, subscriptions and riders, so that only my Shop Products view is limited to my clinic.

#### Acceptance Criteria

1. WHEN a Clinic_Scoped_Admin holding the `customers` Operations_Group opens the customers workspace, THE System SHALL display every Core business customer, applying no filter based on the Admin's Clinic_Scope_Assignment.
2. WHEN a Clinic_Scoped_Admin holding the `subscriptions` Operations_Group opens the subscriptions workspace, THE System SHALL display every Core business subscription, applying no filter based on the Admin's Clinic_Scope_Assignment.
3. WHEN a Clinic_Scoped_Admin holding the `riders` Operations_Group opens the riders workspace, THE System SHALL display every Core business rider, applying no filter based on the Admin's Clinic_Scope_Assignment.
4. WHEN a Clinic_Scoped_Admin opens the Operations_Shop_Products_Page, THE System SHALL display, for every Shop_Product, the Effective_Clinic_Stock and Effective_Clinic_Visibility of that Admin's Clinic_Scope_Assignment, and SHALL display only the Clinic_Shop_Ledger entries of that Clinic_Scope_Assignment.
5. THE Operations_Shop_Products_Page SHALL fix the clinic dropdown to the Clinic_Scope_Assignment for a Clinic_Scoped_Admin and SHALL NOT offer any other Core_Clinic as a selectable value.
6. IF a Clinic_Scoped_Admin submits a request for Clinic_Shop_Stock or Clinic_Shop_Ledger data of a Core_Clinic other than that Admin's Clinic_Scope_Assignment, THEN THE System SHALL reject the request, return no data for the requested Core_Clinic, and return an error message indicating that the clinic is outside the Admin's assigned scope.
7. THE System SHALL enforce criterion 6 in the server-side data path that resolves Clinic_Shop_Stock and Clinic_Shop_Ledger reads, in addition to any user-interface gating.
8. IF a Clinic_Scoped_Admin's Clinic_Scope_Assignment references a Core_Clinic that no longer exists, THEN THE Operations_Shop_Products_Page SHALL display an error message indicating that the assigned clinic is unavailable and SHALL display no Clinic_Shop_Stock figures and no Clinic_Shop_Ledger entries.
9. THE System SHALL apply no Clinic_Scope_Assignment filter to warehouse pages under `/admin/inventory`.

### Requirement 15: Clinic-Scoped Assisted Order Page

**User Story:** As a clinic-scoped admin, I want the assisted order cart builder to offer only my clinic's stock while letting me sell to any Core customer, so that counter sales draw down the right clinic's inventory.

#### Acceptance Criteria

1. WHEN a Clinic_Scoped_Admin opens the Assisted_Order_Page, THE System SHALL present only the Shop_Products whose Effective_Clinic_Visibility is shown for that Admin's Clinic_Scope_Assignment and whose Effective_Clinic_Stock for that Core_Clinic is greater than 0.
2. WHEN a Clinic_Scoped_Admin opens the Assisted_Order_Page, THE System SHALL display, for every presented Shop_Product, the Effective_Clinic_Stock of that Admin's Clinic_Scope_Assignment.
3. WHEN no Shop_Product satisfies criterion 1 for a Clinic_Scoped_Admin's Clinic_Scope_Assignment, THE Assisted_Order_Page SHALL display an empty-state message indicating that no shop products are available at the Admin's clinic and SHALL present the cart submission option as unavailable.
4. IF the Shop_Product list for the Admin's Clinic_Scope_Assignment cannot be loaded, THEN THE Assisted_Order_Page SHALL display an error message indicating that the clinic product list could not be loaded and SHALL present no Shop_Product.
5. WHEN a Clinic_Scoped_Admin searches for a customer on the Assisted_Order_Page, THE System SHALL return every matching Core business customer, applying no filter based on the customer's Aligned_Clinic or the Admin's Clinic_Scope_Assignment.
6. WHEN a customer search on the Assisted_Order_Page matches no Core business customer, THE Assisted_Order_Page SHALL display an empty-state message indicating that no matching customer was found.
7. IF the customer search cannot be completed, THEN THE Assisted_Order_Page SHALL display an error message indicating that the customer search could not be completed and SHALL present no customer result.
8. WHEN a Clinic_Scoped_Admin activates the "See orders" control on the Assisted_Order_Page, THE System SHALL open the Shop_Orders_Page filtered to that Admin's Clinic_Scope_Assignment.
9. IF a Clinic_Scoped_Admin submits an Assisted_Order_Page cart containing a Shop_Product that is not presented for that Admin's Clinic_Scope_Assignment, THEN THE System SHALL reject the submission, create no Shop_Order, leave every Clinic_Shop_Stock record unchanged, and return an error message indicating that the Shop_Product is unavailable at the Admin's clinic.
10. IF a Clinic_Scoped_Admin submits an Assisted_Order_Page cart line whose quantity is not an integer between 1 and the Effective_Clinic_Stock of that Shop_Product for the Admin's Clinic_Scope_Assignment, THEN THE System SHALL reject the submission, create no Shop_Order, leave every Clinic_Shop_Stock record unchanged, and return an error message stating the quantity currently available.
11. THE System SHALL enforce criteria 9 and 10 in the server action that creates the Shop_Order, in addition to any user-interface gating.
12. THE System SHALL preserve the existing pricing, eligibility, delivery-date, and walk-in validation behaviour of the Assisted_Order_Page, changing only the presented Shop_Product set, the displayed stock figures, and the Order_Clinic_Stamp.

### Requirement 16: Stock In Authorization

**User Story:** As a Master Admin, I want stock-in restricted to warehouse admins, so that operations and clinic-scoped admins can only view and sell.

#### Acceptance Criteria

1. WHEN an Inventory_Admin submits a Stock_In, THE System SHALL execute the Stock_In as defined in Requirement 7.
2. IF an Admin whose Access_Level is not `inventory` and not `inventory_operations` submits a Stock_In, THEN THE System SHALL reject the request, leave every Clinic_Shop_Stock record and all warehouse stock unchanged, record no Clinic_Shop_Ledger entry, and return an error message indicating that stock-in requires warehouse inventory access.
3. IF a Clinic_Scoped_Admin submits a Stock_In, THEN THE System SHALL reject the request, leave every Clinic_Shop_Stock record and all warehouse stock unchanged, record no Clinic_Shop_Ledger entry, and return an error message indicating that stock-in requires warehouse inventory access.
4. IF a request submits a Stock_In without an authenticated Admin session, THEN THE System SHALL reject the request, leave every Clinic_Shop_Stock record and all warehouse stock unchanged, and return an error message indicating that authentication is required.
5. IF a Clinic_Scoped_Admin submits a Clinic_Visibility change, THEN THE System SHALL reject the request, leave the stored Clinic_Visibility value unchanged, and return an error message indicating that visibility is managed from warehouse inventory.
6. THE Operations_Shop_Products_Page SHALL NOT present a Stock_In action or a Clinic_Visibility toggle to any Admin.
7. WHEN an Admin whose Access_Level is `operations` requests the Warehouse_Shop_Products_Page, THE System SHALL redirect that Admin to the landing route resolved for the `operations` Access_Level.
8. THE System SHALL enforce Stock_In authorization in the server action that performs the Stock_In, in addition to any user-interface gating.
9. THE System SHALL enforce Clinic_Visibility change authorization in the server action that persists the Clinic_Visibility value, in addition to any user-interface gating.

### Requirement 17: Franchise Transfer Receipt Lands in the Franchise Warehouse

**User Story:** As a franchise admin, I want received transfers to land directly in my warehouse inventory, so that I do not need a separate confirm-stock-in step.

#### Acceptance Criteria

1. WHEN a franchise admin marks a Franchise_Stock_Transfer as received, THE System SHALL, within a single database transaction, set that Franchise_Stock_Transfer's `state` to `RECEIVED`, add the transferred quantity to the Franchise_Warehouse_Inventory as `franchise_inventory_lots` rows carrying the transfer's batch numbers and expiry dates, and record one `franchise_inventory_ledger` `IN` entry referencing that Franchise_Stock_Transfer.
2. IF any write within the receipt described in criterion 1 fails, THEN THE System SHALL roll back that database transaction, leave the Franchise_Stock_Transfer `state` unchanged, create no `franchise_inventory_lots` row, record no `franchise_inventory_ledger` entry, and return an error message indicating that the transfer receipt failed.
3. IF a request marks a Franchise_Stock_Transfer as received while that Franchise_Stock_Transfer's `state` is already `RECEIVED`, THEN THE System SHALL reject the request, create no additional `franchise_inventory_lots` row, record no additional `franchise_inventory_ledger` entry, and return an error message indicating that the transfer is already received.
4. THE System SHALL add a `franchise_inventory_lots` row only for a `franchise_stock_transfer_lines` quantity that is an integer between 1 and Stock_Quantity_Maximum inclusive, rejecting the receipt and returning an error message identifying each transfer line outside that range.
5. THE System SHALL NOT require any confirmation step between a Franchise_Stock_Transfer reaching `RECEIVED` and the transferred quantity being available in the Franchise_Warehouse_Inventory.
6. THE System SHALL leave every `franchise_product_settings` `stock_quantity` unchanged when a Franchise_Stock_Transfer reaches `RECEIVED`.
7. THE System SHALL preserve the existing `DISPATCHED`, `ACCEPTED`, `RECEIVED`, and `REJECTED` state transitions of the Franchise_Stock_Transfer lifecycle.

### Requirement 18: Franchise Shop Products Stock In

**User Story:** As a franchise admin, I want a Stock In action on my Shop Products page, so that I can move stock from my franchise warehouse into my shop the same way a core clinic does.

#### Acceptance Criteria

1. THE Franchise_Shop_Products_Page SHALL present a Stock_In action for every Shop_Product that is linked to a Master_Catalog_Product.
2. WHEN a franchise admin submits a Stock_In of quantity N for a Linked_Shop_Product and the Franchise_Warehouse_Inventory holds at least N base units of the linked Master_Catalog_Product, THE System SHALL, within a single database transaction, increase that Franchise's `franchise_product_settings` `stock_quantity` for the Shop_Product by N, decrease the Franchise_Warehouse_Inventory quantity of the linked Master_Catalog_Product by N depleting `franchise_inventory_lots` oldest-lot-first, and record one `franchise_inventory_ledger` `OUT` entry whose stock-out reason identifies a shop stock-in.
3. WHERE the Franchise holds no `franchise_product_settings` record for the Shop_Product, THE System SHALL create that record with `stock_quantity` set to 0 and `is_visible` set to `false` within the same database transaction before applying the increase.
4. IF any write within the Stock_In described in criterion 2 fails, THEN THE System SHALL roll back that database transaction, leave the `franchise_product_settings` `stock_quantity`, every `franchise_inventory_lots` quantity, and every `franchise_inventory_ledger` entry unchanged, and return an error message indicating that the stock-in failed.
5. THE System SHALL serialise concurrent writes to the same `franchise_product_settings` record, such that two concurrent Stock_In submissions of quantities A and B for the same Franchise and Shop_Product leave that record's `stock_quantity` equal to its starting value plus A plus B.
6. IF a franchise admin submits a Stock_In whose quantity exceeds the Franchise_Warehouse_Inventory quantity of the linked Master_Catalog_Product, THEN THE System SHALL reject the submission, leave the `franchise_product_settings` `stock_quantity` and all Franchise_Warehouse_Inventory quantities unchanged, and return an error message stating the quantity currently available.
7. IF a franchise admin submits a Stock_In quantity that is not an integer between 1 and Stock_Quantity_Maximum inclusive, THEN THE System SHALL reject the submission, persist no change, and return an error message indicating that the quantity must be a whole number between 1 and 1,000,000.
8. IF a franchise admin submits a Stock_In that would raise the Franchise's `franchise_product_settings` `stock_quantity` above Stock_Quantity_Maximum, THEN THE System SHALL reject the submission, persist no change, and return an error message stating the maximum stock quantity of 1,000,000.
9. IF a franchise admin submits a Stock_In for an Unlinked_Shop_Product, THEN THE System SHALL reject the submission, persist no change, and return an error message indicating that the Shop_Product must be linked to a Master_Catalog_Product before stock-in.
10. THE System SHALL restrict a franchise admin's Stock_In to the Franchise identified by that admin's franchise context, rejecting any request naming a different Franchise and returning an error message indicating that the Franchise is outside the admin's scope.
11. THE System SHALL enforce the Franchise scope restriction of criterion 10 and the available-quantity check of criterion 6 in the server action that performs the franchise Stock_In, in addition to any user-interface gating.
12. IF the Franchise_Shop_Products_Page stock data cannot be loaded, THEN THE Franchise_Shop_Products_Page SHALL display an error message indicating that the franchise shop stock could not be loaded and SHALL display no Shop_Product rows.

### Requirement 19: Franchise View From the Warehouse Shop Products Page

**User Story:** As an Inventory Admin, I want to inspect a franchise's shop product stock and hide products for that franchise, so that I retain oversight without stocking the franchise shop myself.

#### Acceptance Criteria

1. WHILE the Destination_Selector is in Franchise_Mode, THE Warehouse_Shop_Products_Page SHALL display, for every Shop_Product, the selected Franchise's `franchise_product_settings` `stock_quantity` and `is_visible` state.
2. WHILE the Destination_Selector is in Franchise_Mode, THE Warehouse_Shop_Products_Page SHALL present exactly one action per Shop_Product row: a visibility toggle that sets the selected Franchise's `is_visible` value.
3. WHILE the Destination_Selector is in Franchise_Mode, THE Warehouse_Shop_Products_Page SHALL NOT present a Stock_In action, a stock entry input, the Add New Product action, the Edit action, the Delete action, or the Franchises action.
4. IF an Inventory_Admin submits a Stock_In naming a Franchise as the destination, THEN THE System SHALL reject the request, leave every `franchise_product_settings` `stock_quantity` and all warehouse stock unchanged, and return an error message indicating that franchise shop stock-in is performed from the franchise portal.
5. WHILE the Destination_Selector is in Franchise_Mode and the selected Franchise has no `franchise_product_settings` record for a Shop_Product, THE Warehouse_Shop_Products_Page SHALL display that Shop_Product with a stock figure of 0 and a visibility state of hidden.
6. WHEN an Inventory_Admin sets the visibility of a Shop_Product while the Destination_Selector is in Franchise_Mode and the selected Franchise holds no `franchise_product_settings` record for that Shop_Product, THE System SHALL create that record with `stock_quantity` set to 0 and `is_visible` set to the submitted value.
7. IF a Franchise_Mode visibility change fails, THEN THE System SHALL leave the stored `is_visible` value unchanged, restore the toggle control to its previous displayed state, and display an error message indicating that the visibility update failed.
8. IF the selected Franchise's stock and visibility data cannot be loaded, THEN THE Warehouse_Shop_Products_Page SHALL display an error message indicating that the franchise data could not be loaded and SHALL display no Shop_Product rows.
9. THE System SHALL enforce the Stock_In rejection of criterion 4 in the server action that performs the Stock_In, in addition to any user-interface gating.
10. THE System SHALL continue to use the existing `toggleFranchiseProductVisibility` server action for Franchise_Mode visibility changes.

### Requirement 20: Data Migration of Existing Shared Shop Stock

**User Story:** As an Inventory Admin, I want existing shared shop stock moved into clinic stock without losing quantity, so that the per-clinic figures start from the real position.

#### Acceptance Criteria

1. WHEN the data migration runs, THE System SHALL create one Clinic_Shop_Stock record for every combination of a Core_Clinic and a Shop_Product whose `deleted_at` is `NULL`, with `is_visible` set to the Shop_Product's `products.is_active` value.
2. WHEN the data migration runs, THE System SHALL create every Clinic_Shop_Stock record and every Clinic_Shop_Ledger entry of that run within a single database transaction.
3. IF any write within the data migration fails, THEN THE System SHALL roll back that database transaction, create no Clinic_Shop_Stock record, create no Clinic_Shop_Ledger entry, leave every `products.stock_quantity` value unchanged, and report that the migration failed.
4. WHEN the data migration runs, THE System SHALL set each Shop_Product's Clinic_Shop_Stock `stock_quantity` for the Migration_Target_Clinic to that Shop_Product's `products.stock_quantity` value, treating a `NULL` value as 0, and SHALL set that Shop_Product's Clinic_Shop_Stock `stock_quantity` for every other Core_Clinic to 0.
5. IF a Shop_Product's `products.stock_quantity` value is below 0 or is not an integer, THEN THE System SHALL set that Shop_Product's Clinic_Shop_Stock `stock_quantity` for every Core_Clinic to 0, record no Clinic_Shop_Ledger entry for that Shop_Product, and report that Shop_Product in the migration output.
6. IF a Shop_Product's `products.stock_quantity` value is above Stock_Quantity_Maximum, THEN THE System SHALL reject the migration, create no Clinic_Shop_Stock record, create no Clinic_Shop_Ledger entry, and report each Shop_Product whose value exceeds 1,000,000.
7. WHEN the data migration sets a Migration_Target_Clinic `stock_quantity` greater than 0, THE System SHALL record one Clinic_Shop_Ledger `IN` entry for that Core_Clinic and Shop_Product with a quantity equal to the migrated value and a Movement_Source of `MIGRATION`.
8. WHEN the data migration completes, THE System SHALL leave each Shop_Product's Aggregate_Stock equal to that Shop_Product's `products.stock_quantity` value before the migration, treating a `NULL` value as 0.
9. WHERE a Clinic_Shop_Stock record already exists for a (Core_Clinic, Shop_Product) pair when the data migration runs, THE System SHALL leave that record's `stock_quantity` and `is_visible` values unchanged and SHALL record no Clinic_Shop_Ledger entry for that pair.
10. WHEN the data migration runs a second time, THE System SHALL leave every Clinic_Shop_Stock `stock_quantity` and every Clinic_Shop_Ledger entry equal to the values produced by the first run.
11. WHEN the data migration runs, THE System SHALL leave every Shop_Product's Product_Link unset and SHALL leave every existing `franchise_product_settings` record unchanged.
12. WHEN the data migration runs, THE System SHALL create no Clinic_Shop_Stock record for a Shop_Product whose `deleted_at` is set, and SHALL retain every Clinic_Shop_Stock record and Clinic_Shop_Ledger entry that already exists for such a Shop_Product.
13. IF no Core_Clinic exists when the data migration runs, THEN THE System SHALL create no Clinic_Shop_Stock record, create no Clinic_Shop_Ledger entry, and report that no Core_Clinic was available.
