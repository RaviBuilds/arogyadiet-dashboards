# Implementation Plan: Admin Place Shop Order for Customer

## Overview

Implement the assisted shop-order capability as a thin layer over proven building
blocks. Work bottom-up: the additive schema and the atomic placement RPC first,
then the portal-agnostic pure core (`src/lib/shop/assisted-order/`), the pricing
adapter, the `AssistedOrderService` (search/eligibility/pricing then placement),
the thin per-portal action wrappers that resolve and enforce the `OperatorContext`,
and finally the shared UI wired into both portals. Property-based tests (fast-check,
≥100 runs) cover the 15 correctness properties from the design; unit and
integration tests cover wiring, side effects, and rollback.

All code is TypeScript, matching the existing Next.js 16 / Supabase codebase and
the module-boundary rules (shared portal-agnostic core, no cross-portal imports).

## Tasks

- [x] 1. Database schema and atomic placement RPC
  - [x] 1.1 Add `placed_by_user_id` column to `addon_orders`
    - Create `scripts/add-placed-by-to-addon-orders.sql` adding a nullable
      `placed_by_user_id UUID` referencing `public.users(id) ON DELETE SET NULL`
    - Add a partial index `idx_addon_orders_placed_by` for non-null values
    - Keep the change additive/back-compatible (NULL for customer-placed orders)
    - _Requirements: 6.6_

  - [x] 1.2 Create the `place_assisted_addon_order` SECURITY DEFINER RPC
    - Create `scripts/create-place-assisted-addon-order-rpc.sql` performing, in one
      transaction: insert `payments` (`payment_method='MANUAL'`, `status='PAID'`,
      `invoice_type='ADDON'`, `paid_at=now()`, base/tax/discount from breakdown,
      `amount=total`); insert `addon_orders` (`status='PAID'`, `total_amount=total`,
      `target_delivery_date`, scoped `franchise_id`, `payment_id`,
      `placed_by_user_id`); insert one `addon_order_items` row per cart line
    - Accept only server-computed inputs (prices, total, target date, franchise_id,
      operator id); never client-supplied prices; return the new `addon_order.id`
    - Ensure any failure raises and rolls back the whole transaction
    - Mirror the existing `create-onboard-customer-rpc.sql` pattern
    - _Requirements: 4.5, 6.1, 6.5, 7.2_

- [x] 2. Implement shared pure core logic (`src/lib/shop/assisted-order/core.ts`)
  - [x] 2.1 Implement portal-agnostic pure functions
    - Define `OperatorRole`, `OperatorScope`, `CartLine`, `MIN_QTY`, `MAX_QTY`
    - Implement `validateQuantity` (integer in `[1,999]`)
    - Implement `addToCart` (create/merge clamped to 999), `setCartQuantity`
      (replace; `0` removes line), `removeFromCart`
    - Implement the franchise add precondition guard (reject when product not in the
      franchise's visible set or requested qty exceeds available franchise stock;
      leave cart unchanged)
    - Implement `validateSearchQuery` (mobile ≥3 digits, name ≥2 chars, trim/normalize)
    - Implement `isCustomerEligible` (Effective_End_Date strictly > Current_IST_Date,
      lexicographic ISO compare)
    - Implement `isTargetInScope` and `canPlaceOrder` (PAID-only gating)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 1.10, 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 5.2, 5.4, 5.5, 5.7, 8.3, 8.4_

  - [ ]* 2.2 Write property test for cart mutations
    - **Property 1: Cart mutations behave as a consistent line model**
    - **Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.6**
    - fast-check, ≥100 runs; own test file; boundary quantities at 1 and 999

  - [ ]* 2.3 Write property test for invalid-quantity rejection
    - **Property 2: Invalid quantities are rejected and never mutate the cart**
    - **Validates: Requirements 1.3**
    - Cover non-integer, <1, and >999; assert cart returned unchanged

  - [ ]* 2.4 Write property test for franchise add precondition
    - **Property 3: Adds failing a franchise precondition are rejected without mutation**
    - **Validates: Requirements 1.9, 1.10**

  - [ ]* 2.5 Write property test for search-query validation
    - **Property 4: Search queries are validated and normalized by kind**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ]* 2.6 Write property test for eligibility comparison
    - **Property 7: Eligibility is strict "end date after today"**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**
    - Generate dates equal to / one day either side of today

  - [ ]* 2.7 Write property test for placement gating
    - **Property 11: Placement is gated solely by a PAID payment status**
    - **Validates: Requirements 5.2, 5.4, 5.5, 5.7**

- [x] 3. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Implement pricing adapter (`src/lib/shop/assisted-order/pricing.ts`)
  - [x] 4.1 Implement `computeAssistedOrderPricing`
    - Define `PricedLine`, `AssistedOrderPricing` (with `deliveryFee: 0`)
    - Wrap `calculateShopOrderBreakdown`; map subtotal/tax/discount/total
    - Force delivery fee to 0 and never add it to the total
    - Resolve each unit price from the server catalog (`sale_price ?? original_price`),
      ignoring any client-supplied price
    - Return an error for empty lines or unresolvable catalog price
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.7_

  - [ ]* 4.2 Write property test for pricing parity
    - **Property 8: Pricing matches customer-checkout breakdown**
    - **Validates: Requirements 4.1, 4.7**

  - [ ]* 4.3 Write property test for zero delivery fee
    - **Property 9: Delivery fee is always zero and excluded from the total**
    - **Validates: Requirements 4.2, 4.3**

  - [ ]* 4.4 Write property test for server-catalog unit price
    - **Property 10: Unit price is resolved from the server catalog**
    - **Validates: Requirements 4.5**

- [x] 5. Implement `AssistedOrderService` search, eligibility, and pricing (`src/services/AssistedOrderService.ts`)
  - [x] 5.1 Implement `searchCustomers`, `checkEligibility`, and `priceCart`
    - Use `createAdminClient`; take a server-trusted `OperatorContext`
    - `searchCustomers`: mobile/name `ILIKE` join to `customer_profiles`, scope filter
      applied in SQL (CORE → `franchise_id IS NULL`; FRANCHISE → matching id), cap 50
      rows ordered by closest match, compute per-row eligibility, shape each result
      with full name and full mobile
    - `checkEligibility`: re-evaluate via `isCustomerEligible` against IST today
    - `priceCart`: resolve catalog lines and delegate to `computeAssistedOrderPricing`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 8.3, 8.4_

  - [ ]* 5.2 Write property test for result shaping
    - **Property 5: Result shaping caps and identifies every match**
    - **Validates: Requirements 2.4**

  - [ ]* 5.3 Write property test for customer scope filtering
    - **Property 6: Customer scope filtering never leaks out-of-scope customers**
    - **Validates: Requirements 2.6, 2.7, 8.3, 8.4**

- [x] 6. Implement target-delivery-date resolution and order placement
  - [x] 6.1 Implement the target delivery date resolver
    - Create `src/lib/shop/assisted-order/delivery-date.ts` computing the earliest
      non-paused active delivery day strictly after Current_IST_Date, using the same
      `getISTDateString` basis as customer checkout / linking; return none when no
      such day exists
    - _Requirements: 6.2, 6.4_

  - [ ]* 6.2 Write property test for target delivery date selection
    - **Property 12: Target delivery date is the earliest upcoming non-paused day**
    - **Validates: Requirements 6.2, 6.4**

  - [x] 6.3 Implement `AssistedOrderService.placeOrder`
    - Re-check authorization + scope, re-validate eligibility, re-price from the
      server catalog, resolve target date (reject when none), gate on PAID status
    - Persist atomically via `place_assisted_addon_order` RPC (status PAID, operator
      id stamped, franchise_id from scope)
    - For franchise orders, run `decrement_franchise_product_stock` per item and
      apply `evaluateFranchiseStockOutcome`; on any un-honored item set
      `fulfillment_status='UNFULFILLABLE_STOCK'` (keep PAID) and `notifyAdmins`
    - Skip any decrement for core (non-franchise) orders
    - Call `runProductLinkingAction(targetDate)` after placement
    - Return a discriminated `{ success }` result; no exceptions escape
    - _Requirements: 5.1, 5.3, 5.6, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [ ]* 6.4 Write property test for franchise id stamping
    - **Property 13: Franchise id is stamped from the operator's scope**
    - **Validates: Requirements 7.2**

  - [ ]* 6.5 Write property test for franchise stock outcome
    - **Property 14: Franchise stock outcome is all-or-nothing**
    - **Validates: Requirements 7.3, 7.4**
    - Reuse `evaluateFranchiseStockOutcome`; generate 0..n per-item failures

  - [ ]* 6.6 Write unit tests for placeOrder side effects
    - Assert Mark-Paid creates a MANUAL/PAID payment carrying the operator identity,
      the placed order has exactly one row with matching items and `status=PAID`,
      `placed_by_user_id` is stamped, and a write failure rolls everything back
    - _Requirements: 5.1, 5.3, 6.1, 6.5_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement per-portal action wrappers and enforcement
  - [x] 8.1 Implement the admin action wrapper
    - Create `src/actions/admin-actions/assistedOrderActions.ts` resolving
      `OperatorContext` via `getCurrentAdminContext()` + `checkGroupManage("customers")`;
      scope always `{ kind: "CORE" }`
    - Expose `searchCustomersAction`, `checkEligibilityAction`, `priceCartAction`,
      `markPaidAndPlaceOrderAction` delegating to `AssistedOrderService`
    - _Requirements: 8.1, 8.2, 8.5, 8.6, 8.7_

  - [x] 8.2 Implement the franchise action wrapper
    - Create `src/actions/franchise-actions/franchiseAssistedOrderActions.ts` resolving
      via `resolveFranchiseContext()`; require `FRANCHISE_ADMIN` with non-null
      `franchise_id`; scope `{ kind: "FRANCHISE", franchiseId }`
    - Expose the same action surface delegating to `AssistedOrderService`
    - _Requirements: 7.1, 7.2, 8.3, 8.6, 8.7_

  - [ ]* 8.3 Write property test for authorization
    - **Property 15: Authorization admits only authorized operators**
    - **Validates: Requirements 8.1, 8.2, 8.8**

  - [ ]* 8.4 Write integration tests for wiring and side effects
    - Against an in-memory fake Supabase client (mirror `shop-linking-*.property.test.ts`):
      catalog parity with `fetchShopProductsForCustomer` (1.7, 1.8), no Razorpay charge
      (5.1), transactional rollback (6.5), linking via `runProductLinkingAction` (6.3),
      no decrement for core orders (7.7), admin notification on oversell (7.6),
      write-scoping by ids (8.6), server-side enforcement independent of UI (8.5, 8.7)
    - _Requirements: 1.7, 1.8, 5.1, 6.3, 6.5, 7.6, 7.7, 8.5, 8.6, 8.7_

- [x] 9. Implement and wire the assisted-order UI
  - [x] 9.1 Implement the shared `AssistedOrderBuilder` component
    - Create `src/shared/components/shop/AssistedOrderBuilder.tsx` (client leaf):
      cart builder → customer search/select → pricing review → Mark-Paid → Place Order
    - Keep Place Order disabled until payment status is PAID (UX affordance; server
      re-checks); surface empty-cart, too-short-query, no-match, and ineligible messages
    - _Requirements: 1.1, 1.3, 1.11, 2.4, 2.5, 3.6, 4.4, 5.2, 5.4_

  - [x] 9.2 Wire the admin portal page
    - Add the admin shop assisted-order page/section rendering `AssistedOrderBuilder`
      bound to the admin action wrapper
    - _Requirements: 7.1, 8.5_

  - [x] 9.3 Wire the franchise portal page
    - Add the franchise shop assisted-order page/section rendering `AssistedOrderBuilder`
      bound to the franchise action wrapper
    - _Requirements: 7.1_

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP;
  core implementation tasks are never optional.
- Each task references specific requirements for traceability.
- Property tests use fast-check with ≥100 runs, each in its own file, tagged with a
  comment: `// Feature: admin-place-shop-order-for-customer, Property {n}: {text}`.
- Checkpoints ensure incremental validation between layers.
- The flow reuses `calculateShopOrderBreakdown`, `getISTDateString`,
  `runProductLinkingAction`, `evaluateFranchiseStockOutcome`, and
  `decrement_franchise_product_stock` rather than re-implementing them.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "4.1", "6.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "2.7", "4.2", "4.3", "4.4", "6.2", "5.1"] },
    { "id": 2, "tasks": ["5.2", "5.3", "6.3"] },
    { "id": 3, "tasks": ["6.4", "6.5", "6.6", "8.1", "8.2"] },
    { "id": 4, "tasks": ["8.3", "8.4", "9.1"] },
    { "id": 5, "tasks": ["9.2", "9.3"] }
  ]
}
```
