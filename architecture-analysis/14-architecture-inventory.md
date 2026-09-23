# ArogyaDiet — Architecture Inventory & Discovery Summary

> Machine-style index of discovered artifacts (branch `development`, commit `90c7f36`, inspected 2026-09-12). Counts are from direct listings; "approx." where inference was involved.

## Directory inventory

| Area | Contents (verified) |
|---|---|
| `src/app` | 6 portal roots (`admin`, `customer`, `franchise`, `master`, `rider`) + `api`, `sandbox`, `unauthorized` |
| `src/app/api` | `admin/{customer-report/[type]/[id], inventory/purchase-orders/export}`, `app-download/grant`, `auth/{callback,recovery}`, 10 `cron/*` routes, `kit-report/[id]`, `meal-health-report/[id]`, `migrate/*`, `notifications`, `reset-franchise-password`, `shop-receipt/[id]`, `stay-health-report/[id]`, `temp-fix-schema`, `webhooks/razorpay` |
| `src/actions` | 29 root files + `admin-actions/` (31) + `franchise-actions/` (15) + `master-actions/` (29) + `rider-actions/` (3) + `inventory-actions/` (4) + `dietitian-actions/` (4) + `system-actions/` (1) + `__tests__/` |
| `src/services` | 37 files (+`__tests__/` incl. property tests) |
| `src/repositories` | 12 root files + `clinic/`, `dietitian/`, `franchise/` |
| `src/lib` | 40+ domains incl. `supabase/` (5 clients), `automation/`, `routing/`, `payments/`, `onesignal/`, `capacitor/` (7), `appDistribution/` (8), `notifications/` (4), `otp/`, `pin/`, `dates/`, `geocoding.ts`, `distance.ts` |
| `src/validations` | 20 zod schema files |
| `src/shared` | components/hooks/stores/utils (portal-shared UI incl. `MobilePinLoginForm`, `MobileOtpLoginForm` ⚠️, `ProfileCompletionDialog`, admin/customer/franchise component sets) |
| `src/emails` | 5 React email templates |
| `src/test` | a11y, accommodation, architecture, customer-*, db, dietitian, inventory, shop, stubs (+fast-check arbitraries) |
| `scripts` | ~110 SQL migration/RPC/RLS scripts + seed/verify mjs/sh |
| `.kiro/specs` | 29 feature specs (tasks.md with checklists) |
| `.kiro/steering` | `product.md`, `tech.md`, `structure.md`, `franchise-execution-plan.md`, `rider-gps-tracking.md` |
| `native/plugins/background-geolocation` | hardened Capacitor fork (Java: ForegroundService, Engine, Queue, SyncWorker, Uploader, BootReceiver, ShiftState, WakeLockManager; dist + TS defs) |
| Root docs/config | `package.json`, `vercel.json` (crons: []), `capacitor.config.json`, `next.config.ts`, `middleware.ts` (in src), `.env.local`, `Arogya-rider.apk`, features/audit MDs |

## Database inventory

- **Tables:** ~90 across 20 domains (full map in `07-database-domain-map.md`).
- **Postgres functions:** ~74 (per features doc §1; includes SECURITY DEFINER RPCs: onboard_customer, move-pincode, dispatch/accept/reject/receive/stock-out/shop-stock-in, transfer_stock, recalculation × 2, group-with-kitchen create/delete/move, rider-location upsert, parity verify).
- **Triggers:** kit received-date lock, tracker sync, category guards (scripts).

## External integrations (verified): 10
Supabase (DB/Auth/Storage), Razorpay (+webhook), OneSignal, Resend, Google Maps JS, Google Routes, Google Geocoding, Cloudflare Turnstile, Supabase pg_cron scheduler, local Capacitor plugin ecosystem.

## AI/model integrations (verified): 0
See `04-ai-model-architecture.md`.

## Major workflows documented: 9
Customer lifecycle · Daily delivery (Diagram E) · KIT · Accommodation · Subscription payment · Franchise inventory (Diagram F) · Rider duty→payout · Dietitian cadence (3 surfaces) · Pincode assignment.

## Major shared services: ~14
SubscriptionService, BillingService, SubscriptionPaymentService, OnboardingService, AccommodationService, KitLifecycleService, HealthLogService, ReportCardService, CadenceService, AssignmentService, DeliveryChargeService, RateConfigService, inventoryEngine, franchiseInventoryEngine (+ PinService, notifications stack).

## Major native components: 12 Java classes
LocationForegroundService, LocationEngine(+Config), LocationQueue, QueuedLocation, SyncWorker, SyncState, SupabaseUploader, BootReceiver, ShiftState(+Store/Authority), WakeLockManager, Delivery/Stop callbacks, LocationConstants.

## Feature inventory per portal (route-level, from §02)

- **Customer:** 14 main routes + auth group + public APK landing (~24 route nodes).
- **Rider:** 5 main routes + auth group (2 legacy top-level routes flagged).
- **Admin:** 12 module roots (+ nested customer/subscription/inventory trees + API export) (~40 route nodes; 2 inventory roots flagged).
- **Franchise:** 11 module roots (~18 route nodes).
- **Master:** 20 module roots (+ BI/nested warehouse tree; 2 duplicate surfaces flagged).

## Contradictions & Resolutions (mandated format)

### C1 — Cron scheduling

```text
DOCUMENTATION SAYS: vercel.json cron config is empty "despite dependent /api/cron/** routes"
                    (AROGYADIET_DASHBOARDS_FEATURES.md §12).
SCHEMA SAYS:        scripts/add-supabase-cron-jobs.sql defines 8 cron.schedule() jobs
                    calling https://admin.arogyadiet.com/api/cron/* via net.http_get.
CODE SAYS:          vercel.json = {"crons": []}; all 10 cron routes exist and are secret-gated.
RESOLUTION:         Scheduling is Supabase pg_cron; vercel.json is intentionally empty.
                    Residual issue: the secret value is hardcoded in the SQL script.
FINAL STATUS:       RESOLVED — automation VERIFIED ACTIVE, security caveat open (P1).
```

### C2 — Cron secret fallback

```text
DOCUMENTATION SAYS: routes used process.env.CRON_SECRET || "arogya-demo-123" (features doc §12
                    + vercel-cron-automations spec "current pattern").
SCHEMA SAYS:        n/a.
CODE SAYS:          dispatch/route.ts rejects with 401 when CRON_SECRET is unset or mismatched;
                    spec tasks 1.1–1.x are checked complete.
RESOLUTION:         Hardening was applied after the features doc was written.
FINAL STATUS:       RESOLVED — VERIFIED LIVE (hardened).
```

### C3 — rider_monthly_summaries status enum

```text
DOCUMENTATION SAYS: status = OPEN/LOCKED/SETTLED (.clinerules / earlier schema reference).
SCHEMA SAYS:        CHECK (status = ANY (ARRAY['GENERATED','PAID'])).
CODE SAYS:          settlement cron writes total_earnings; payout UI reads net_payable;
                    no fill path for net_payable was located.
RESOLUTION:         Current schema wins — docs stale. The net_payable/total_earnings mismatch
                    is a real functional gap, not a naming quirk.
FINAL STATUS:       CONTRADICTION STANDS — docs stale; payout gap OPEN (P1 blocker).
```

### C4 — OTP login

```text
DOCUMENTATION SAYS: OTP login "built, unmounted" (features doc §121/443).
SCHEMA SAYS:        otp_login_throttle table exists with policy-supporting columns.
CODE SAYS:          MobileOtpLoginForm + mobileAuthActions + OtpLoginService + unit/wiring/a11y
                    tests all exist; /login renders MobilePinLoginForm (pin-auth spec supersedes).
RESOLUTION:         Confirmed unmounted — superseded by PIN auth; intent (shelve vs oversight)
                    remains undecided by the team.
FINAL STATUS:       IMPLEMENTED BUT UNMOUNTED (⚠️).
```

### C5 — Franchise portal liveness

```text
DOCUMENTATION SAYS: franchise portal is live (features doc §1).
SCHEMA SAYS:        franchise tables + RLS scripts exist (enable/disable toggles present).
CODE SAYS:          FRANCHISE_FEATURES_ENABLED must be exactly "true"; when unset every
                    franchise path is inert by design (resolveFranchiseFeatureFlag).
RESOLUTION:         Live in this workspace (env confirmed); production default is OFF.
FINAL STATUS:       VERIFIED LIVE with explicit environment dependency.
```

### C6 — Base schema drift (.clinerules vs live schema)

```text
DOCUMENTATION SAYS: .clinerules schema shows subscriptions/payments/kitchens without
                    customer_category, discount/charge columns, franchise_id, etc.
SCHEMA SAYS:        subscriptions has customer_category + kit_* + delivery_charge +
                    misc_charge + total_payable + discount_amount; payments has
                    invoice_type enum + amount_paid/balance_due; kitchens.lat/lng are now
                    nullable (make-kitchen-geo-nullable.sql); ~90 tables total.
CODE SAYS:          features read/write the newer columns throughout.
RESOLUTION:         .clinerules is an outdated snapshot; live schema + migration scripts win.
FINAL STATUS:       RESOLVED — this package documents the live schema.
```

### C7 — Admin inventory routes

```text
DOCUMENTATION SAYS: admin has warehouse inventory UI (single surface implied).
SCHEMA SAYS:        n/a.
CODE SAYS:          Two route roots exist: admin/(main)/inventory/** and admin/inventory/**
                    with identical subfolders (ledger/manufacturing/mappings/shop-products).
RESOLUTION:         Likely a regrouping leftover; safe but confusing. Flagged as duplicate
                    surface (P3 consolidation).
FINAL STATUS:       DUPLICATE SURFACE (⚠️) — relationship UNVERIFIED.
```

### C8 — Franchise RBAC (working-tree documentation ahead of commit)

```text
DOCUMENTATION SAYS: the working-tree copy of AROGYADIET_DASHBOARDS_FEATURES.md carries an
                    UNCOMMITTED +34-line §6.7 "Franchise RBAC" describing a per-Operations-Group
                    Manage/View model reusing admin's admin_operations_access primitives.
SCHEMA SAYS:        users.admin_operations_access jsonb exists in the supplied schema
                    (add-admin-operations-access-to-users.sql).
CODE SAYS:          VERIFIED — src/lib/auth/adminAccessCore.ts defines OPERATIONS_GROUPS
                    (6) / FRANCHISE_OPERATIONS_GROUPS (5) / hasGroupAccess / classifyAdminPath /
                    isPortalPathAllowed; src/lib/dietitian/franchiseCustomerScope.ts implements
                    scopeFranchiseCustomersForDietitian (fail-closed) with dedicated tests;
                    middleware applies the same group gate on the /franchise path base
                    (owner → inventory_operations). Spec folder for this work is absent.
RESOLUTION:         The uncommitted doc section matches the code; this package incorporates it.
                    Note: git status shows the input file modified — this analysis did NOT
                    modify it (read-only); the change pre-existed/was made outside this task.
FINAL STATUS:       RESOLVED — RBAC model VERIFIED LIVE; spec-checklist verification UNVERIFIED.
```

## Worked traceability examples (Part 23)

### T1 — Customer PIN Login

```text
Feature:      Customer PIN Login
Portal:       customer (customer.* → /customer)
UI:           src/app/customer/(auth)/login/page.tsx → MobilePinLoginForm (client)
Action:       checkEligibilityAction, verifyPinAction (src/actions/pinAuthActions.ts)
Service:      PinService, PinThrottleService (bcrypt cost 10, temp-PIN flow)
Repository:   direct Supabase queries (no repo layer for this domain)
Database:     users.pin_hash / is_temp_pin / pin_set_at
RPC:          — (none; plain guarded queries)
Status:       VERIFIED LIVE (✅)
Evidence:     DIRECT CODE (login page, actions, services) + TEST (throttle/pin tests)
              + DOCUMENTATION (customer-pin-auth spec, all tasks checked)
```

### T2 — Daily order generation & dispatch pipeline

```text
Feature:      Daily delivery automation
Portal:       system (cron) + admin operations UI (manual trigger)
UI:           admin/(main)/operations (manual run + observability)
Action:       runDailyPipeline (src/actions/system-actions/dailyPipeline.ts),
              generateDailyOrders, executeAutomatedDispatch (routeEngine.ts)
Service:      — (pipeline-internal); lib/clinic/workload.ts for snapshots
Repository:   direct via createAdminClient
Database:     delivery_orders, delivery_batches, workload_snapshots, automation_logs
RPC:          rider-location upsert (rider side); batch/route writes via engine
External:     Google Routes computeRoutes (waypoint optimization), Haversine fallback
Status:       VERIFIED LIVE (✅) — halt-on-failure + retry-x3 policy read from source
Evidence:     DIRECT CODE (dailyPipeline.ts, dispatch/route.ts) + SCHEMA
              (add-supabase-cron-jobs.sql schedules) + CONFIGURATION (CRON_SECRET)
```

### T3 — Franchise stock transfer (central → franchise)

```text
Feature:      Franchise inventory lifecycle
Portal:       master/admin (dispatch side), franchise (accept/reject/receive/stock-out)
UI:           master (main) inventory + franchises/[id]; franchise/(main)/inventory
Action:       master-actions/stockTransferActions, franchise-actions/franchiseInventoryActions
Service:      franchiseInventoryEngine
Repository:   repositories/franchise/*
Database:     franchises, franchise_stock_transfers(+lines), franchise_inventory_lots,
              franchise_inventory_ledger, franchise_warehouses(+stock)
RPC:          transfer_stock, dispatch_to_franchise, accept/reject_franchise_transfer,
              receive_franchise_transfer, record_franchise_stock_out, franchise_shop_stock_in
Status:       VERIFIED LIVE (✅)
Evidence:     DIRECT CODE (actions/engine) + SCHEMA (SECURITY DEFINER RPC scripts:
              create-dispatch-to-franchise-rpc.sql, create-receive-franchise-transfer-rpc.sql,
              create-record-franchise-stock-out-rpc.sql) + TEST (franchise inventory __tests__)
```



## Verification pass (per task §28)

- ✅ Every claimed integration checked against imports/SDK usage (`package.json`, `lib/*` wrappers, webhook code).
- ✅ Every claimed feature checked for route/component/action chain (route listings + action/service maps).
- ✅ Unmounted features, dead routes, duplicate surfaces identified and labeled.
- ✅ Model-to-feature mapping: none exist; explicitly documented with negative evidence.
- ✅ Auth/scoping traced through middleware → layout → action → RLS/RPC.
- ✅ Cron/webhooks verified against pg_cron script and route sources.
- ✅ Native layer verified against plugin source tree.
- 🔍 Items that remain `UNVERIFIED` are enumerated in `08`, `09`, `11`, and `13` (ops-route protection, APK credentials, static-export scope, rider-payments scheduling, CORS).

---

# Architecture Discovery Summary

```text
Total portals:                        5 (customer, rider, admin, franchise, master)
Total major domains:                  20 (database) / ~15 (application)
Total major features:                 ~60 route-level features across portals (approx.)
Total verified integrations:          10 external + 1 native app layer
Total verified AI/model integrations: 0 (explicitly none found)
Total important workflows:            9 documented end-to-end
Major shared services:                ~14 shared engines + notification/email stack
Major external providers:             Supabase, Razorpay, OneSignal, Resend, Google (Maps/Routes/Geocoding), Cloudflare Turnstile
Major native components:              Capacitor 8 WebView + hardened background-geolocation fork (12 Java classes)
Verified live:                        majority — all 5 portal cores, daily pipeline, payments, KIT, stay, franchise inventory, BI, hierarchy, native GPS
Implemented with caveat:              ~12 items (payout columns, subscription webhook, untested recalc, APK operator steps, report-card PDF, manual payments, legacy routes in use)
Partial/unmounted:                    ~6 (OTP login, duplicate/legacy route surfaces, /sandbox)
Stub/not implemented:                 1 (customer self-signup — disabled by design)
Unverified:                           enumerated per file (ops routes, APK creds, rider-payments schedule, CORS, static export)
Recommended next priorities:          7-item ordered list in 13-completed-vs-next.md
```

*Counts are based on discovered artifacts in this repository and are approximate where the repository is ambiguous; nothing was invented to fill a category.*

