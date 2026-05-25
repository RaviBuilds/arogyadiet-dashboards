# Core Business Logic & Constraints

This document defines the strict, non-negotiable business rules and logic engines that govern the core operations of the application, specifically focusing on meal management, calendar reconciliation, and delivery routing.

---

## 1. The 5 PM Cutoff Rule

The 5 PM (17:00 IST) cutoff is a critical operational constraint designed to give the kitchen and routing systems adequate lead time to prepare meals and assign deliveries.

**The Rule:**
*   Any changes made to a subscription's upcoming schedule (such as modifying meal choices, pausing a day, or changing a delivery address) can only affect **tomorrow** if the change is submitted **before 5:00 PM today**.
*   If the change is submitted **at or after 5:00 PM**, the earliest day that can be modified is the **day after tomorrow**.

**Implementation in Code:**
Across the application (in both customer and admin interfaces, such as `meal-planner-client.tsx`, `pause-client.tsx`, and checkout flows), you will see this consistent logic used to determine the `minEditableDate`:
```javascript
// If it's past 17:00 (5 PM), we need 2 days lead time. Otherwise, 1 day.
const currentHour = new Date().getHours();
const daysToAdd = currentHour >= 17 ? 2 : 1;
const minEditableDate = startOfDay(addDays(new Date(), daysToAdd));
```
Dates before `minEditableDate` are completely locked in the UI and cannot be altered by either the customer or the admin.

---

## 2. The Pause Reconciliation Engine

Subscriptions are based on a fixed number of delivery days (e.g., 30 days of food), not a fixed end date. When a user pauses their subscription, the end date must dynamically shift to ensure they receive all the meals they paid for. This is handled by the **Pause Reconciliation Engine** (located in `src/actions/manageMealActions.ts` and admin equivalents).

**How it Works:**
Whenever a pause preference is toggled (added or removed), the engine rebuilds the user's delivery calendar from scratch:

1.  **Iterative Rebuilding:** The engine starts at the subscription's `starts_on` date and iterates day by day.
2.  **Skipping Paused Days:** It checks the `subscription_daily_preferences` table for each date. If a date is marked as `is_paused = true`, it does **not** increment the delivered days counter. The loop pushes further into the future.
3.  **Targeting Total Days:** The loop continues until the number of valid (unpaused) delivery days matches the subscription's `total_days`. The date it lands on becomes the new `effective_end_on`.
4.  **Database Reconciliation:** 
    *   **Inserts:** If the calendar expands (due to new pauses), it inserts new preference rows at the end of the calendar.
    *   **Deletions:** If the calendar shrinks (due to unpausing previously paused days), it deletes the extraneous preference rows at the end.
5.  **Usage Tracking:** It strictly recalculates the `pause_credits_used` by counting the exact number of paused rows to ensure limits are enforced accurately.

---

## 3. Delivery Routing Constraints

The system automates the grouping of delivery orders into `delivery_batches` and calculates payouts for riders based on distance. This logic is housed in `src/actions/admin-actions/routingActions.ts`.

**Distance Calculation:**
*   **Haversine Formula:** The system uses the Haversine formula to calculate the straight-line ("as the crow flies") distance between GPS coordinates (latitude and longitude).
*   **Road Distance Multiplier:** Because direct lines do not account for road networks, the straight-line distance is multiplied by **`1.3`** to estimate the actual road distance.

**Batching & Payout Logic (`commitRouteChanges`):**
1.  **Grouping:** Orders assigned to the same rider are grouped into a single `batch_id`.
2.  **Sequencing:** Orders within a batch are assigned a `route_sequence` (1, 2, 3...) based on the order they are processed.
3.  **Cumulative Distance:** For a given rider's batch, the system calculates the distance from the Kitchen to the first delivery address, and then from the first delivery address to the second, and so on.
4.  **Dynamic Payouts:** For each leg of the journey, an expected payout is calculated: `roadDistance * rider_payout_per_km`. The global rate (defaulting to ₹16.00 per km) is fetched from `system_settings`.
5.  **Commit:** The total distance (`total_distance_km`) and total expected earnings (`expected_payout`) are saved to the `delivery_batches` table, providing transparent earning metrics for the riders.