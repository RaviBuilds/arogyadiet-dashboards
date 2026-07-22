# Requirements Document

## Introduction

Today, only customers can buy shop products from their own dashboard shop. Those
products are not delivered on their own — they ride along on the customer's next
meal delivery, linked by the nightly linking flow and delivered with the meal
(see the existing spec `shop-product-delivery-linking-fix`).

This feature lets an **Admin** (from the admin dashboard) and a **Franchise Admin**
(from the franchise dashboard) place a shop-product order **on behalf of a
customer**, mirroring the customer-side checkout flow. The operator builds a cart
of shop products, searches for and selects an eligible customer (by mobile number
or name), reviews pricing computed with the same logic as the customer checkout
**but with no delivery fee**, explicitly marks the order as paid (there is no
online payment), and then places the order. The placed order behaves exactly like
a customer-placed order: it links to the customer's next available delivery via the
existing linking flow and is delivered alongside the meal delivery.

The capability is provided for both the admin shop section and the franchise shop
section. Admin scope and franchise scope are strictly separated: an Admin on the
admin dashboard serves **only core business customers** (customers with no
`franchise_id`) and never franchise customers; a Franchise Admin serves **only the
customers belonging to their own franchise** and never core-business customers or
other franchises' customers. Franchise orders honor the franchise stock decrement
and oversell safeguards from the existing spec.

This spec covers requirements only. It reuses the existing pricing
(`calculateShopOrderBreakdown`), IST-date basis (`getISTDateString`), linking
(`runProductLinkingAction`), and franchise-stock failsafe behavior rather than
redefining them.

## Glossary

- **Operator**: An authenticated user placing an order on behalf of a customer;
  either an Admin or a Franchise_Admin.
- **Admin**: A user with role `ADMIN` (or `MASTER_ADMIN`) with manage access to the
  relevant operations group, acting from the admin dashboard.
- **Franchise_Admin**: A user with role `FRANCHISE_ADMIN` acting from the franchise
  dashboard, scoped to a single `franchise_id`.
- **Assisted_Order_System**: The server-side capability (server actions) that
  builds the cart, searches customers, validates eligibility, prices the order,
  records manual payment, creates the order, and links it — the subject of this
  spec.
- **Cart**: The Operator-built collection of shop products and quantities to be
  ordered for the selected customer.
- **Target_Customer**: The customer account the Operator selects to place the order
  for, identified by `customer_profile_id`.
- **Active_Subscription**: A `subscriptions` row for the Target_Customer with
  `status = "ACTIVE"`.
- **Effective_End_Date**: The subscription's `effective_end_on` value — the last
  active delivery date after accounting for pauses.
- **Current_IST_Date**: The `YYYY-MM-DD` value returned by `getISTDateString(0)`
  (Asia/Kolkata), the authoritative "today" used across the platform.
- **Expiring_Today**: The condition where an Active_Subscription's
  Effective_End_Date equals the Current_IST_Date.
- **Order_Pricing**: The price breakdown produced by `calculateShopOrderBreakdown`
  (inclusive-tax subtotal, tax, discount, total) as used by the customer checkout,
  **excluding any delivery fee**.
- **Mark_Paid_Action**: The explicit Operator action that records the order's
  payment status as `PAID` without an online payment charge.
- **Place_Order_Action**: The final action that creates the addon order for the
  Target_Customer and submits it for linking.
- **Addon_Order**: A row in `addon_orders` representing the placed shop-product
  order, carrying `customer_profile_id`, `franchise_id`, `total_amount`,
  `target_delivery_date`, `status`, and (after linking) `delivery_order_id`.
- **Next_Available_Delivery**: The Target_Customer's earliest upcoming non-paused
  delivery day, selected by the existing checkout/linking logic.
- **Linking_Flow**: The existing `runProductLinkingAction` behavior that links a
  PAID Addon_Order to the customer's Next_Available_Delivery.
- **Franchise_Stock_Decrement**: The atomic `decrement_franchise_product_stock` RPC
  that reduces a franchise's per-product stock.
- **Unfulfillable_Stock_Status**: The `addon_orders.fulfillment_status` marker
  (`UNFULFILLABLE_STOCK`) set when a Franchise_Stock_Decrement cannot be honored.

## Requirements

### Requirement 1: Build a cart of shop products

**User Story:** As an Operator, I want to add shop products and quantities to a
cart, so that I can assemble an order to place for a customer.

#### Acceptance Criteria

1. WHEN an Operator adds a shop product that is not already in the Cart with a quantity that is an integer between 1 and 999 inclusive, THE Assisted_Order_System SHALL record the product identifier and the selected quantity as a new Cart line.
2. WHEN an Operator adds a shop product that is already present in the Cart with a quantity that is an integer between 1 and 999 inclusive, THE Assisted_Order_System SHALL increase the recorded quantity of the existing Cart line by the added quantity, up to the maximum of 999.
3. IF an Operator attempts to add or set a product quantity that is not an integer, is less than 1, or is greater than 999, THEN THE Assisted_Order_System SHALL reject the action, leave the Cart unchanged, and display an error indicating the allowed quantity range.
4. WHEN an Operator changes the quantity of a product already in the Cart to an integer between 1 and 999 inclusive, THE Assisted_Order_System SHALL replace the recorded quantity of that Cart line with the new value.
5. WHEN an Operator sets the quantity of a product already in the Cart to 0, THE Assisted_Order_System SHALL remove that product from the Cart.
6. WHEN an Operator removes a product from the Cart, THE Assisted_Order_System SHALL remove that product's line from the Cart.
7. THE Assisted_Order_System SHALL present the same shop product catalog used by the customer dashboard shop checkout, containing the identical set of products with identical prices for the same franchise context.
8. WHERE the Operator is a Franchise_Admin, THE Assisted_Order_System SHALL restrict selectable Cart products to products visible for that Franchise_Admin's franchise.
9. IF a Franchise_Admin attempts to add a product that is not visible for that Franchise_Admin's franchise, THEN THE Assisted_Order_System SHALL prevent the product from being added to the Cart, leave the Cart unchanged, and display an error indicating the product is not available for the franchise.
10. IF an Operator attempts to add or set a product quantity that exceeds the available stock for that product in the applicable franchise, THEN THE Assisted_Order_System SHALL reject the action, leave the Cart unchanged, and display an error indicating the available stock quantity.
11. IF the Cart contains no products, THEN THE Assisted_Order_System SHALL reject the Place_Order_Action, retain the empty Cart, and display an error indicating that at least one product is required.

### Requirement 2: Search for a customer by mobile number or name

**User Story:** As an Operator, I want to search for a customer by mobile number or
name after building the cart, so that I can select the account to place the order
for.

#### Acceptance Criteria

1. WHEN an Operator submits a customer search using a mobile number query of at least 3 digits, THE Assisted_Order_System SHALL return customer accounts whose mobile number contains the submitted digit sequence, ignoring surrounding whitespace.
2. WHEN an Operator submits a customer search using a name query of at least 2 characters, THE Assisted_Order_System SHALL return customer accounts whose name contains the submitted value as a partial, case-insensitive match, ignoring leading and trailing whitespace.
3. IF an Operator submits a search query shorter than the minimum length (fewer than 3 digits for mobile number or fewer than 2 characters for name), THEN THE Assisted_Order_System SHALL reject the search without querying, and SHALL present a message indicating the minimum query length required.
4. WHEN a customer search returns one or more matches, THE Assisted_Order_System SHALL present each result with the customer's full name and full mobile number as identifying detail, and SHALL return at most 50 results ordered by closest match.
5. IF a customer search completes with no matching accounts, THEN THE Assisted_Order_System SHALL present an empty result set with a message indicating that no matching customers were found, and SHALL retain the previously built Cart unchanged.
6. WHERE the Operator is a Franchise_Admin, THE Assisted_Order_System SHALL return only customers whose `franchise_id` matches that Franchise_Admin's franchise, and SHALL exclude core-business customers and customers of other franchises.
7. WHERE the Operator is an Admin, THE Assisted_Order_System SHALL return only core-business customers (customers with no `franchise_id`), and SHALL exclude all franchise customers.
8. WHEN an Operator selects one customer from the search results, THE Assisted_Order_System SHALL set that selected customer as the Target_Customer for the order.

### Requirement 3: Filter selectable customers by eligibility

**User Story:** As an Operator, I want only eligible customers to be selectable, so
that I do not place an order for a customer who cannot receive it.

#### Acceptance Criteria

1. THE Assisted_Order_System SHALL treat a customer as eligible only when the customer has an Active_Subscription whose Effective_End_Date is strictly greater than the Current_IST_Date.
2. IF a searched customer has no Active_Subscription, THEN THE Assisted_Order_System SHALL exclude that customer from selection and SHALL indicate that the customer is not eligible.
3. IF a searched customer's Active_Subscription has an Effective_End_Date equal to the Current_IST_Date (Expiring_Today), THEN THE Assisted_Order_System SHALL exclude that customer from selection because there is no next available delivery day.
4. WHEN the Assisted_Order_System evaluates whether a subscription is Expiring_Today, THE Assisted_Order_System SHALL compare the subscription's Effective_End_Date (which accounts for pause-based extensions) against the Current_IST_Date, treating Effective_End_Date equal to Current_IST_Date as Expiring_Today and Effective_End_Date greater than Current_IST_Date as eligible.
5. WHEN an Operator selects a Target_Customer, THE Assisted_Order_System SHALL re-evaluate the customer's eligibility using the same criteria as Acceptance Criterion 1 before presenting the order form.
6. IF a Target_Customer is not eligible at the time of selection, THEN THE Assisted_Order_System SHALL block presentation of the order form and SHALL display a message indicating the customer is not eligible.
7. IF an Operator attempts a Place_Order_Action for a Target_Customer who is not eligible at the time of the Place_Order_Action, THEN THE Assisted_Order_System SHALL reject the Place_Order_Action, SHALL not create any order record, and SHALL display a message indicating the customer is not eligible.

### Requirement 4: Price the order using customer-checkout logic without a delivery fee

**User Story:** As an Operator, I want the order priced the same way as the customer
checkout but without a delivery fee, so that the customer is charged the correct
product amount since the product ships with the meal delivery.

#### Acceptance Criteria

1. WHEN the Assisted_Order_System computes Order_Pricing for the Cart, THE Assisted_Order_System SHALL use the same inclusive-tax price calculation logic as the customer dashboard shop products checkout (`calculateShopOrderBreakdown`), producing a subtotal, tax, discount, and total.
2. WHEN the Assisted_Order_System computes Order_Pricing, THE Assisted_Order_System SHALL set the delivery fee component to 0 and exclude any delivery fee from the total.
3. WHEN the Assisted_Order_System stores the order total, THE Assisted_Order_System SHALL set the Addon_Order `total_amount` to the Order_Pricing total that excludes any delivery fee.
4. WHEN the Assisted_Order_System presents Order_Pricing to the Operator, THE Assisted_Order_System SHALL display the product subtotal, tax, the discount (0 when none applies), and the final total that the customer will be charged.
5. WHEN the Assisted_Order_System computes Order_Pricing, THE Assisted_Order_System SHALL derive each item's unit price from the server-side catalog (the product's `sale_price` when set, otherwise its `original_price`) and SHALL ignore any client-supplied price.
6. IF the Cart is empty or a Cart product's catalog price cannot be resolved, THEN THE Assisted_Order_System SHALL reject the pricing computation, retain the Cart unchanged, and return an error indicating the reason.
7. WHERE a discount or coupon is applied to the order, THE Assisted_Order_System SHALL apply the same discount and coupon rules used by the customer dashboard shop products checkout.

### Requirement 5: Record manual payment that gates placing the order

**User Story:** As an Operator, I want to explicitly mark the order as paid before I
can place it, so that the order is recorded as paid without an online payment
charge.

#### Acceptance Criteria

1. THE Assisted_Order_System SHALL NOT initiate an online payment charge for an order placed through the assisted flow.
2. WHILE the Operator has not performed the Mark_Paid_Action for the current order, THE Assisted_Order_System SHALL keep the Place_Order_Action disabled.
3. WHEN the Operator performs the Mark_Paid_Action, THE Assisted_Order_System SHALL set the order's payment status to PAID and create a payment record with method reflecting a manual/offline payment, status PAID, and the identity of the Operator who performed the Mark_Paid_Action.
4. WHEN the Assisted_Order_System sets the order's payment status to PAID, THE Assisted_Order_System SHALL enable the Place_Order_Action.
5. WHILE the order's payment status is PAID, THE Assisted_Order_System SHALL keep the Place_Order_Action enabled, treating the PAID payment status as sufficient to enable placement.
6. WHEN the Assisted_Order_System creates the Addon_Order after a Mark_Paid_Action, THE Assisted_Order_System SHALL set the Addon_Order status to PAID.
7. IF the Place_Order_Action is invoked while the order's payment status is not PAID, THEN THE Assisted_Order_System SHALL reject the Place_Order_Action through a server-side check, retain the order without creating an Addon_Order, and return an error indicating that payment must be marked as paid first.

### Requirement 6: Create the order and link it to the next available delivery

**User Story:** As an Operator, I want the placed order to link to the customer's
next available delivery, so that the product is delivered along with the customer's
meal delivery.

#### Acceptance Criteria

1. WHEN the Operator completes the Place_Order_Action for an eligible Target_Customer whose order payment status is PAID, THE Assisted_Order_System SHALL create exactly one Addon_Order for the Target_Customer that records every Cart product, its ordered quantity, and its unit price, and SHALL set the Addon_Order `total_amount` equal to the Order_Pricing total.
2. WHEN the Assisted_Order_System sets the Addon_Order `target_delivery_date`, THE Assisted_Order_System SHALL set it to the Next_Available_Delivery computed from the Current_IST_Date basis (`getISTDateString`), using the same computation as the customer checkout and the Linking_Flow.
3. WHEN a placed Addon_Order has status PAID, THE Linking_Flow SHALL link the Addon_Order to the Target_Customer's Next_Available_Delivery and populate the Addon_Order `delivery_order_id`, identically to a customer-placed PAID Addon_Order.
4. IF, at the time of the Place_Order_Action, the Target_Customer has no upcoming non-paused active delivery day on or after the Current_IST_Date, THEN THE Assisted_Order_System SHALL reject the Place_Order_Action, create no Addon_Order, and return an error message indicating that the customer has no upcoming active delivery days.
5. IF any step of the Place_Order_Action fails, including Addon_Order creation, order-item creation, payment recording, or linking, THEN THE Assisted_Order_System SHALL roll back all writes performed by that Place_Order_Action so that no Addon_Order, order-item, or payment row persists, and SHALL return an error message describing the failure.
6. WHEN the Assisted_Order_System creates an Addon_Order through the Place_Order_Action, THE Assisted_Order_System SHALL persist the identifier of the Operator who placed the order on the Addon_Order for audit purposes.

### Requirement 7: Franchise parity and stock handling

**User Story:** As a Franchise_Admin, I want to place shop-product orders for my own
customers with the same logic, so that franchise stock is decremented and oversell
is prevented.

#### Acceptance Criteria

1. THE Assisted_Order_System SHALL provide the assisted order capability in the franchise shop products section using the same cart, search, eligibility, pricing, mark-paid, and linking behavior as the admin section.
2. WHEN a Franchise_Admin places an order for a Target_Customer, THE Assisted_Order_System SHALL set the Addon_Order `franchise_id` to the Franchise_Admin's franchise.
3. WHEN a franchise Addon_Order is marked PAID, THE Assisted_Order_System SHALL decrement franchise stock for all ordered items using the Franchise_Stock_Decrement, which either succeeds for every ordered item or applies no decrement at all.
4. IF the franchise stock for any ordered item is zero or less than that item's ordered quantity, THEN THE Assisted_Order_System SHALL NOT decrement franchise stock for any item in the Addon_Order and SHALL treat the Franchise_Stock_Decrement as unable to be honored.
5. IF the Franchise_Stock_Decrement cannot be honored for any ordered item, THEN THE Assisted_Order_System SHALL mark the Addon_Order with the Unfulfillable_Stock_Status, retain the payment status as PAID, leave franchise stock unchanged, and withhold completion as a clean sale until the payment-versus-stock mismatch is manually resolved.
6. WHEN an Addon_Order is marked with the Unfulfillable_Stock_Status, THE Assisted_Order_System SHALL send a notification to an Admin indicating the order requires manual payment-versus-stock resolution.
7. WHERE the order is placed by an Admin for a core (non-franchise) customer, THE Assisted_Order_System SHALL create the Addon_Order without any Franchise_Stock_Decrement.

### Requirement 8: Access control and scoping

**User Story:** As the platform, I want assisted ordering restricted to authorized
operators within their scope, so that operators cannot place orders outside their
authority.

#### Acceptance Criteria

1. IF a request to use the Assisted_Order_System comes from a user who is neither an Admin with the required operations-group access nor a Franchise_Admin, THEN THE Assisted_Order_System SHALL reject the request with an authorization error, perform no database write, and return a response indicating the request was denied due to insufficient authorization.
2. IF an Admin lacks the required operations-group access, THEN THE Assisted_Order_System SHALL reject the Admin's request with an authorization error, perform no database write, and treat the Admin identically to an unauthorized user by returning the same authorization-denied response.
3. IF a Franchise_Admin attempts to select or place an order for a Target_Customer whose `franchise_id` does not match that Franchise_Admin's `franchise_id`, THEN THE Assisted_Order_System SHALL reject the request with an authorization error, perform no database write, and leave all existing customer, order, and stock records unchanged.
4. IF an Admin attempts to select or place an order for a Target_Customer whose `franchise_id` is non-null (a franchise customer), THEN THE Assisted_Order_System SHALL reject the request with an authorization error, perform no database write, and leave all existing customer, order, and stock records unchanged.
5. WHEN an Admin uses the Assisted_Order_System, THE Assisted_Order_System SHALL authorize the Admin using the same operations-group access model applied to other admin shop and customer operations.
6. WHEN the Assisted_Order_System performs a customer search, order creation, or stock decrement, THE Assisted_Order_System SHALL scope every database write by the Target_Customer's `customer_profile_id` and, for a Franchise_Admin, additionally by that Franchise_Admin's `franchise_id`.
7. WHEN any Assisted_Order_System operation is invoked, THE Assisted_Order_System SHALL enforce the authorization and scoping checks in criteria 1 through 6 on the server for that operation, independently of any client-side or UI-level restriction.
8. IF a request to the Assisted_Order_System has no authenticated user session, THEN THE Assisted_Order_System SHALL reject the request with an authorization error and perform no database write.
