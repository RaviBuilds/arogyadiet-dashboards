# ArogyaDiet — Business Workflows

> End-to-end flows supported by actual implementation. All steps trace to verified code. Diagram E/F are the required main diagrams.

## 1. Diagram E — Daily Delivery Flow (order → payout)

```mermaid
sequenceDiagram
    participant PG as Supabase pg_cron
    participant Pipe as runDailyPipeline()<br/>(actions/system-actions/dailyPipeline.ts)
    participant OG as generateDailyOrders()
    participant LP as linkDailyShopPurchases()
    participant WS as finalizeWorkloadSnapshot()
    participant AD as executeAutomatedDispatch()
    participant DB as Postgres
    participant Rider as Rider App (APK)
    participant Cust as Customer Portal
    participant Pay as generate-rider-payments cron

    Note over PG: generate-orders 17:15 IST,<br/>link-products 23:55 IST (UTC schedules)
    PG->>Pipe: GET /api/cron/generate-orders?secret=...
    Pipe->>OG: 1. create delivery_orders (retry x3)
    Pipe->>LP: 2. link addon_orders → delivery_orders (retry x3)
    Pipe->>WS: 3. finalize per-clinic workload_snapshots
    Pipe->>AD: 4. assign riders by pincode, build routes
    AD->>DB: delivery_batches + route_sequence + payout_amount (rate_configs / system_settings.rider_payout_per_km)
    Note over Pipe: Halt-on-failure; prior step outputs preserved (PipelineResult.steps, failedStep)
    Rider->>DB: pickup → OUT_FOR_DELIVERY → REACHING_TO_LOCATION → DELIVERED
    Rider->>DB: background GPS → rider_live_locations (SupabaseUploader)
    Cust->>Cust: tracking/[orderId] reads rider location + delivery_status_logs
    Pay->>DB: monthly rollup of DELIVERED payout_amount → rider_monthly_summaries ⚠️ (writes total_earnings; UI reads net_payable)
```

Verification notes: pipeline semantics (4 steps, halt-on-failure, retry policy Req 11.6–11.8) read directly from `dailyPipeline.ts`. The `net_payable` mismatch is flagged in `AROGYADIET_DASHBOARDS_FEATURES.md` §12 and remains `UNVERIFIED` as to whether a fill path exists.

## 2. Customer lifecycle (onboarding → history)

```mermaid
flowchart LR
    subgraph Onboarding["Onboarding (admin-created accounts)"]
        A1["Full: customers/onboarding<br/>OnboardingService → onboard_customer RPC"]
        A2["Quick: customers/quick-onboard<br/>(shared QuickOnboardingForm)"]
        A3["Bulk: customers/bulk-import"]
        A4["Profile completion popup<br/>(ProfileCompletionDialog, IN_PROGRESS)"]
    end
    A1 & A2 & A3 --> A4
    A4 --> S["Subscription checkout<br/>plan → coupon → delivery charge → Razorpay →<br/>verifyAndActivate (client callback)"]
    S --> P["Daily preferences<br/>planner / pause / per-day address"]
    P --> D["Delivery (Diagram E)"]
    D --> H["History / billing / report cards<br/>subscription-history, health-logs"]
```

Cutoff rule: modifications for tomorrow lock at 17:00 IST; after cutoff the earliest editable date is the day after tomorrow (enforced in meal/pause/address actions via `src/lib/dates/ist.ts`).

## 3. KIT lifecycle (purchase → expiry → report)

```mermaid
stateDiagram-v2
    [*] --> Provisioned: admin kit product selected<br/>(subscriptions.customer_category = KIT, kit_product_id)
    Provisioned --> Shipped: kitCustomerShippingActions<br/>kit_shipping_info (courier + tracking)
    Shipped --> Received: kit_received_date set<br/>(lock trigger: create-kit-received-date-lock-trigger)
    Received --> Active: kit_tracker_end_date = received + kit_duration_days
    Active --> Active: daily kit_daily_logs (food/weight/activity/nutrition)
    Active --> Expired: cron expire-kits (23:30 IST)<br/>KitLifecycleService
    Expired --> [*]: PDF report via /api/kit-report/[subscriptionId]<br/>(KitReportTemplate, kit_report_cache)
```

Category-guard triggers (`create-kit-tracker-category-guard-triggers.sql`) prevent KIT logging on non-KIT subscriptions.

## 4. Accommodation / Stay lifecycle

```mermaid
stateDiagram-v2
    [*] --> PENDING: booking (stayActions, stay_entries)
    PENDING --> ACTIVE: cron transition-stays (01:00 IST)
    ACTIVE --> ACTIVE: daily health logs (customer_health_logs + admin_health_logs),<br/>add-on service requests, extension (stay_extension_history)
    ACTIVE --> ACTIVE: Save Stay Details / recalculation<br/>(stay_recalculation_history, early_checkout_applied)
    ACTIVE --> FINISHED: transition-stays or checkout
    FINISHED --> EXPIRED: expiry handling
    FINISHED --> [*]: final invoice (payments.invoice_type = ACCOMMODATION_FINAL_INVOICE),<br/>stay-health-report PDF
```

Payments use `stay_payment_transactions` (ADVANCE / PARTIAL_BALANCE_PAYMENT / REFUND) and `AccommodationPaymentHostService` for host-profile payment.

## 5. Subscription payment flow (verified, with webhook asymmetry)

```mermaid
sequenceDiagram
    participant Cust as Customer Portal
    participant Act as checkoutActions.ts
    participant RZP as Razorpay Checkout.js
    participant WH as /api/webhooks/razorpay
    participant DB as payments / subscriptions

    Cust->>Act: createRazorpayOrderAction()
    Act-->>Cust: razorpayOrderId + key
    Cust->>RZP: open checkout
    RZP-->>Cust: handler(response) [client callback]
    Cust->>Act: verifyAndActivateSubscriptionAction(response)
    Act->>DB: activate subscription + payments row
    Cust->>Act: checkAndReconcileSubscriptionPaymentAction() [on app resume, if handler never fired]

    Note over WH: ADDON flow only: webhook verifies HMAC,<br/>idempotent on razorpay_transactions.razorpay_payment_id,<br/>runs decrement_franchise_product_stock,<br/>notifies customer + admins
    Note over WH: Subscription flow NOT webhook-reconciled —<br/>checkoutData is not persisted server-side pre-payment<br/>(documented in webhook route header)
```

**Documented limitation:** an Android UPI app-switch kill during *subscription* checkout leaves the payment captured on Razorpay without activation; recovery relies on the in-app resume reconcile action. Fix requires persisting `checkoutData` server-side at order-creation time.

## 6. Diagram F — Franchise Inventory Flow

```mermaid
sequenceDiagram
    participant Master as Master/Admin (central)
    participant RPC1 as dispatch_to_franchise (RPC)
    participant Fr as Franchise Portal
    participant RPC2 as accept/reject/receive_franchise_transfer RPCs
    participant RPC3 as record_franchise_stock_out (RPC)
    participant Shop as franchise_shop_stock_in (RPC)

    Master->>RPC1: dispatch (transfer_stock / dispatch_to_franchise)
    RPC1->>RPC1: FIFO-lock inventory_lots FOR UPDATE,<br/>create franchise_stock_transfers + lines
    RPC1-->>Fr: transfer row (state = DISPATCHED) + package images
    Fr->>RPC2: accept → ACCEPTED / reject → REJECTED
    Fr->>RPC2: receive → RECEIVED: creates franchise_inventory_lots,<br/>IN row in franchise_inventory_ledger
    Fr->>RPC3: stock-out on sale/wastage: FIFO deplete, OUT ledger row
    Fr->>Shop: move warehouse stock into own customer shop
```

Supporting engine: `src/services/franchiseInventoryEngine.ts`; tables: `franchise_warehouses(+_stock)`, `franchise_inventories`, `franchise_inventory_lots`, `franchise_inventory_ledger`, `franchise_stock_transfers(+lines)`; RLS scripts `scripts/create-franchise-inventory-rls-policies.sql` / `enable|disable-franchise-rls.sql`.

## 7. Rider duty → delivery → payout

```mermaid
flowchart LR
    L["Login (email+password)"] --> D["Duty toggle (shiftActions)"]
    D --> GPS["Native foreground service starts<br/>BackgroundGeolocation plugin fork"]
    GPS --> Q["LocationQueue (offline buffer)"]
    Q --> SYNC["SyncWorker → SupabaseUploader"]
    SYNC --> DB[("rider_live_locations<br/>via upsert RPC")]
    D --> R["Route view (route_sequence order)"]
    R --> ST["Status transitions + delivery proof image"]
    ST --> LOG["delivery_status_logs"]
    D --> OFF["Auto-off-duty sweep cron (every 5 min idle check)"]
    DB --> PO["Monthly payout rollup (generate-rider-payments)"]
    PO --> SUM[("rider_monthly_summaries")]
    SUM --> WITH["Withdrawals → rider_payouts<br/>(admin/master settlement)"]
```

Boot persistence: `BootReceiver.java` restarts the tracking service after device reboot; `WakeLockManager` + OEM battery instructions (`src/lib/capacitor/oem-battery-instructions.ts`) mitigate Doze. Details in `11-native-mobile-architecture.md`.

## 8. Dietitian activity — one engine, three surfaces

`CadenceService` computes "days since last log"/"customers missing self-log" identically for Admin Log-Customer workspace, Franchise Dietitian Activity report, and Master Dietitian Activity section. Report cards (`report_cards`: ACTIVE → finalised via `reportCardLifecycleActions`, `reopen_count`, `finalised_by`) share the lifecycle and PDF export path across all three portals. Spec `.kiro/specs/report-card-lifecycle/tasks.md` has unchecked items (final report + PDF export, remaining gaps, DB-level verification) — status 🟡.

## 9. Rider assignment — pincode is the unit of territory

Core and franchise routing both resolve riders via `rider_service_areas.pincode → rider_id` (franchise rows stamped `franchise_id`); `fixed_rider_assignments` overrides take priority; batches use Haversine from kitchen coordinates; payout = distance × `rate_configs.rider_payout_rate_per_km` (fallback `system_settings.rider_payout_per_km`). Pincode reassignment between clinics uses the `create-move-pincode-rpc` (SECURITY DEFINER).


