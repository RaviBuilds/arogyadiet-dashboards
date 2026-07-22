# Implementation Plan

## Overview

This plan follows the bugfix methodology: write exploration tests that FAIL on the unfixed code to confirm the six documented defects (Property 1: Bug Condition), write preservation tests that PASS on the unfixed code to lock in non-buggy behavior (Property 2: Preservation), then apply the targeted fix across the checkout, linking, pause/reschedule, kitchen-count, and franchise-stock paths, and finally re-run both test suites to confirm fix checking and preservation checking.

## Task Dependency Graph

- Task 1 (exploration tests) and Task 2 (preservation tests) must be completed before any fix work in Task 3.
- Tasks 3.1–3.5 (the fix changes) can proceed once Tasks 1 and 2 are done; they are largely independent but share files (`src/actions/shop-actions.ts`).
- Tasks 3.6 and 3.7 (verification) depend on all of 3.1–3.5 being complete.
- Task 4 (checkpoint) depends on 3.6 and 3.7.

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"], "description": "Write exploration and preservation tests before any fix" },
    { "wave": 2, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5"], "description": "Apply the targeted fixes across checkout, linking, pause/reschedule, kitchen counts, and franchise stock" },
    { "wave": 3, "tasks": ["3.6", "3.7"], "description": "Verify exploration tests now pass and preservation tests still pass" },
    { "wave": 4, "tasks": ["4"], "description": "Checkpoint - full suite and lint" }
  ]
}
```

## Tasks

- [x] 1. Write bug condition exploration tests
  - **Property 1: Bug Condition** - Paid Shop Product Orphaned / Miscounted / Oversold
  - **CRITICAL**: These tests MUST FAIL on unfixed code - failure confirms the bugs exist
  - **DO NOT attempt to fix the tests or the code when they fail**
  - **NOTE**: These tests encode the expected behavior - they will validate the fix when they pass after implementation
  - **GOAL**: Surface counterexamples that demonstrate each defect in the purchase → link → delivery chain
  - **Scoped PBT Approach**: For deterministic defects, scope each property to the concrete failing case(s) so they reproduce reliably; use generated inputs where the domain is broad (e.g. checkout instants across the IST day)
  - Extract/exercise the pure or derivable logic (IST date basis at checkout, roll-forward target selection, linkable-status predicate, fail-safe stock decision) so it can be property-tested without a live Supabase database, consistent with existing tests under `src/actions/system-actions/__tests__/`
  - Test the bug condition from `isBugCondition(X)` in design (any of the six sub-conditions triggers the defect):
    - #1 IST/UTC mismatch: checkout instant at 01:30 AM IST where UTC still reads the previous day — assert unfixed `new Date().toISOString().split("T")[0]` yields the previous IST day and can target a day whose linking cron already ran
    - #2 No linkable delivery on target: a PAID `addon_order` whose `target_delivery_date` has no `ORDER_CREATED` delivery — assert unfixed `runProductLinkingAction` leaves `delivery_order_id` NULL
    - #3 Target day paused/rescheduled while unlinked — assert unfixed code leaves the order bound to the paused day
    - #4 Manual re-run after delivery advanced past `ORDER_CREATED` — assert unfixed `.eq("status","ORDER_CREATED")` filter links nothing
    - #5 Product linked after `persistWorkloadSnapshots` ran — assert unfixed kitchen count omits the late link
    - #6 Franchise stock decrement returns `false`/errors — assert unfixed `verifyAddonPayment` still completes the order as PAID
  - The test assertions should match the Expected Behavior / Correctness Properties from design (paid product ends linked to a real delivery, `delivery_order_id` not NULL, kitchen count reflects the product, franchise stock not oversold)
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests FAIL (this is correct - it proves the bugs exist)
  - Document counterexamples found to understand root cause (UTC-based target date in the IST 00:00–05:30 window, PAID orders with NULL `delivery_order_id` after a link run, zero links on a recovery re-run, kitchen count lower than linked products, PAID franchise order with a failed stock decrement)
  - Mark task complete when tests are written, run, and failures are documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Buggy Purchase → Link → Delivery Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for non-buggy inputs (cases where `isBugCondition(X)` returns false) and record actual outputs first:
    - Observe: checkout instants where UTC and IST agree on the date target the same next active delivery day
    - Observe: a PAID order with an `ORDER_CREATED` delivery on its `target_delivery_date` links to that delivery
    - Observe: linking only touches the customer's own PAID orders / own delivery orders (`customer_profile_id` scoping), for core and franchise customers
    - Observe: a franchise purchase with sufficient visible stock decrements stock and completes PAID; a core purchase completes with no franchise decrement
    - Observe: successfully linked/dispatched orders send the existing customer + admin notifications and run `executeAutomatedDispatch`
  - Write property-based tests capturing observed behavior patterns from the Preservation Requirements in design (generate checkout instants where UTC/IST agree, orders already linkable on target date, core-customer purchases, successful franchise decrements)
  - Property-based testing generates many test cases for stronger guarantees that non-buggy behavior is unchanged
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 3. Fix for orphaned/miscounted/oversold shop products in the purchase → link → delivery chain

  - [x] 3.1 IST-consistent checkout date (Defects #1, #2 date root)
    - In `src/actions/shop-actions.ts`, functions `processStandaloneCheckout` and `createAddonCheckoutOrder`, replace `const today = new Date().toISOString().split("T")[0];` with `const today = getISTDateString(0);` (import from `@/lib/dates/ist`)
    - Ensure the `.gt("preference_date", today)` query and resulting `target_delivery_date` use the same IST calendar day as the linking cron
    - Do not change surrounding query, subscription gating, or error messages — only the date basis
    - _Bug_Condition: isBugCondition(X) where checkout is in IST 00:00–05:30 and utcDateOf(X) <> istDateOf(X)_
    - _Expected_Behavior: Property 1 — IST-consistent target date at checkout (target date never a day whose cron already ran)_
    - _Preservation: Property 7 — checkouts where UTC/IST agree target the same next active day_
    - _Requirements: 2.1, 2.2_

  - [x] 3.2 Roll-forward linking + robust status filter (Defects #2, #4)
    - In `src/actions/admin-actions/systemActions.ts`, function `runProductLinkingAction`, broaden delivery selection so recovery re-runs work: consider the customer's delivery for `targetDate` in linkable/active states (not only strictly `ORDER_CREATED`, excluding terminal `CANCELLED`/`FAILED`); keep `ORDER_CREATED` deliveries as the primary set
    - Add roll-forward: after same-date linking, find PAID `addon_orders` with `delivery_order_id IS NULL` and `target_delivery_date <= targetDate`, and link each to that customer's next available delivery on/after `targetDate`; update the order's `target_delivery_date` to the linked delivery's date
    - Preserve strict `customer_profile_id` scoping on every update
    - _Bug_Condition: isBugCondition(X) where hasLinkableDeliveryOnTarget = false OR (isManualReRun AND deliveryStatusOnTarget <> "ORDER_CREATED")_
    - _Expected_Behavior: Property 2 (roll-forward to next available delivery) and Property 4 (recovery re-run links past ORDER_CREATED)_
    - _Preservation: Property 7 — already-linkable orders on target date still link exactly as today; scoped linking unchanged_
    - _Requirements: 2.3, 2.5_

  - [x] 3.3 Re-target on pause/reschedule of target day (Defect #3)
    - In `src/actions/shop-actions.ts` and the customer pause/reschedule path, extend the flow so that when a customer pauses or reschedules a day that is the `target_delivery_date` of an unlinked PAID order, the order's `target_delivery_date` is re-evaluated to the customer's next active delivery day
    - Keep the existing `updateAddonOrderDeliveryDate` guard that blocks rescheduling once `delivery_order_id` is set
    - _Bug_Condition: isBugCondition(X) where dayLaterPausedOrRescheduled = true AND linkedToDelivery = false_
    - _Expected_Behavior: Property 3 — re-target unlinked PAID order to the next available delivery day_
    - _Preservation: Property 7 — linked orders and non-target-day pauses behave as today_
    - _Requirements: 2.4_

  - [x] 3.4 Keep kitchen counts correct after late links (Defect #5)
    - In `src/app/api/cron/link-products/route.ts` and `src/lib/clinic/workload.ts`, ensure `persistWorkloadSnapshots(targetDate)` runs after all linking for the date completes, including roll-forward links
    - Re-persist the snapshot after any late-link path (manual recovery re-run, late payment verification that links an order) so `computeClinicShopProductCounts` recomputes counts from `addon_orders.delivery_order_id` and reflects the late link
    - _Bug_Condition: isBugCondition(X) where linkedAfterWorkloadSnapshot = true_
    - _Expected_Behavior: Property 5 — kitchen shop-product counts reflect linked products including late links_
    - _Preservation: Property 7 — counts for links present at snapshot time are unchanged_
    - _Requirements: 2.6_

  - [x] 3.5 Fail-safe franchise stock decrement (Defect #6)
    - In `src/actions/shop-actions.ts`, function `verifyAddonPayment`, when `decrement_franchise_product_stock` returns `false` or errors, stop treating it as a silent success: mark the affected item/order as unfulfillable for the franchise (flag for ops review / refund rather than leaving it silently PAID with unavailable stock) and surface the condition to admins
    - Keep the RPC as the source of atomicity; honor its `false` result at the flow level
    - Preserve behavior when the decrement succeeds and preserve the no-decrement path for core orders
    - _Bug_Condition: isBugCondition(X) where isFranchise = true AND franchiseStockDecrementFailed = true_
    - _Expected_Behavior: Property 6 — franchise item treated as unfulfillable, no oversell_
    - _Preservation: Property 7 — successful decrements and core (no-decrement) purchases unchanged_
    - _Requirements: 2.7_

  - [x] 3.6 Verify bug condition exploration tests now pass
    - **Property 1: Expected Behavior** - Paid Shop Product Linked, Counted, Not Oversold
    - **IMPORTANT**: Re-run the SAME tests from task 1 - do NOT write new tests
    - The tests from task 1 encode the expected behavior across all six defects
    - When these tests pass, they confirm the expected behavior is satisfied (paid product linked to a real delivery, `delivery_order_id` not NULL, kitchen count reflects the product, franchise stock not oversold)
    - Run bug condition exploration tests from step 1
    - **EXPECTED OUTCOME**: Tests PASS (confirms bugs are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 3.7 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Buggy Purchase → Link → Delivery Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the full test suite (`src/actions/system-actions/__tests__/` and any new test files) to confirm exploration tests now pass, preservation tests still pass, and no other tests regressed
  - Run `npm run lint` to confirm no lint/type issues introduced
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Property 1 (Bug Condition) exploration tests in Task 1 MUST fail on unfixed code; Property 2 (Preservation) tests in Task 2 MUST pass on unfixed code. Do not fix the code to make Task 1 pass prematurely.
- The flow is IO-bound (Supabase). Extract or exercise the pure/derivable logic — IST date basis, roll-forward target selection, linkable-status predicate, fail-safe stock decision — so properties can be tested without a live database, consistent with existing tests under `src/actions/system-actions/__tests__/`.
- All fixes must preserve `customer_profile_id` scoping and the existing notification/dispatch behavior.
- The admin/operations-side review is out of scope for this spec (planned follow-up).
