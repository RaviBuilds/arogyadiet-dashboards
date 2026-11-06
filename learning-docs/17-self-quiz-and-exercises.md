# 17 — Self-Quiz and Exercises

Do these without looking, then check the answers at the bottom. All exercises are read-only: open files, read, explain. Do not edit code.

## A. Trace without looking (write the file chain)
A1. Customer pauses a day in the planner.
A2. Franchise operator clicks "Confirm Received".
A3. A shop order paid while the phone switched to GPay and the app was killed.
A4. Tomorrow's delivery orders get created.
A5. A rider's location appears on the customer's map.
A6. Master creates an operations admin with "customers: view".
A7. A KIT customer logs a skipped day.
A8. An admin re-runs routing for today.

## B. Fill in the flow
B1. `middleware.ts` → ____ → `page.tsx` (RSC) → client component → ____ → zod → ____ → `supabase.rpc(...)`.
B2. Subscription activation path when the Checkout.js handler fires: `verifyAndActivateSubscriptionAction` checks ____ then calls ____.
B3. The function that decides whether a path is allowed for an access configuration is ____ in ____.
B4. The franchise owner is detected by comparing ____ with ____.
B5. Dispatch caps each rider at ____ stops and falls back to ____ when Google fails.
B6. The cron job that runs every 5 minutes is ____ and it reads ____ to decide staleness.
B7. The KIT end date is recomputed by ____ (type of DB object) on table ____.
B8. Customer category reaches the sidebar via header ____ set in ____.
B9. Shop orders store the internal payment id in Razorpay ____ so the ____ can find it.
B10. The editability of report cards is defined by the SQL view ____.

## C. Short answers
C1. Why does middleware not call `set_franchise_context`?
C2. Name three places tenancy (franchise id) is enforced for a franchise inventory receive.
C3. What makes `generateDailyOrders` safe to re-run?
C4. Which two cron routes contain hard-coded secret fallbacks?
C5. Which column mismatch affects rider payouts?
C6. Why is the background-geolocation module aliased in `next.config.ts`?
C7. What does `head: true` do in a supabase-js select?
C8. Why do some SQL functions return `{ ok, reason }` instead of raising?
C9. What is the difference between `hasGroupAccess` and `canManageGroup`?
C10. Why is `FRANCHISE_USER_ACCESS_LEVELS` defined in `adminAccessCore.ts` and not in the action file?

## D. Code-reading challenges (read-only)
D1. Open `src/lib/auth/adminAccessCore.ts`. What does `toCanonicalPath("/franchise/orders/42", "/franchise")` return?
D2. Open `src/lib/dates/ist.ts`. At 17:30 IST on 2026-11-02, is a change to 2026-11-03 locked?
D3. Open `scripts/create-dispatch-to-franchise-rpc.sql`. Which ORDER BY implements FIFO, and what prevents concurrent depletion?
D4. Open `src/actions/system-actions/routeEngine.ts`. Which order statuses are reset before routing?
D5. Open `src/app/api/webhooks/razorpay/route.ts`. Which two events are processed, and what is returned for others?
D6. Open `src/middleware.ts`. Which customer routes are blocked for MEAL customers?
D7. Open `src/services/PinThrottleService.ts`. What are the limit and lockout duration?
D8. Open `src/actions/admin-actions/systemActions.ts`. Under what condition does `runProductLinkingAction` check permissions?

---

## Answers

**A1.** `planner/page.tsx` → `meal-planner-client.tsx` → `manageMealActions.bulkUpdatePausePreferencesAction` → `assertOwnsSubscription`, `assertMealSubscription`, `findCutoffLockedDate` (`isPastNextDayCutoff`) → `processPausePreferenceUpdates` → `executePauseReconciliationEngine` → `cascadePendingSubscriptionDates` → `retargetUnlinkedAddonOrdersForPausedDates` → notifications → `revalidatePath` → `router.refresh()`.
**A2.** middleware (franchies) → `franchise/(main)/layout.tsx` → `inventory/page.tsx` → `ReceiveTransferControls.tsx` → `franchiseInventoryActions.receiveTransferAction` → `resolveScope` → `transferActionInputSchema` → `franchiseInventoryEngine.receiveTransfer` → RPC `receive_franchise_transfer`.
**A3.** `createAddonCheckoutOrder` created PENDING rows + Razorpay order with `notes.payment_id` → Razorpay webhook → `/api/webhooks/razorpay` → HMAC check → idempotency → `razorpay_transactions`, payments PAID, addon_orders PAID, franchise stock RPC → notifications → nightly link-products.
**A4.** pg_cron 11:45 UTC → `/api/cron/generate-orders` → secret check + tomorrow check → `orderGeneration.generateDailyOrders` → insert `delivery_orders` → `automation_logs` → `after()` snapshot + notifications.
**A5.** Native `LocationForegroundService` → `LocationQueue` → `SyncWorker` → `SupabaseUploader` → RPC `upsert_rider_live_location` → Realtime → `LiveTrackingMap.tsx`.
**A6.** `UserManagement.tsx` → `master-actions/adminActions.createAdminUser` → validate (`validateOperationsAccessInput`) → `auth.admin.createUser` → insert `users` with level `operations` and `{customers: "view"}` → middleware `isPortalPathAllowed` on next request.
**A7.** `kit-tracker/page.tsx` → `kitTrackerActions.saveDailyLogAction` → insert `kit_daily_logs` status FOOD_SKIPPED → trigger `trg_kit_daily_logs_sync` → `subscriptions.kit_total_skipped_days`, `kit_tracker_end_date`.
**A8.** `operations/page.tsx` → `triggerSystemAutomation("Routing & Batching", { targetDate })` → `checkGroupManage("operations")` → `executeAutomatedDispatch(date, undefined, "manual")` → `persistWorkloadSnapshots` → `logAdminAction`.

**B1.** layout (`(main)/layout.tsx`); Server Action; service. **B2.** HMAC-SHA256 of `order_id|payment_id` with `RAZORPAY_KEY_SECRET`; `activateSubscription`. **B3.** `isPortalPathAllowed`; `src/lib/auth/adminAccessCore.ts`. **B4.** `franchises.owner_user_id`; `users.id`. **B5.** 20; Haversine (×1.3 road factor). **B6.** auto-off-duty-sweep; `rider_live_locations.updated_at` (floored by `last_online_at`). **B7.** trigger (`kit_tracker_sync_skip_count`); `kit_daily_logs`. **B8.** `x-customer-category`; `src/middleware.ts`. **B9.** `notes`; webhook. **B10.** `v_report_card_editability`.

**C1.** `set_config(..., true)` is transaction-local and each PostgREST request is a separate transaction, so it would not affect later queries; and middleware can't use the `next/headers` client.
**C2.** `resolveScope()` in the action (session), passing `scope.franchise_id` (not client input) to the engine, and the RPC's `dest_franchise_id = p_franchise_id` check (plus middleware/layout franchise gate).
**C3.** It loads existing orders for the date and skips matching `customer_profile_id:meal_category_id` keys.
**C4.** `generate-rider-payments` (fallback literal when env unset) and `cleanup-dispatch-images` (accepts a literal).
**C5.** Writers set `total_earnings`; leaderboard/dashboard read `net_payable`.
**C6.** So the web build compiles on Vercel without native code; the stub forwards to Capacitor's `registerPlugin` in the APK.
**C7.** Returns only the count (with `count: "exact"`), no rows.
**C8.** So the action can map each `reason` to a fixed user message without parsing Postgres errors (partial payment and stay RPCs).
**C9.** `hasGroupAccess` = view or manage (read allowed); `canManageGroup` = manage only (write allowed).
**C10.** A `"use server"` file may export only async functions; exporting an array crashed all actions in that bundle at runtime.

**D1.** `/admin/operations/42` (alias `/franchise/orders` → `/admin/operations`).
**D2.** Yes. After 17:00 the earliest editable date is today + 2 = 2026-11-04, so 2026-11-03 is locked.
**D3.** `ORDER BY expiry_date ASC, created_at ASC` with `FOR UPDATE` row locks inside one function transaction.
**D4.** `ORDER_CREATED`, `MEAL_PREPARED`, `ASSIGNED` (`RE_ROUTABLE_STATUSES`).
**D5.** `payment.captured` and `order.paid`; others get `200 { received: true }`.
**D6.** `/kit-tracker`, `/kit-history`, `/stay-tracker`, `/stay-history`, `/health-report`, `/addon-services`.
**D7.** 5 failed attempts → 900 seconds (15 minutes).
**D8.** Only when `source === "manual"`.
