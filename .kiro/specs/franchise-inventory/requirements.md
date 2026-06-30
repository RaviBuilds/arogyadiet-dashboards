# Requirements Document

## Introduction

The Franchise Inventory feature gives every franchise on the ArogyaDiet platform a dedicated, finished-product-only inventory that mirrors the look and feel of the existing central kitchen inventory, while restricting franchise operators to stock movement (not product management). When the Master Admin creates a new franchise, an empty franchise inventory is provisioned automatically. Stock can enter a franchise inventory only through transfers originating from the central kitchen, and each transfer follows an explicit lifecycle (Dispatched → Accepted → Received, or Rejected) so that physical receipt at the franchise is confirmed before stock is counted as on-hand. Stock leaves a franchise inventory through sales and loss reasons specific to franchise operations. Every movement is recorded in a per-franchise audit ledger.

The central kitchen inventory behavior is intentionally left unchanged except for two additions: the dispatch destination selector must list all active franchises, and the central kitchen outgoing audit ledger must show what was sent to each franchise with its breakdown.

The franchise inventory is presented on the franchise portal at `https://franchies.arogyadiet.com/` and reuses the existing finished-product cards, product images, and batch/FIFO UI patterns from the central kitchen inventory.

## Glossary

- **Central_Kitchen_Inventory**: The existing core business inventory (admin portal, `/inventory`) that holds raw products, finished products, and the manufacturing hub.
- **Franchise_Inventory**: A per-franchise inventory holding only finished products, shown on the franchise portal.
- **Franchise_Inventory_Service**: The system component that provisions, reads, and mutates a Franchise_Inventory and enforces its rules.
- **Dispatch_Service**: The system component on the central kitchen side that sends finished-product stock to a destination.
- **Destination_Selector**: The destination input shown in the central kitchen dispatch flow that lists dispatch targets, including franchises.
- **Stock_Transfer**: A record of finished-product stock moving from the central kitchen to a specific Franchise_Inventory, with a lifecycle state.
- **Transfer_State**: One of `DISPATCHED`, `ACCEPTED`, `RECEIVED`, `REJECTED`.
- **Franchise_Ledger**: The per-franchise audit record of all incoming and outgoing Franchise_Inventory stock movements.
- **Central_Ledger**: The existing central kitchen audit ledger (outgoing/incoming) for Central_Kitchen_Inventory.
- **Master_Admin**: A super-admin user (master portal) who creates and manages franchises.
- **Franchise_Operator**: A franchise owner or franchise admin user who operates a single franchise on the franchise portal.
- **Active_Franchise**: A franchise whose lifecycle status is `active` (not `onboarding` and not `suspended`).
- **Finished_Product**: A product whose type is `FINISHED_GOOD` in the product catalog.
- **Batch**: A finished-product stock lot identified by a batch number, carrying quantity and expiry, consistent with the central kitchen lot/batch model.
- **Stock_In**: An increase of Franchise_Inventory on-hand quantity resulting from a Received Stock_Transfer.
- **Stock_Out**: A decrease of Franchise_Inventory on-hand quantity recorded by a Franchise_Operator with a defined reason.
- **Stock_Out_Reason**: One of `MEAL_SUBSCRIPTION_SALE`, `KIT_SUBSCRIPTION_SALE`, `ONE_TIME_PURCHASE_SALE`, `SPOILED`, `DAMAGED`, `OTHER`.
- **On_Hand_Quantity**: The quantity of a finished product currently available in a Franchise_Inventory (excludes in-transit transfers).

## Requirements

### Requirement 1: Automatic Franchise Inventory Provisioning

**User Story:** As a Master Admin, I want a franchise inventory to be created automatically when I create a franchise, so that every franchise has an inventory ready to receive stock without manual setup.

#### Acceptance Criteria

1. WHEN the Master_Admin successfully creates a new franchise, THE Franchise_Inventory_Service SHALL create exactly one Franchise_Inventory associated with that franchise within the same transaction as franchise creation.
2. WHEN a Franchise_Inventory is created during franchise creation, THE Franchise_Inventory_Service SHALL initialize the Franchise_Inventory with zero finished products (product count equal to 0) and an On_Hand_Quantity equal to 0.
3. THE Franchise_Inventory_Service SHALL associate each Franchise_Inventory with exactly one franchise, such that no Franchise_Inventory references more than one franchise and no franchise references more than one Franchise_Inventory.
4. IF a franchise already has an associated Franchise_Inventory, THEN THE Franchise_Inventory_Service SHALL retain the existing Franchise_Inventory, SHALL NOT create a duplicate Franchise_Inventory, and SHALL leave the existing finished products and On_Hand_Quantity values unchanged.
5. IF the Franchise_Inventory creation fails during franchise creation, THEN THE Franchise_Inventory_Service SHALL roll back the franchise creation so that no franchise is persisted without an associated Franchise_Inventory, and SHALL return an error response indicating that inventory provisioning failed.
6. WHILE two or more concurrent franchise creation requests target the same franchise, THE Franchise_Inventory_Service SHALL ensure that exactly one Franchise_Inventory is created for that franchise.

### Requirement 2: Franchise Inventory Visibility on the Franchise Portal

**User Story:** As a Franchise Operator, I want to view my franchise inventory on the franchise dashboard, so that I can see the finished-product stock available to me.

#### Acceptance Criteria

1. WHEN a Franchise_Operator opens the franchise dashboard inventory view, THE Franchise_Inventory_Service SHALL display the Franchise_Inventory associated with that Franchise_Operator's franchise within 3 seconds.
2. WHEN THE Franchise_Inventory_Service displays a finished product in the Franchise_Inventory, THE Franchise_Inventory_Service SHALL use the same product card layout, product image, and batch presentation used by the Central_Kitchen_Inventory.
3. WHILE a Franchise_Inventory contains zero finished products, THE Franchise_Inventory_Service SHALL display an empty-inventory state on the franchise dashboard.
4. WHEN a finished product has On_Hand_Quantity greater than zero in the Franchise_Inventory, THE Franchise_Inventory_Service SHALL display that finished product with its On_Hand_Quantity and batch breakdown.
5. WHEN a finished product has On_Hand_Quantity equal to zero in the Franchise_Inventory, THE Franchise_Inventory_Service SHALL display that finished product with an out-of-stock indicator consistent with the Central_Kitchen_Inventory convention.
6. IF a Franchise_Operator requests a Franchise_Inventory that is not associated with that Franchise_Operator's own franchise, THEN THE Franchise_Inventory_Service SHALL deny the request, withhold the other franchise's data, and return an authorization-failure indication.
7. IF the Franchise_Inventory cannot be retrieved, THEN THE Franchise_Inventory_Service SHALL display an error state and provide a retry action.

### Requirement 3: Finished Products Only

**User Story:** As a platform owner, I want franchise inventory to contain only finished products, so that raw materials and manufacturing remain exclusive to the central kitchen.

#### Acceptance Criteria

1. THE Franchise_Inventory_Service SHALL include only Finished_Products in a Franchise_Inventory, and SHALL exclude raw materials, work-in-progress items, and any product whose type is not Finished_Product.
2. IF a request attempts to add a product that is not a Finished_Product to a Franchise_Inventory, THEN THE Franchise_Inventory_Service SHALL reject the request, leave the Franchise_Inventory unchanged, and return an error indication.
3. WHEN the franchise portal inventory view renders, THE Franchise_Inventory_Service SHALL NOT present raw material management, manufacturing batch operations, or production controls.
4. IF a Stock_Transfer references a product that is not a Finished_Product, THEN THE Franchise_Inventory_Service SHALL reject the entire Stock_Transfer, preserve both the source and destination inventory unchanged, and return an error indication identifying the product that violated the Finished_Product rule.

### Requirement 4: No Product Management in Franchise Inventory

**User Story:** As a platform owner, I want franchise operators to be unable to add, edit, or delete products, so that the product catalog stays centrally controlled.

#### Acceptance Criteria

1. WHEN a Franchise_Operator opens the franchise portal inventory view, THE Franchise_Inventory_Service SHALL exclude add-product, edit-product, and delete-product controls, and SHALL present only Stock_In confirmation controls and Stock_Out recording controls.
2. WHEN a Franchise_Operator interacts with the Franchise_Inventory, THE Franchise_Inventory_Service SHALL permit only Stock_In confirmation actions and Stock_Out recording actions, and SHALL deny all other product-management actions.
3. IF a request to create, edit, or delete a finished product originates from the franchise portal, THEN THE Franchise_Inventory_Service SHALL reject the request without modifying the product catalog, leave the product catalog unchanged, and return a rejection response indicating that product management is not permitted.
4. WHEN a create, edit, or delete finished-product request from the franchise portal is rejected, THE Franchise_Inventory_Service SHALL surface a user-facing error indication within 2 seconds.

### Requirement 5: Dispatch Destination Lists Active Franchises

**User Story:** As a central kitchen operator, I want active franchises to appear as dispatch destinations, so that I can send finished-product stock to franchises.

#### Acceptance Criteria

1. WHEN the central kitchen dispatch flow is opened for a finished product, THE Destination_Selector SHALL display, within 3 seconds, every franchise whose status is `active` as a selectable destination.
2. WHEN a franchise's status changes to `active`, THE Destination_Selector SHALL include that franchise as a selectable destination the next time the dispatch flow is opened, without requiring any manual configuration step by the operator.
3. THE Destination_Selector SHALL exclude every franchise whose status is `suspended` from the selectable destinations.
4. THE Destination_Selector SHALL exclude every franchise whose status is `onboarding` from the selectable destinations.
5. THE Destination_Selector SHALL exclude every franchise whose status is any value other than `active` from the selectable destinations.
6. WHEN a franchise's status changes from `active` to `suspended`, THE Destination_Selector SHALL exclude that franchise from every dispatch destination selection that is opened after the status change takes effect.
7. IF no franchise has a status of `active` when the dispatch flow is opened, THEN THE Destination_Selector SHALL display a message indicating that no dispatch destinations are available and SHALL prevent any destination from being selected.

### Requirement 6: Dispatching Stock to a Franchise

**User Story:** As a central kitchen operator, I want to send finished-product stock to a selected franchise, so that the franchise can receive and stock it.

#### Acceptance Criteria

1. WHEN the central kitchen operator selects an Active_Franchise destination and dispatches a quantity greater than zero of a Finished_Product, THE Dispatch_Service SHALL create exactly one Stock_Transfer in Transfer_State `DISPATCHED` for that franchise.
2. THE Dispatch_Service SHALL record on each Stock_Transfer the destination franchise, the finished product, the dispatched quantity, the batch breakdown of the dispatched stock, and the dispatch timestamp.
3. WHEN a Stock_Transfer is created, THE Dispatch_Service SHALL deduct the dispatched quantity from the Central_Kitchen_Inventory using the existing FIFO lot depletion behavior.
4. IF the dispatched quantity exceeds the available Central_Kitchen_Inventory On_Hand_Quantity for the finished product, THEN THE Dispatch_Service SHALL reject the dispatch, SHALL NOT create a Stock_Transfer, SHALL leave the Central_Kitchen_Inventory On_Hand_Quantity unchanged, and SHALL return an error message indicating insufficient available stock.
5. WHILE a Stock_Transfer is in Transfer_State `DISPATCHED`, THE Franchise_Inventory_Service SHALL exclude the dispatched quantity from the destination franchise's On_Hand_Quantity.
6. IF the dispatched quantity is less than or equal to zero or is not a numeric value, THEN THE Dispatch_Service SHALL reject the dispatch, SHALL NOT create a Stock_Transfer, SHALL leave the Central_Kitchen_Inventory On_Hand_Quantity unchanged, and SHALL return an error message indicating the dispatched quantity is invalid.
7. IF the selected destination is not an Active_Franchise at the time of dispatch, THEN THE Dispatch_Service SHALL reject the dispatch, SHALL NOT create a Stock_Transfer, SHALL leave the Central_Kitchen_Inventory On_Hand_Quantity unchanged, and SHALL return an error message indicating the destination is not an active franchise.

### Requirement 7: Incoming Transfer Notification with Accept and Reject

**User Story:** As a Franchise Operator, I want to see incoming stock sent by the central kitchen with accept and reject options, so that I can acknowledge or decline shipments.

#### Acceptance Criteria

1. WHILE a Stock_Transfer for a franchise is in Transfer_State `DISPATCHED`, THE Franchise_Inventory_Service SHALL display an incoming-stock section on that franchise's dashboard identifying the central kitchen as the sender within 5 seconds.
2. WHILE a Stock_Transfer is in Transfer_State `DISPATCHED`, THE Franchise_Inventory_Service SHALL display, for that Stock_Transfer, the product name, the dispatched quantity, the batch breakdown as a list of batch identifiers with corresponding quantities, and the dispatch timestamp.
3. THE Franchise_Inventory_Service SHALL present an Accept control and a Reject control for each Stock_Transfer in Transfer_State `DISPATCHED`.
4. WHEN a Franchise_Operator selects Reject for a Stock_Transfer in Transfer_State `DISPATCHED`, THE Franchise_Inventory_Service SHALL set the Stock_Transfer to Transfer_State `REJECTED` and SHALL exclude the rejected quantity from the franchise's On_Hand_Quantity.
5. WHEN a Franchise_Operator selects Accept for a Stock_Transfer in Transfer_State `DISPATCHED`, THE Franchise_Inventory_Service SHALL set the Stock_Transfer to Transfer_State `ACCEPTED` and SHALL NOT add the accepted quantity to the franchise's On_Hand_Quantity, leaving the stock in transit until it is Received per Requirement 8.
6. IF an Accept or Reject action is requested for a Stock_Transfer that is not in Transfer_State `DISPATCHED`, THEN THE Franchise_Inventory_Service SHALL reject the action, leave the Stock_Transfer's Transfer_State and the franchise's On_Hand_Quantity unchanged, and return an error indication.
7. IF processing an Accept or Reject action fails, THEN THE Franchise_Inventory_Service SHALL keep the Stock_Transfer in Transfer_State `DISPATCHED`, leave the franchise's On_Hand_Quantity unchanged, and surface an error indication.

### Requirement 8: In-Transit Acceptance and Physical Receipt

**User Story:** As a Franchise Operator, I want accepted stock to remain in transit until I confirm physical receipt, so that my on-hand counts reflect stock that has actually arrived.

#### Acceptance Criteria

1. WHILE a Stock_Transfer is in Transfer_State `ACCEPTED`, THE Franchise_Inventory_Service SHALL exclude the accepted quantity from the franchise's On_Hand_Quantity.
2. WHILE a Stock_Transfer is in Transfer_State `ACCEPTED`, THE Franchise_Inventory_Service SHALL display the Stock_Transfer with an in-transit indicator and a Received control.
3. WHEN a Franchise_Operator selects Received for a Stock_Transfer in Transfer_State `ACCEPTED`, THE Franchise_Inventory_Service SHALL set the Stock_Transfer to Transfer_State `RECEIVED`.
4. WHEN a Stock_Transfer reaches Transfer_State `RECEIVED`, THE Franchise_Inventory_Service SHALL add a Stock_In whose total quantity and per-batch quantities equal the Stock_Transfer's accepted quantity and batch breakdown.
5. IF a Received action is requested for a Stock_Transfer that is not in Transfer_State `ACCEPTED`, THEN THE Franchise_Inventory_Service SHALL reject the action, keep the Stock_Transfer's Transfer_State unchanged, and return a clear error indication.
6. THE Franchise_Inventory_Service SHALL transition each Stock_Transfer only along the order `DISPATCHED` → `ACCEPTED` → `RECEIVED`, with `DISPATCHED` → `REJECTED` as the only alternative terminal transition.
7. IF persisting the receipt fails, THEN THE Franchise_Inventory_Service SHALL roll back the receipt so that neither the Stock_Transfer's Transfer_State nor the franchise's On_Hand_Quantity changes, and SHALL surface a failure indication.
8. WHEN a Received action is requested for a Stock_Transfer already in Transfer_State `RECEIVED`, THE Franchise_Inventory_Service SHALL NOT increase the franchise's On_Hand_Quantity again and SHALL leave the Stock_Transfer in Transfer_State `RECEIVED`.

### Requirement 9: Central Kitchen as the Only Stock-In Source

**User Story:** As a platform owner, I want franchise stock to come only from the central kitchen, so that the franchise supply chain stays controlled and traceable.

#### Acceptance Criteria

1. WHEN a Stock_Transfer reaches Transfer_State `RECEIVED`, THE Franchise_Inventory_Service SHALL increase the destination Franchise_Inventory On_Hand_Quantity by exactly the received Stock_Transfer quantity.
2. THE Franchise_Inventory_Service SHALL increase a Franchise_Inventory On_Hand_Quantity through no mechanism other than a Stock_Transfer that has reached Transfer_State `RECEIVED`.
3. WHEN a Stock_In is recorded against a Franchise_Inventory, THE Franchise_Inventory_Service SHALL record the central kitchen identifier associated with the originating Stock_Transfer as the source of that Stock_In.
4. IF a Stock_In is requested for a Franchise_Inventory from any source other than a central kitchen Stock_Transfer in Transfer_State `RECEIVED`, THEN THE Franchise_Inventory_Service SHALL reject the Stock_In, leave the Franchise_Inventory On_Hand_Quantity unchanged, and return an error response indicating that the source is not an authorized central kitchen Stock_Transfer.
5. IF a Stock_In is requested with a quantity less than or equal to zero, THEN THE Franchise_Inventory_Service SHALL reject the Stock_In, leave the Franchise_Inventory On_Hand_Quantity unchanged, and return an error response indicating an invalid quantity.

### Requirement 10: Stock-Out from Franchise Inventory

**User Story:** As a Franchise Operator, I want to record outgoing stock with a reason, so that my inventory reflects sales and losses accurately.

#### Acceptance Criteria

1. WHEN a Franchise_Operator records a Stock_Out for a finished product, THE Franchise_Inventory_Service SHALL require a Stock_Out_Reason from the set `MEAL_SUBSCRIPTION_SALE`, `KIT_SUBSCRIPTION_SALE`, `ONE_TIME_PURCHASE_SALE`, `SPOILED`, `DAMAGED`, `OTHER`.
2. WHEN a Stock_Out is recorded, THE Franchise_Inventory_Service SHALL deduct the recorded quantity from the franchise's On_Hand_Quantity using FIFO batch depletion that depletes the oldest-received batch first and fully consumes each batch before depleting the next, consistent with the Central_Kitchen_Inventory model.
3. IF a Stock_Out quantity exceeds the franchise's On_Hand_Quantity for the finished product, THEN THE Franchise_Inventory_Service SHALL reject the Stock_Out, leave the franchise's On_Hand_Quantity and batches unchanged, and return an error response indicating insufficient available stock and including the requested quantity and the available quantity.
4. IF a Stock_Out quantity is not a positive whole number, THEN THE Franchise_Inventory_Service SHALL reject the Stock_Out, leave the franchise's On_Hand_Quantity and batches unchanged, and return an invalid-quantity error response identifying the invalid quantity.
5. WHERE the Stock_Out_Reason is `OTHER`, THE Franchise_Inventory_Service SHALL require a comment of length 1 to 500 characters before recording the Stock_Out.
6. IF the Stock_Out_Reason is `OTHER` and the comment is empty, THEN THE Franchise_Inventory_Service SHALL reject the Stock_Out, leave the franchise's On_Hand_Quantity and batches unchanged, and return an error response indicating that a comment is required.
7. WHEN a Stock_Out is recorded, THE Franchise_Inventory_Service SHALL record the Stock_Out_Reason, the quantity, the per-batch depleted quantity, the optional comment, and a timestamp recorded in UTC.

### Requirement 11: Franchise Audit Ledger

**User Story:** As a Franchise Operator, I want a detailed audit ledger of incoming and outgoing stock, so that I can review every movement in my inventory.

#### Acceptance Criteria

1. WHEN a Stock_Transfer reaches Transfer_State `RECEIVED`, THE Franchise_Ledger SHALL record an incoming entry capturing the finished product, quantity, batch breakdown, central kitchen source, and a timestamp recorded in UTC with at least second-level precision.
2. WHEN a Stock_Out is recorded, THE Franchise_Ledger SHALL record an outgoing entry capturing the finished product, quantity, Stock_Out_Reason, any comment, affected batches, and a timestamp recorded in UTC with at least second-level precision.
3. THE Franchise_Ledger SHALL scope every entry to the Franchise_Inventory of exactly one franchise, such that no entry is associated with more than one franchise.
4. WHEN a Franchise_Operator opens the Franchise_Ledger, THE Franchise_Inventory_Service SHALL display only the incoming and outgoing entries belonging to that Franchise_Operator's franchise, sorted by entry timestamp from newest to oldest, with ties broken by descending insertion order.
5. WHEN a Franchise_Operator opens the Franchise_Ledger and no entries exist for that Franchise_Operator's franchise, THE Franchise_Inventory_Service SHALL display an empty-ledger indication and zero entries.
6. IF a Franchise_Operator attempts to open a Franchise_Ledger that is not scoped to that Franchise_Operator's franchise, THEN THE Franchise_Inventory_Service SHALL deny the request, display an authorization-failure indication, and disclose no entries from the other franchise.
7. IF recording a Franchise_Ledger entry fails for an incoming or outgoing movement, THEN THE Franchise_Inventory_Service SHALL roll back the entry so that no partial entry is persisted and SHALL surface a failure indication identifying the affected movement.

### Requirement 12: Batch and UI Consistency with Central Kitchen Inventory

**User Story:** As a Franchise Operator, I want the franchise inventory to look and batch like the central kitchen inventory, so that the experience is familiar and stock is traceable by batch.

#### Acceptance Criteria

1. WHEN stock is added to a Franchise_Inventory through a Received Stock_Transfer, THE Franchise_Inventory_Service SHALL create or update Franchise_Inventory batch records that retain each transferred batch's identifier and expiry date unchanged from the source Stock_Transfer.
2. IF a Received Stock_Transfer contains a stock line that has no batch identifier or no expiry date, THEN THE Franchise_Inventory_Service SHALL reject that stock line, retain the existing Franchise_Inventory quantities unchanged, and return an error response indicating the missing batch identifier or expiry date.
3. WHEN a Franchise_Inventory finished-product view is requested, THE Franchise_Inventory_Service SHALL display finished-product cards, product images, and per-batch breakdowns (batch identifier, expiry date, and quantity available) using the same display components and layout as the Central_Kitchen_Inventory.
4. WHEN a Franchise_Inventory batch breakdown is displayed, THE Franchise_Inventory_Service SHALL order batches by ascending expiry date (earliest expiry first), and SHALL order batches sharing the same expiry date by ascending received date.
5. WHEN a Stock_Out depletes a finished product from Franchise_Inventory, THE Franchise_Inventory_Service SHALL deplete quantity from the batch with the earliest expiry date first and continue to the next-earliest batch until the requested quantity is fulfilled, consistent with the Central_Kitchen_Inventory FIFO model.
6. IF a Stock_Out requests a quantity greater than the total quantity available across all non-expired batches of the finished product, THEN THE Franchise_Inventory_Service SHALL reject the Stock_Out, retain all batch quantities unchanged, and return an error response indicating insufficient available stock.

### Requirement 13: Central Kitchen Inventory Changes Limited to Dispatch and Ledger

**User Story:** As a platform owner, I want the central kitchen inventory to remain unchanged except for franchise dispatch and ledger additions, so that existing core operations are not disrupted.

#### Acceptance Criteria

1. THE Dispatch_Service SHALL extend the Destination_Selector to include Active_Franchise destinations while preserving the existing non-franchise dispatch destinations, and SHALL exclude franchises whose status is inactive, `suspended`, or `onboarding`.
2. WHEN finished-product stock is dispatched to a franchise, THE Central_Ledger SHALL add exactly one outgoing entry recording the destination franchise identifier, the total dispatched quantity, and the per-batch breakdown.
3. IF the Central_Ledger write fails, THEN THE Dispatch_Service SHALL roll back the dispatch so that no stock is deducted from the Central_Kitchen_Inventory, and SHALL return an error indication.
4. THE Dispatch_Service SHALL preserve the existing Central_Kitchen_Inventory behavior by leaving the records, schema, and quantities for raw products, finished products, and the manufacturing hub unchanged outside of the franchise destination and ledger additions.
5. THE Franchise_Inventory_Service SHALL keep Franchise_Inventory data isolated from the Central_Kitchen_Inventory product, lot, and manufacturing tables except through Stock_Transfer records, and IF a Franchise_Inventory mutation attempts to bypass Stock_Transfer records, THEN THE Franchise_Inventory_Service SHALL reject the mutation.
