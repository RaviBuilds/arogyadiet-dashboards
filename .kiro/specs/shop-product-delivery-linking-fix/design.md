# Shop Product Delivery Linking Fix — Bugfix Design

## Overview

Customers with an ACTIVE meal subscription can buy shop products from the customer
shop. These products are not delivered on their own — they ride along on the
customer's next meal delivery. A nightly cron (`link-products`, ~12:05 AM IST)
runs `runProductLinkingAction(today)` to attach PAID `addon_orders` to that day's
`delivery_orders`, and `executeAutomatedDispatch` then routes/batches the deliveries.

Six defects in the customer-end purchase → link → delivery chain cause a paid
product to be orphaned (never linked, never delivered) or miscounted for kitchen
prep, and allow franchise stock to be oversold. This design formalizes each defect
as a bug condition, defines the corrected behavior, and specifies a fix that is
targeted and minimal while preserving all non-buggy behavior.

The fix strategy has three pillars:

1. **Consistent IST date basis at checkout** — replace UTC calendar math with the
   same `getISTDateString`/IST-instant basis used by the linking cron and all
   operations code, so `target_delivery_date` can never land on a day whose cron
   has already run.
2. **Resilient, roll-forward linking** — never leave a PAID order stranded. When
   the target day has no linkable delivery (paused, ended, advanced past
   `ORDER_CREATED`, or re-run manually), link the order to the customer's next
   available delivery instead, and keep late links reflected in kitchen counts.
3. **Fail-safe franchise stock** — treat a franchise stock decrement failure as an
   unfulfillable item rather than silently completing a PAID order with unavailable
   stock.

This bugfix covers the CUSTOMER-END purchase → link → delivery chain only. The
admin/operations-side review is a planned follow-up and is out of scope.

## Glossary

- **Bug_Condition (C)**: The condition on a purchase/link event that triggers any
  of the six documented defects. Formalized as `isBugCondition(X)` below.
- **Property (P)**: The desired behavior for buggy inputs — every paid product ends
  up on a real delivery, is counted for kitchen prep, and franchise stock is never
  oversold.
- **Preservation**: Existing behavior for non-buggy inputs (subscription gating,
  correct same-day targeting, correct scoped linking, notifications, dispatch) that
  must remain unchanged by the fix.
- **F / F'**: The original (unfixed) flow / the fixed flow.
- **`getISTDateString(offsetDays)`**: Returns `YYYY-MM-DD` in Asia/Kolkata (IST) in
  `src/lib/dates/ist.ts`. The authoritative "today" for all operations code.
- **`processStandaloneCheckout` / `createAddonCheckoutOrder`**: Customer shop
  checkout server actions in `src/actions/shop-actions.ts` that compute
  `target_delivery_date` and create the PENDING `addon_order`.
- **`verifyAddonPayment`**: Server action in `src/actions/shop-actions.ts` that
  marks the payment/order PAID and decrements franchise stock.
- **`runProductLinkingAction`**: Action in
  `src/actions/admin-actions/systemActions.ts` that links PAID `addon_orders` to a
  date's `delivery_orders` in status `ORDER_CREATED`.
- **`executeAutomatedDispatch`**: Routing/batching engine in
  `src/actions/system-actions/routeEngine.ts`, run after linking.
- **`persistWorkloadSnapshots` / `computeClinicShopProductCounts`**: Kitchen
  workload snapshotting in `src/lib/clinic/workload.ts`; counts shop products by
  `delivery_order_id` at snapshot time.
- **`decrement_franchise_product_stock`**: SECURITY DEFINER Postgres RPC
  (`scripts/franchise-product-settings.sql`) that atomically decrements franchise
  stock, returning `false` when stock is insufficient.
- **`target_delivery_date`**: The day the paid product is intended to ride along
  with, stored on `addon_orders`.
- **`delivery_order_id`**: FK on `addon_orders` set when a paid product is linked to
  a concrete delivery; NULL means unlinked.

## Bug Details

### Bug Condition

The bug manifests across the purchase → link → delivery chain when any of six
conditions hold. In each case a customer has paid but the product is either never
linked to a real delivery, is undercounted for kitchen prep, or franchise stock is
oversold. The root of the most damaging case is that checkout computes the "next
active day" from a **UTC** calendar date while the linking cron and all operations
code use an **IST** calendar date, so a checkout between IST midnight and 05:30 IST
targets a day whose cron has already run.

**Formal Specification:**
```
FUNCTION isBugCondition(X)
  INPUT: X of type PurchaseLinkEvent
    // X carries: checkoutInstant, targetDeliveryDate, hasLinkableDeliveryOnTarget,
    //            deliveryStatusOnTarget, dayLaterPausedOrRescheduled, linkedToDelivery,
    //            isManualReRun, linkedAfterWorkloadSnapshot, isFranchise,
    //            franchiseStockDecrementFailed
  OUTPUT: boolean

  RETURN
    // #1/#2 date basis: checkout in IST 00:00–05:30 where UTC lags one IST day
    (istHourOf(X.checkoutInstant) >= 0 AND istHourOf(X.checkoutInstant) < 6
        AND utcDateOf(X.checkoutInstant) <> istDateOf(X.checkoutInstant))
    // #2: paid order whose target date has no linkable delivery
    OR (X.hasLinkableDeliveryOnTarget = false)
    // #3: target day later paused/rescheduled while order still unlinked
    OR (X.dayLaterPausedOrRescheduled = true AND X.linkedToDelivery = false)
    // #4: manual re-run after delivery advanced past ORDER_CREATED
    OR (X.isManualReRun = true AND X.deliveryStatusOnTarget <> "ORDER_CREATED")
    // #5: product linked after the workload snapshot ran
    OR (X.linkedAfterWorkloadSnapshot = true)
    // #6: franchise stock decrement failed but order still PAID
    OR (X.isFranchise = true AND X.franchiseStockDecrementFailed = true)
END FUNCTION
```

### Examples

- **#1 UTC/IST mismatch**: A franchise customer checks out at 01:30 AM IST on
  Jan 12. `new Date().toISOString().split("T")[0]` returns `2025-01-11` (UTC is
  still Jan 11 at 20:00). Checkout selects the next preference date `> 2025-01-11`,
  which can be `2025-01-12` — the very day whose `link-products` cron already ran at
  00:05 IST. The paid `addon_order` is never linked; `delivery_order_id` stays NULL.
  *Expected:* checkout uses IST `2025-01-12` as "today" and targets the next active
  day after it.
- **#2 No delivery on target date**: A customer's `target_delivery_date` is a day
  they later have no `ORDER_CREATED` delivery for (paused, subscription ended, no
  row generated). `runProductLinkingAction` links nothing; the order is stranded.
  *Expected:* the order rolls forward to the customer's next available delivery.
- **#3 Frozen target date**: A customer pauses the exact day chosen as their
  `target_delivery_date` while the order is still unlinked. The order remains bound
  to a day with no delivery. *Expected:* the order re-targets the next active day.
- **#4 Fragile status filter**: Ops re-runs linking to recover a stranded order,
  but that day's deliveries already advanced to `PACKED`/`OUT_FOR_DELIVERY`. The
  `.eq("status","ORDER_CREATED")` filter matches nothing. *Expected:* re-run still
  links outstanding PAID orders to the customer's delivery for that day.
- **#5 Late link undercount**: A product is linked (late payment verification, or
  a manual recovery re-run) after `persistWorkloadSnapshots` already ran. The
  kitchen count for that date omits the product. *Expected:* the count reflects the
  linked product.
- **#6 Oversell**: A franchise customer pays; a concurrent sale means
  `decrement_franchise_product_stock` returns `false`. The order is still marked
  PAID and the failure is only logged. *Expected:* the item is treated as
  unfulfillable for that franchise (no silent PAID with unavailable stock).

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Customers without an ACTIVE meal subscription are still rejected with the
  active-subscription error.
- Customers with no upcoming active (non-paused) delivery day are still rejected
  with the "no upcoming active delivery days" error.
- Checkouts outside the IST midnight–05:30 window (where UTC and IST already agree
  on the calendar day) still target the same next active delivery day as today.
- A PAID order that already has a valid `ORDER_CREATED` delivery on its
  `target_delivery_date` is still linked to that delivery exactly as today.
- Linking still scopes strictly to the customer's own PAID addon orders and the
  customer's own delivery orders (`customer_profile_id` scoping), for core and
  franchise customers alike.
- Franchise purchases with sufficient, visible stock still decrement franchise
  stock and complete as PAID.
- Core (non-franchise) purchases still complete without any franchise stock
  decrement.
- Successfully linked and dispatched orders still send the existing customer and
  admin purchase-confirmation notifications and run routing/batching via
  `executeAutomatedDispatch`.

**Scope:**
All inputs where `isBugCondition(X)` is false must be completely unaffected by this
fix. In particular:
- Checkouts made when UTC and IST agree on the date.
- Orders whose target day already has a linkable `ORDER_CREATED` delivery.
- Core-customer purchases (no franchise stock path).
- Any code path outside the shop purchase → link → delivery chain.

_The concrete corrected behavior for buggy inputs is defined in the Correctness
Properties section (Properties 1–6). This section defines only what must NOT change._

## Hypothesized Root Cause

Based on the defect analysis and the referenced code, the likely causes are:

1. **UTC vs IST date basis at checkout (#1/#2 date root)**: Both
   `processStandaloneCheckout` and `createAddonCheckoutOrder` compute
   `const today = new Date().toISOString().split("T")[0]` — a UTC calendar date —
   and then select the next preference date `> today`. Between IST 00:00 and 05:30
   the UTC date still reads the previous IST day, so the "next active day" can be
   the current IST day, whose linking cron already ran. Every other part of the
   system uses `getISTDateString`, so "today" is inconsistent across the flow.

2. **Point-in-time linking with no roll-forward (#2/#3)**:
   `runProductLinkingAction` links only orders whose `target_delivery_date` equals
   the run's `targetDate` and only to that customer's `ORDER_CREATED` delivery on
   that date. If the target day has no such delivery, `delivery_order_id` stays NULL
   forever — there is no logic to carry an unlinked PAID order forward to the
   customer's next delivery, and no re-evaluation when the target day is later
   paused/rescheduled.

3. **Over-narrow status filter (#4)**: The `.eq("status", "ORDER_CREATED")` filter
   on `delivery_orders` means that once dispatch advances a day's deliveries past
   `ORDER_CREATED`, a manual recovery re-run matches zero deliveries and cannot
   recover stranded orders.

4. **Snapshot ordering vs late links (#5)**: `computeClinicShopProductCounts`
   derives counts from `addon_orders.delivery_order_id` at the instant
   `persistWorkloadSnapshots` runs. Any link established after that instant (late
   payment verification, manual re-run, or roll-forward) is not reflected, so counts
   undercount actual prep.

5. **Best-effort stock decrement (#6)**: In `verifyAddonPayment`, the order is
   marked PAID *before* stock is decremented, and a `false`/error result from
   `decrement_franchise_product_stock` is only logged. The RPC itself is atomic
   (single guarded `UPDATE ... WHERE stock_quantity >= p_quantity`), so the true
   defect is the flow's swallowing of the failure: the order remains PAID with no
   reserved stock, i.e. oversold from the customer's perspective.

## Correctness Properties

Property 1: Bug Condition — IST-consistent target date at checkout

_For any_ checkout instant, including the IST 00:00–05:30 window where the UTC
calendar date lags the IST date, the fixed checkout SHALL compute the upcoming
delivery day from the IST calendar date (consistent with `getISTDateString`), so
`target_delivery_date` is never set to a day whose linking cron has already run for
that IST day, and "today"/"next active day" are consistent with the linking flow.

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition — Roll-forward for unlinkable target dates

_For any_ PAID `addon_order` that cannot be linked to a delivery on its
`target_delivery_date` (day paused, subscription ended, or no delivery row
generated), the fixed linking SHALL link the order to the customer's next available
delivery, so the order is always scheduled onto a real delivery and never left with
`delivery_order_id` NULL indefinitely.

**Validates: Requirements 2.3**

Property 3: Bug Condition — Re-target on pause/reschedule of target day

_For any_ unlinked PAID `addon_order` whose `target_delivery_date` is later paused
or rescheduled, the fixed system SHALL re-evaluate and target the customer's next
available delivery day rather than leaving the order bound to a day with no
delivery.

**Validates: Requirements 2.4**

Property 4: Bug Condition — Recovery re-run past ORDER_CREATED

_For any_ re-run of the linking action intended to recover unlinked PAID orders,
the fixed linking SHALL link outstanding PAID orders to the customer's delivery for
that day even when the delivery has advanced past `ORDER_CREATED`, so re-triggering
can recover orphaned orders.

**Validates: Requirements 2.5**

Property 5: Bug Condition — Kitchen counts reflect late links

_For any_ product linked to a delivery for a given date, including links that occur
after dispatch/snapshotting, the fixed system SHALL ensure the kitchen shop-product
counts for that date reflect the linked product, so counts are not undercounted by
late links.

**Validates: Requirements 2.6**

Property 6: Bug Condition — No franchise oversell

_For any_ franchise purchase where franchise stock cannot be decremented for an
item, the fixed system SHALL treat that item as unfulfillable for the franchise
(preventing oversell) rather than silently completing a PAID order with unavailable
stock.

**Validates: Requirements 2.7**

Property 7: Preservation — Non-buggy inputs are unchanged

_For any_ input where the bug condition does NOT hold (`isBugCondition` returns
false), the fixed flow SHALL produce the same result as the original flow —
preserving subscription/active-day gating, same next-active-day targeting when UTC
and IST agree, correct `customer_profile_id`-scoped linking of already-linkable
orders, core-vs-franchise stock behavior, and the existing notifications and
dispatch.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8**

## Fix Implementation

### Changes Required

Assuming the root cause analysis is correct, the fix touches the checkout actions,
the linking action, the pause/reschedule path, the snapshot ordering, and the
franchise stock path.

**1. IST-consistent checkout date (Defects #1, #2 date root)**

**File**: `src/actions/shop-actions.ts`
**Functions**: `processStandaloneCheckout`, `createAddonCheckoutOrder`

- Replace `const today = new Date().toISOString().split("T")[0];` with
  `const today = getISTDateString(0);` (import from `@/lib/dates/ist`) in both
  functions, so the `.gt("preference_date", today)` query and resulting
  `target_delivery_date` use the same IST calendar day as the linking cron.
- No change to the surrounding query, subscription gating, or error messages —
  only the date basis changes.

**2. Roll-forward linking + robust status filter (Defects #2, #4)**

**File**: `src/actions/admin-actions/systemActions.ts`
**Function**: `runProductLinkingAction`

- Broaden delivery selection so recovery re-runs work: select the customer's
  delivery for `targetDate` whose status is a linkable/active state (e.g. not in a
  terminal `CANCELLED`/`FAILED` set) rather than strictly `ORDER_CREATED`. Keep the
  existing `ORDER_CREATED` deliveries as the primary set, and additionally consider
  advanced-status deliveries for the same customer/date when outstanding PAID orders
  exist.
- Add roll-forward: after the primary same-date linking, find PAID `addon_orders`
  with `delivery_order_id IS NULL` whose `target_delivery_date <= targetDate` and
  link each to that customer's next available delivery on/after `targetDate`. When a
  roll-forward link is made, update the order's `target_delivery_date` to the linked
  delivery's date so state stays consistent.
- Preserve strict `customer_profile_id` scoping on every update (link only the
  customer's own orders to the customer's own deliveries).

**3. Re-target on pause/reschedule (Defect #3)**

**File**: `src/actions/shop-actions.ts` (and the customer pause/reschedule path)

- `updateAddonOrderDeliveryDate` already blocks rescheduling once
  `delivery_order_id` is set; extend the pause/reschedule flow so that when a
  customer pauses or reschedules a day that is the `target_delivery_date` of an
  unlinked PAID order, the order's `target_delivery_date` is re-evaluated to the
  customer's next active delivery day. In practice the roll-forward in change #2
  also recovers these orders at the next link run; this change makes the state
  correct immediately rather than relying on roll-forward.

**4. Keep kitchen counts correct after late links (Defect #5)**

**Files**: `src/app/api/cron/link-products/route.ts`, `src/lib/clinic/workload.ts`

- Ensure `persistWorkloadSnapshots(targetDate)` runs *after* all linking for the
  date completes, including roll-forward links. Since `computeClinicShopProductCounts`
  already recomputes from `addon_orders.delivery_order_id` and
  `persistWorkloadSnapshots` upserts (re-runs overwrite), re-persist the snapshot
  after any late link path (manual recovery re-run, late payment verification that
  links an order) so counts are refreshed to include the late link.

**5. Fail-safe franchise stock decrement (Defect #6)**

**File**: `src/actions/shop-actions.ts`
**Function**: `verifyAddonPayment`

- When `decrement_franchise_product_stock` returns `false` or errors, stop treating
  it as a silent success: mark the affected item/order as unfulfillable for the
  franchise (e.g. flag the order for ops review / refund rather than leaving it
  silently PAID with unavailable stock) and surface the condition to admins.
- The RPC stays the source of atomicity; the flow-level change is to honor its
  `false` result. Preserve behavior when the decrement succeeds and preserve the
  no-decrement path for core orders.

## Testing Strategy

### Validation Approach

Two phases: first surface counterexamples that demonstrate each defect on the
UNFIXED code, then verify the fix works (fix checking) and preserves non-buggy
behavior (preservation checking). Because the flow is heavily IO-bound (Supabase),
pure/derivable logic (IST date basis, roll-forward target selection, status
predicate, fail-safe stock decision) is extracted or exercised so it can be
property-tested without a live database, consistent with the existing property
tests under `src/actions/system-actions/__tests__/`.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bugs BEFORE implementing the
fix, and confirm or refute the root-cause hypotheses. If refuted, re-hypothesize.

**Test Plan**: Drive the checkout date computation and the linking action against
controlled inputs/fakes and assert the buggy outcomes appear on unfixed code.

**Test Cases**:
1. **IST midnight window (#1)**: With a checkout instant at 01:30 AM IST where UTC
   is the previous day, assert the unfixed code computes `today` as the previous IST
   day and can target the current IST day (will fail after fix — must target the IST
   next active day).
2. **No delivery on target (#2)**: A PAID order whose target date has no
   `ORDER_CREATED` delivery — assert unfixed linking leaves `delivery_order_id` NULL
   (will fail after fix).
3. **Pause of target day (#3)**: Pause the target day of an unlinked PAID order —
   assert unfixed code leaves the order bound to the paused day.
4. **Manual re-run past ORDER_CREATED (#4)**: Advance the delivery status and re-run
   linking — assert unfixed code links nothing.
5. **Late link undercount (#5)**: Link a product after snapshotting — assert the
   unfixed count omits it.
6. **Franchise oversell (#6)**: Force `decrement_franchise_product_stock` to return
   `false` — assert unfixed code still completes the order PAID.

**Expected Counterexamples**:
- Checkout in the IST 00:00–05:30 window produces a UTC-based target date.
- PAID orders with `delivery_order_id` NULL after a link run.
- Zero links on a recovery re-run after status advanced.
- Kitchen count lower than the number of linked products.
- PAID franchise order with a failed/false stock decrement.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed flow
produces the expected behavior.

**Pseudocode:**
```
FOR ALL X WHERE isBugCondition(X) DO
  result := runFlow'(X)
  ASSERT result.paidProductLinkedToADelivery = true
     AND result.deliveryOrderId <> NULL
     AND result.kitchenCountReflectsProduct = true
     AND (X.isFranchise = true IMPLIES result.franchiseStockNotOversold = true)
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the
fixed flow produces the same result as the original flow.

**Pseudocode:**
```
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation
checking because it generates many inputs across the domain (checkout instants
where UTC and IST agree, orders already linkable on the target date, core-customer
purchases, successful franchise decrements) and catches edge cases manual tests
miss, giving strong assurance that non-buggy behavior is unchanged.

**Test Plan**: Observe behavior on UNFIXED code for non-buggy inputs first, then
write property-based tests capturing that behavior and re-run against the fix.

**Test Cases**:
1. **Same-day agreement**: For checkout instants where UTC and IST agree on the
   date, the fixed checkout targets the same next active day as unfixed.
2. **Already-linkable order**: A PAID order with an `ORDER_CREATED` delivery on its
   target date links exactly as before.
3. **Scoped linking**: Linking never touches another customer's orders/deliveries,
   for core and franchise customers.
4. **Successful franchise decrement**: A franchise purchase with sufficient stock
   still decrements and completes PAID; a core purchase still completes with no
   decrement.

### Unit Tests

- Checkout date basis returns the IST date in the 00:00–05:30 window and matches
  `getISTDateString(0)`.
- Roll-forward selects the correct next available delivery and updates
  `target_delivery_date`.
- Linkable-delivery status predicate accepts advanced statuses on re-run and rejects
  terminal statuses.
- `verifyAddonPayment` marks an item unfulfillable when the decrement returns
  `false` and leaves core orders unaffected.

### Property-Based Tests

- Generate random checkout instants (across the IST day) and assert the target date
  is always the IST next active day and never a day whose cron has run.
- Generate random subscription/delivery states with missing/advanced deliveries and
  assert every PAID order ends linked to a real delivery (roll-forward invariant).
- Generate random link timings (before/after snapshot) and assert kitchen counts
  always reflect all links for the date.
- Generate concurrent franchise stock scenarios and assert stock never goes negative
  and no PAID order is completed with an undecremented item.

### Integration Tests

- Full flow: checkout at 01:30 AM IST → nightly link → dispatch, asserting the paid
  product is delivered and counted.
- Pause the target day → next link run → assert roll-forward to the next delivery.
- Manual recovery re-run after dispatch advanced statuses → assert stranded orders
  are linked and kitchen counts refresh.
