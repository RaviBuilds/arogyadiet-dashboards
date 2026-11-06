# Flow: Daily Order Generation and Dispatch

Files: `scripts/add-supabase-cron-jobs.sql` → `src/app/api/cron/activate-subscriptions/route.ts` (14:00) → `src/app/api/cron/generate-orders/route.ts` (17:15) → `src/actions/system-actions/orderGeneration.ts` → `src/lib/clinic/workload.ts` → `src/app/api/cron/link-products/route.ts` (23:55 per SQL) → `src/actions/admin-actions/systemActions.ts runProductLinkingAction` → `src/actions/system-actions/routeEngine.ts executeAutomatedDispatch` → `src/lib/routing/googleRoutes.ts` / `src/lib/distance.ts` → `src/lib/automation/logging.ts` → rider pages.

```mermaid
sequenceDiagram
  autonumber
  participant CR as Supabase pg_cron + pg_net
  participant GO as /api/cron/generate-orders
  participant OG as orderGeneration.ts
  participant LP as /api/cron/link-products
  participant SY as systemActions.runProductLinkingAction
  participant RE as routeEngine.executeAutomatedDispatch
  participant G as Google Routes
  participant DB as Postgres
  Note over CR: 11:45 UTC = 17:15 IST
  CR->>GO: GET ?secret=CRON_SECRET (net.http_get, 30s timeout)
  GO->>GO: date must equal tomorrow IST
  GO->>OG: generateDailyOrders(tomorrow)
  OG->>DB: prefs (not paused, sub ACTIVE) -> skip existing -> insert delivery_orders ORDER_CREATED + clinic/franchise stamps
  OG->>DB: automation_logs ORDER_GEN
  GO-->>CR: 200 (main task done)
  GO->>DB: after(): workload snapshot, notify admins, notify customers (sub-tasks)
  Note over CR: 18:25 UTC = 23:55 IST
  CR->>LP: GET ?secret
  LP->>SY: runProductLinkingAction(today IST)
  SY->>DB: link PAID addon_orders to deliveries + roll-forward
  LP-->>CR: 200
  LP->>RE: after(): executeAutomatedDispatch(date)
  RE->>DB: reset re-routable orders, delete orphan PENDING batches
  RE->>DB: per core clinic: orders, pincode->rider, fixed overrides
  RE->>G: computeRoutes TWO_WHEELER (<=20 stops)
  G-->>RE: optimized order + distances (or fail -> Haversine x1.3)
  RE->>DB: insert delivery_batches, update orders ASSIGNED + route_sequence + payout_amount
  RE->>DB: automation_logs ROUTING
  LP->>DB: after(): workload snapshot, dispatch notification
```

Manual recovery: Admin `/operations` → `triggerSystemAutomation("5:15 PM Order Gen" | "Product Linking" | "Routing & Batching", { targetDate })` → same functions with `source = "manual"`, gated by `checkGroupManage("operations")`, allowed for today or tomorrow only.

Retry/halt: no automatic retry in the cron routes (pg_net does not retry). `runDailyPipeline` (retry ×3, halt-on-failure) exists but is used only by tests.

Watch-out: link-products uses today's IST date but runs at 23:55 IST per the SQL file; confirm the live schedule (`SELECT jobname, schedule FROM cron.job`).
