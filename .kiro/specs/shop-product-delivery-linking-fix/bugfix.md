# Bugfix Requirements Document

## Introduction

ArogyaDiet customers with an ACTIVE meal subscription can buy shop products from the customer shop (`customer.localhost:3000/shop`). These products are not delivered on their own — they piggyback on the customer's next meal delivery. A nightly cron (`link-products`, ~12:05 AM IST) runs `runProductLinkingAction(today)` to link PAID `addon_orders` to that day's `delivery_orders`, after which `executeAutomatedDispatch` performs routing/batching.

Several defects in the customer-end purchase → link → delivery chain cause a customer to pay for a product that is then never delivered (or is miscounted for kitchen prep). The most damaging is a UTC-vs-IST date mismatch that can target a delivery day whose linking cron has already run, so the paid order is orphaned. Related defects leave paid orders permanently unlinked when the target day has no delivery, freeze the target date at purchase time, and cause fragile recovery on manual re-runs. This applies to both core-business and franchise customers.

This bugfix covers the CUSTOMER-END purchase → link → delivery chain only. The admin/operations-side review is a planned follow-up and is out of scope for this spec.

## Bug Analysis

### Current Behavior (Defect)

Defect #1 — UTC vs IST date mismatch at checkout:

1.1 WHEN a customer completes checkout during the window between IST midnight (12:00 AM) and 05:30 IST THEN the system computes the "next active day" using a UTC calendar date (`new Date().toISOString().split("T")[0]`), which still reads the previous IST calendar day, so `target_delivery_date` can be set to a day whose `link-products` cron has already run, and the paid `addon_order` is never linked to a delivery and never delivered.

1.2 WHEN checkout computes the upcoming delivery day THEN the system uses a different date basis (UTC) than `runProductLinkingAction` and all operations code (IST via `getISTDateString`), producing an inconsistent notion of "today" across the purchase and linking flow.

Defect #2 — Paid product silently lost when no delivery exists on the target date:

1.3 WHEN a PAID `addon_order` has a `target_delivery_date` for which no `delivery_orders` row exists in status `ORDER_CREATED` (customer paused that exact day, the subscription ended, or no delivery row was generated) THEN `runProductLinkingAction` links nothing for that order and its `delivery_order_id` stays NULL permanently, with no roll-forward or re-link to the customer's next available delivery — the customer has paid but the product is never delivered.

Defect #3 — `target_delivery_date` frozen at purchase time:

1.4 WHEN a customer pauses or reschedules the day that was chosen as their `target_delivery_date` at purchase time THEN the system does not re-evaluate the paid order's target date, so the order remains bound to a day that no longer has a delivery, compounding the orphaning in 1.3.

Defect #4 — `ORDER_CREATED` status filter fragile on manual re-runs:

1.5 WHEN `runProductLinkingAction` is re-run manually after dispatch has already advanced that day's `delivery_orders` past `ORDER_CREATED` THEN the status filter matches no deliveries and links nothing, so previously unlinked PAID orders cannot be recovered by re-triggering the linking action.

Defect #5 — Kitchen workload count misses late links:

1.6 WHEN a product is linked (or paid and linked) after `persistWorkloadSnapshots` / `computeClinicShopProductCounts` has already run in the same post-dispatch `after()` chain THEN the kitchen workload snapshot counts products by `delivery_order_id` at snapshot time and does not reflect the later link, so kitchen shop-product counts undercount what must actually be prepared.

Defect #6 — Franchise stock decrement is non-atomic/best-effort:

1.7 WHEN a franchise customer's payment is verified in `verifyAddonPayment` and `decrement_franchise_product_stock` fails or returns `false` (e.g. concurrent sale) THEN the system only logs the failure and still completes the order as PAID, allowing franchise stock to be oversold.

### Expected Behavior (Correct)

2.1 WHEN a customer completes checkout at any time of day, including between IST midnight and 05:30 IST THEN the system SHALL compute the upcoming delivery day using the IST calendar date (consistent with `getISTDateString`), so `target_delivery_date` is never set to a day whose linking cron has already run for that IST day.

2.2 WHEN checkout computes the upcoming delivery day THEN the system SHALL use the same IST date basis as `runProductLinkingAction` and operations code, so "today" and "next active day" are consistent across the purchase and linking flow.

2.3 WHEN a PAID `addon_order` cannot be linked to a `delivery_orders` row on its `target_delivery_date` (day paused, subscription ended, or no delivery row generated) THEN the system SHALL roll the order forward and link it to the customer's next available delivery, so a paid product is always scheduled onto a real delivery and is never left with `delivery_order_id` NULL indefinitely.

2.4 WHEN a customer pauses or reschedules the day previously chosen as a paid order's `target_delivery_date` AND the order is not yet linked to a delivery THEN the system SHALL re-evaluate and target the customer's next available delivery day rather than leaving the order bound to a day with no delivery.

2.5 WHEN `runProductLinkingAction` is re-run to recover unlinked PAID orders THEN the system SHALL link outstanding PAID orders to the customer's delivery for that day even if the delivery has advanced past `ORDER_CREATED`, so re-triggering can recover orphaned orders.

2.6 WHEN a product is linked to a delivery for a given date, including links that occur after dispatch THEN the system SHALL ensure the kitchen shop-product counts for that date reflect the linked product, so kitchen counts are not undercounted by late links.

2.7 WHEN a franchise customer's payment is verified AND franchise stock cannot be decremented for a purchased item THEN the system SHALL treat the item as unfulfillable for that franchise (prevent overselling) rather than silently completing a PAID order with unavailable stock.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a customer without an ACTIVE meal subscription attempts to purchase shop products THEN the system SHALL CONTINUE TO reject the purchase with the active-subscription error.

3.2 WHEN a customer has no upcoming active (non-paused) delivery day THEN the system SHALL CONTINUE TO reject the purchase with the "no upcoming active delivery days" error.

3.3 WHEN a customer completes checkout outside the IST midnight–05:30 window (when UTC and IST already agree on the calendar day) THEN the system SHALL CONTINUE TO target the same next active delivery day it targets today.

3.4 WHEN a PAID `addon_order` has a valid `delivery_orders` row in `ORDER_CREATED` status on its `target_delivery_date` THEN the nightly `runProductLinkingAction` SHALL CONTINUE TO link the order to that delivery exactly as it does today.

3.5 WHEN linking runs for a customer THEN the system SHALL CONTINUE TO only link that customer's own PAID addon orders to that customer's own delivery orders (correct `customer_profile_id` scoping), for both core and franchise customers.

3.6 WHEN a franchise customer purchases items that are visible and have sufficient franchise stock THEN the system SHALL CONTINUE TO decrement franchise stock and complete the order as PAID.

3.7 WHEN a core (non-franchise) customer purchases products THEN the system SHALL CONTINUE TO complete the order without any franchise stock decrement.

3.8 WHEN a paid order is successfully linked and dispatched THEN the system SHALL CONTINUE TO send the existing customer and admin purchase-confirmation notifications and run routing/batching via `executeAutomatedDispatch`.

## Bug Condition Specification

**Key Definitions:**
- **F**: The original (unfixed) purchase → link → delivery flow.
- **F'**: The fixed flow.

**Bug Condition Function** — identifies inputs (a purchase/link event) that trigger any of the defects:

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type PurchaseLinkEvent
    // X carries: checkoutInstantIST, targetDeliveryDate, hasDeliveryOrderOnTarget,
    //            deliveryStatusOnTarget, dayLaterPausedOrRescheduled, isManualReRun,
    //            linkedAfterWorkloadSnapshot, isFranchise, franchiseStockDecrementFailed
  OUTPUT: boolean

  RETURN
    // #1: checkout in IST 00:00–05:30 where UTC lags to previous IST day
    (istTimeOfDay(X.checkoutInstantIST) >= 00:00 AND istTimeOfDay(X.checkoutInstantIST) < 05:30)
    // #2: paid order whose target date has no linkable ORDER_CREATED delivery
    OR (X.hasDeliveryOrderOnTarget = false)
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

**Property (Fix Checking)** — desired behavior for buggy inputs:

```pascal
// Property: every paid product ends up on a real delivery, counted, and not oversold
FOR ALL X WHERE isBugCondition(X) DO
  result ← runFlow'(X)
  ASSERT result.paidProductLinkedToADelivery = true
     AND result.deliveryOrderId <> NULL
     AND result.kitchenCountReflectsProduct = true
     AND (X.isFranchise = true IMPLIES result.franchiseStockNotOversold = true)
END FOR
```

**Preservation (Preservation Checking)** — non-buggy inputs behave identically:

```pascal
// Property: Preservation Checking
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
END FOR
```
