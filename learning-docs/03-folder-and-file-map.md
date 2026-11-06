# 03 — Folder and File Map

How to read this doc: first the folders, then the files grouped by folder. Each file line says **what it is**, **what it does**, and **who calls it**. Counts come from directory listings taken on 2026-11-02 (commit `0e3fadd`). `src/` holds about 1,346 files including tests; this map lists every file that matters for understanding behaviour and groups the rest (UI leaf components, tests) by folder.

Terms used below:
- **RSC** (React Server Component): a component that runs only on the server and can `await` data. Default in the App Router.
- **Server Action**: an `async` function in a file marked `"use server"`. A client component can call it like a normal function; under the hood Next.js sends a POST request.
- **Route handler**: a `route.ts` file under `src/app/api/**` that answers raw HTTP (GET/POST).

---

## 1. Root folder

| Path | Type | What it is / does |
|---|---|---|
| `src/` | code | All application code (Next.js App Router + one legacy Pages Router folder). |
| `scripts/` | SQL + mjs | ~130 hand-run SQL migrations, RPC definitions, RLS policies, seeds, and the pg_cron schedule. Not run automatically. |
| `supabase/migrations/` | SQL | 9 small timestamped migrations (notifications table + RLS, products soft delete, coupons, users self-service RLS, storage bucket). The bulk of the schema history lives in `scripts/`, not here. |
| `native/plugins/background-geolocation/` | Java + TS | The hardened Capacitor background-GPS plugin used by the rider Android app. |
| `architecture-analysis/` | md | Earlier AI-generated architecture docs. Useful map, partly stale (see notes in this folder's docs). |
| `AI_CONTEXT/` | md | Short rule files given to AI agents (portal isolation, pincode model, pause rules). |
| `.kiro/specs/` | md | 29 feature specs (requirements/design/tasks). Digest in `15-kiro-specs-digest.md`. |
| `.kiro/steering/` | md | Always-loaded agent rules: product, tech, structure, franchise plan, rider GPS status. |
| `docs/` | md | Older docs: architecture, database, routing-security, business logic, APK distribution, partial payment plan, Capacitor audit. |
| `public/` | static | Logo, background images, OneSignal service worker files, templates. |
| `package.json` | config | Dependencies and scripts (`dev`, `build`, `start`, `lint`, `test` = `vitest run`). |
| `next.config.ts` | config | Image domain for Supabase Storage, Server Action body limit 25 MB, and **aliases the Capacitor packages to web stubs** for both webpack and Turbopack. |
| `vercel.json` | config | `{"crons": []}` — Vercel cron is not used; scheduling is in Supabase pg_cron. |
| `capacitor.config.json` | config | Rider app id `com.arogyadiet.rider`, plugin settings. The Android project itself lives in a separate repo (`rider-mobile-app`). |
| `vitest.config.ts` | config | Test runner config: node env by default, path aliases, `server-only` stubbed. |
| `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs`, `components.json` | config | TypeScript paths (`@/components` → `src/shared/components`), lint, Tailwind 4, shadcn. |
| `.clinerules`, `.cursorrules`, `CLAUDE.md`, `AGENTS.md` | agent rules | Instructions for different AI tools. `.clinerules` includes an outdated schema snapshot. |
| `AROGYADIET_DASHBOARDS_FEATURES.md` | md | Big feature inventory per dashboard. |
| `RIDER_GPS_TRACKING_SETUP_CHECKLIST.md` | md | Checklist for the rider admin (OEM battery settings). |
| `Arogya-rider.apk` | binary | A built rider APK committed to the repo. |
| `*.txt`, `*.html`, `globals-output.css` | scratch | Debug output left by agents (test logs, HTML dumps). Safe to ignore. |
| `.env.local` | secrets | Environment values. **Never copy.** Variable names are listed in `09-integrations.md`. |

---

## 2. `src/` top level

| Folder | Role |
|---|---|
| `src/middleware.ts` | The single request gatekeeper: subdomain → portal rewrite, Supabase session refresh, role gates, customer category gate, franchise access-level gate. See `04` and `06`. |
| `src/app/` | App Router: 5 portals + `api/` + `sandbox/` + `unauthorized/`. |
| `src/pages/architecture/` | Pages Router (legacy router) page that renders `architecture-analysis/*.md`. Marked TEMPORARY; publicly reachable because middleware returns early for `/architecture`. |
| `src/actions/` | Server Actions (all mutations and many reads). |
| `src/services/` | Business logic used by actions (engines, PDF templates). |
| `src/repositories/` | Thin data-access helpers for some domains. Most domains query Supabase directly in services/actions. |
| `src/lib/` | Pure helpers, Supabase clients, auth/RBAC core, dates, routing, notifications, Capacitor stubs. |
| `src/validations/` | zod schemas. |
| `src/types/` | TypeScript domain types. |
| `src/shared/` | Cross-portal UI components, hooks, zustand stores, small utils. |
| `src/store/useCartStore.ts` | zustand cart for the customer shop. |
| `src/emails/` | 5 HTML email builders sent through Resend. |
| `src/config/` | Empty (`.gitkeep`). |
| `src/test/` | Cross-cutting test suites (a11y, property tests, stubs). |

---

## 3. `src/app/` — routes by portal

URL rule: the browser sees `admin.arogyadiet.com/customers`; middleware rewrites it to `/admin/customers`, which maps to `src/app/admin/(main)/customers/page.tsx`. Folders in parentheses like `(main)` and `(auth)` are **route groups**: they organise layouts but do not appear in the URL.

### 3.1 Root

| Path | What it does |
|---|---|
| `src/app/layout.tsx` | Root HTML shell, Fraunces font, `sonner` `<Toaster/>`. |
| `src/app/page.tsx` | Apex landing page (no subdomain). |
| `src/app/globals.css` | Tailwind 4 + app CSS (e.g. `.rider-app-shell`, `pt-safe`). |
| `src/app/unauthorized/page.tsx` | Target of every role-gate redirect. |
| `src/app/sandbox/page.tsx`, `actions.ts` | OneSignal test page; middleware lets `/sandbox` through without auth. Dev leftover. |

### 3.2 Customer portal — `src/app/customer/`

| Path | What it does / who calls it |
|---|---|
| `layout.tsx` | Synchronous shell: paints `GlobalLoader` first, wraps children in `Suspense`. |
| `page.tsx` | Redirects to dashboard. |
| `(auth)/login/page.tsx` → `CustomerLoginView.tsx` | RSC shell + client view switching between `MobilePinLoginForm` and `SetNewPinForm` (both in `src/shared/components/customer/`). |
| `(auth)/login/LoginBrandPanel.tsx` | Visual brand panel. |
| `(auth)/signup/page.tsx` | Self-signup is disabled; redirects (test: `__tests__/signup-redirect.test.ts`). |
| `(auth)/forgot-password`, `update-password`, `success` | Password-recovery screens using `authActions.ts`. |
| `(main)/layout.tsx` | Calls `getCustomerSession()` (`src/lib/customer/get-session.ts`), reads `x-customer-category` header, renders sidebar/header. |
| `(main)/template.tsx` | Re-mounts per navigation; hosts the app-ready beacon for the loader. |
| `(main)/dashboard/page.tsx` | Big RSC; branches into meal dashboard, `KitDashboard.tsx`, `AccommodationDashboard.tsx`, `ShippingTracker.tsx`. |
| `(main)/subscription/page.tsx` | Plans list; `checkout/page.tsx` multi-step checkout (components in `shared/components/customer/subscription/checkout`); `success/page.tsx`. |
| `(main)/subscription/manage/planner` | Per-day meal/pause planner → `manageMealActions.ts`. |
| `(main)/subscription/manage/address` | Per-day address change. |
| `(main)/subscription/manage/billing` (+ `invoice/[id]`) | Payment history and invoice view. |
| `(main)/subscription-history/page.tsx` | Past meal subscriptions → `mealSubscriptionHistoryActions.ts`. |
| `(main)/meals/page.tsx` | Upcoming meals / delivered meals. |
| `(main)/tracking/[orderId]/page.tsx` + `tracking-client.tsx` | Live rider tracking map for an order. |
| `(main)/shop/layout.tsx` | Guards shop to eligible categories. `page.tsx` catalog, `checkout/page.tsx` Razorpay flow, `orders/` history (`shop-orders-client.tsx`). |
| `(main)/kit-tracker`, `kit-history` | KIT product line (middleware blocks MEAL customers). |
| `(main)/stay-tracker`, `stay-history`, `health-report`, `addon-services` | ACCOMMODATION product line. |
| `(main)/profile/page.tsx` | Profile, PIN change. |
| `(public)/app/[slug]/page.tsx` + `DownloadControl.tsx` + `_components/*` | Public APK download landing (QR target). Turnstile + `/api/app-download/grant`. |

### 3.3 Rider portal — `src/app/rider/`

| Path | What it does |
|---|---|
| `(auth)/login/page.tsx` | Uses `RiderLoginForm` → `LoginAction` with `portalRole=RIDER`. |
| `(main)/layout.tsx` | `getCachedRiderAuth()` (`src/lib/supabase/cached-auth.ts`, uses React `cache()`), header, bottom nav, `RiderNativeShell`. |
| `(main)/rider-layout-client.tsx` | Client wrappers: OneSignal, notification bell, native shell (back button, permissions) via dynamic import. |
| `(main)/dashboard/page.tsx` + `dashboard-content.tsx` | Duty toggle (`RiderStatusToggle`), battery onboarding, earnings summary. |
| `(main)/route/page.tsx`, `route/[orderId]/page.tsx` | Today's batch, stop list, per-stop actions → `rider-actions/routeActions.ts`. |
| `(main)/payout/page.tsx` | Earnings, monthly summaries, leaderboard (column mismatch, see `16`). |
| `(main)/profile/page.tsx` | Rider profile → `rider-actions/profileActions.ts`. |
| `subscription/page.tsx`, `tracking/page.tsx` | 1-line legacy redirects (dead routes). |

### 3.4 Admin portal — `src/app/admin/`

| Path | What it does |
|---|---|
| `(auth)/login/page.tsx` | Shared `LoginForm` with `portalRole=ADMIN`. |
| `(main)/layout.tsx` | Re-checks role `ADMIN`, resolves access configuration, blocks inventory-only admins, renders `AdminNavbar` with trimmed menu. |
| `(main)/dashboard/page.tsx` | Operations KPIs. |
| `(main)/customers/page.tsx` + `AdminCustomersWrapper.tsx` | Customer workspace (uses `guardCustomersWorkspace`). Sub-routes: `[id]` (Customer 360), `[id]/report-card`, `[id]/billing/invoice/[paymentId]`, `[id]/billing/stay-receipt/[transactionId]`, `[id]/shipping`, `onboarding`, `quick-onboard`, `bulk-import`, `assisted-order`, `shop-orders`. |
| `(main)/subscriptions/page.tsx`, `[id]`, `kits/*` | Subscription list/detail; KIT product catalog dialogs. |
| `(main)/riders/page.tsx` | Rider management, service areas, live tracking. |
| `(main)/operations/page.tsx` | Daily operations: automation status, manual re-runs (`triggerSystemAutomation`), routing. |
| `(main)/kitchen-shop/inventory/page.tsx` | Clinic shop stock (group `shop_products`). |
| `(main)/franchises/page.tsx` | Franchise network view (group `franchises`). |
| `(main)/log-customer`, `log-customer/[id]` | Dietitian health-log workspace. |
| `(main)/profile/page.tsx` | Admin profile. |
| `inventory/layout.tsx` | Separate tree for the **inventory** access area; guards with `getCurrentAdminContext` + `canAccess("inventory")`. Pages: `page.tsx`, `ledger`, `manufacturing`, `mappings`, `shop-products`. |

### 3.5 Franchise portal — `src/app/franchise/` (subdomain `franchies.*`)

| Path | What it does |
|---|---|
| `(auth)/login` etc. | `LoginForm` with `portalRole=FRANCHISE_ADMIN`. |
| `(main)/layout.tsx` | Re-checks `FRANCHISE_ADMIN`, franchise exists and not suspended, owner override, `isPortalPathAllowed` using `x-portal-pathname` header. |
| `(main)/dashboard` | Metrics with `createAdminClient` filtered by `x-franchise-id` cookie. |
| `(main)/customers/*` | Franchise customer dashboard, create modal, quick onboard, 360 page, invoice, report card. |
| `(main)/subscriptions/*` | Subscriptions, global discount, holiday calendar. |
| `(main)/riders/*` | Riders and service-area manager. |
| `(main)/operations`, `orders`, `reports` | Day operations and analytics. |
| `(main)/inventory/*` | Incoming transfers, receive/reject, stock out, dispatch modal, ledger workspace. |
| `(main)/shop-products/*` | Franchise shop catalog and assisted order. |
| `(main)/disputes/*` | Raise disputes to master. |
| `(main)/dietitian-activity/*` | Dietitian cadence for franchise customers. |
| `(main)/log-customer/*` | Health-log workspace (franchise dietitians). |
| `(main)/profile/*` | Profile + service area card. |

### 3.6 Master portal — `src/app/master/`

| Path | What it does |
|---|---|
| `(main)/layout.tsx` | Re-checks `MASTER_ADMIN`. |
| `(main)/dashboard/*` | BI overview shells, KPI ribbon, segments, audit trail viewer. |
| `(main)/hierarchy/page.tsx` + `_components/*` | Business → City → Group → Kitchen/Clinic → Franchise tree; franchise users panel; agreement docs; pincode conflicts. |
| `(main)/franchises/*` | Franchise list and detail (admin users, kitchen, pincode conflicts). |
| `(main)/core-clinics`, `rate-config`, `user-management`, `system`, `logs` | Configuration surfaces. |
| `(main)/finance/*` | `FinanceCommandCenter`, `RiderPayoutsView`, `SubscriptionRevenueView`. |
| `(main)/inventory/*` | Inventory intelligence, shop products, `warehouse/*` (ledger, manufacturing, mappings, shop products). |
| `(main)/growth`, `logistics`, `kitchen-ops`, `reports`, `customers`, `subscriptions` | BI views. |
| `(main)/disputes/*` | Resolve franchise disputes. |
| `(main)/dietitian-activity/[customerId]/report-card` | Report card view. |

### 3.7 API routes — `src/app/api/` (middleware skips all of these)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `cron/generate-orders` | GET | `?secret` = `CRON_SECRET` | Creates tomorrow's `delivery_orders`; follow-ups via `after()`. |
| `cron/link-products` | GET | secret | Links paid shop orders to deliveries, then runs dispatch via `after()`. |
| `cron/dispatch` | GET | secret | Dispatch only (manual/legacy entry; not in the pg_cron SQL). |
| `cron/activate-subscriptions` | GET | secret | Activates due PENDING subscriptions, closes ended ones. |
| `cron/expire-kits` | GET | secret | Expires KIT subscriptions. |
| `cron/transition-stays` | GET | secret | Stay PENDING→ACTIVE→FINISHED. |
| `cron/auto-off-duty` | GET | secret | Sweeps idle riders off duty (has a test). |
| `cron/cleanup-dispatch-images`, `cron/cleanup-old-po` | GET | secret (first one also accepts a hard-coded literal) | Storage cleanup. |
| `cron/generate-rider-payments` | GET | secret with literal fallback | Monthly rider summaries. Not scheduled in SQL. |
| `webhooks/razorpay` | POST | HMAC signature | Shop (ADDON) payment backstop. |
| `auth/callback` | GET | none | OAuth disabled; redirects to `/login`. |
| `auth/recovery` | GET | recovery code/token | Password reset session exchange. |
| `app-download/grant` | POST | Turnstile + throttle | Issues signed APK download URL. |
| `kit-report/[subscriptionId]`, `meal-health-report/[subscriptionId]`, `stay-health-report/[stayId]`, `shop-receipt/[orderId]`, `admin/customer-report/[type]/[id]` | GET | session + ownership/role | PDF generation with `@react-pdf/renderer`. |
| `admin/inventory/purchase-orders/export` | GET | session | Excel export with `xlsx`. |
| `notifications` | GET/POST | session | Notification bell data. |
| `reset-franchise-password` | POST | **none** | Temporary ops endpoint. Critical issue, see `16`. |
| `migrate/reset-customer-passwords`, `migrate/fix-stuck-accommodation-user` | GET/POST | **none** | One-off migrations. Critical issue, see `16`. |


---

## 4. `src/actions/` — Server Actions

All files start with `"use server"` except `system-actions/routeEngine.ts` (a plain server module imported by actions/routes) and `admin-actions/kitBulkImportActions.ts` (directive on line 22, after a comment block — still valid because only comments precede it). Every exported function in a `"use server"` file that is reachable from client code becomes a POST endpoint. Keep that in mind when you read any of them: **the function must check auth itself**.

### 4.1 Root (customer-facing + shared)

| File | What it does | Main callers |
|---|---|---|
| `authActions.ts` | `LoginAction` (email/password, role check via `AuthService.login`), forgot/update/change password. | `shared/components/forms/login-form.tsx`, `RiderLoginForm.tsx`, password pages |
| `pinAuthActions.ts` | `checkEligibilityAction`, `verifyPinAction`, `setPermanentPinAction` (customer PIN login). | `MobilePinLoginForm`, `SetNewPinForm` |
| `pinManagementActions.ts` | Customer changes own PIN. | profile page |
| `mobileAuthActions.ts` | OTP login actions — built but **not mounted** on any page. | `MobileOtpLoginForm` (unused) + tests |
| `signupActions.ts` | Stub (self-signup disabled). | — |
| `profileActions.ts`, `profileCompletionActions.ts` | Profile edit; mandatory profile-completion popup. | `ProfileCompletionDialog` |
| `addressActions.ts`, `pincodeActions.ts` | Address CRUD, pincode serviceability check. | address forms, checkout |
| `checkoutActions.ts` | Subscription checkout: coupon validation, delivery-charge preview, `createRazorpayOrderAction`, `verifyAndActivateSubscriptionAction`, `checkAndReconcileSubscriptionPaymentAction`. | `subscription/checkout/step-5-preview.tsx` |
| `shop-actions.ts` | Shop checkout: `createAddonCheckoutOrder`, `verifyAddonPayment`, `checkAndReconcileAddonPaymentAction`, coupons, delivery date change, standalone checkout. | `customer/(main)/shop/checkout/page.tsx` |
| `manageMealActions.ts` | Pause/unpause + meal changes per day (pause reconciliation), `cascadePendingSubscriptionDates`. | planner page |
| `mealSubscriptionHistoryActions.ts` | History list. | subscription-history page |
| `kitLifecycleActions.ts`, `kitTrackerActions.ts` | Customer KIT state + daily self-logs. | kit pages |
| `stayActions.ts`, `stayPaymentActions.ts`, `stayInvoiceActions.ts` | Accommodation stay tracker, payments, invoices. | stay pages, admin stay tabs |
| `accommodationOnboardingActions.ts` | Admin onboarding of a stay customer (creates auth user + temp PIN). | admin onboarding |
| `addonServiceActions.ts` | Add-on services for stays. | `addon-services` page |
| `customerHealthReportActions.ts` | Health report data for stays. | health-report page |

### 4.2 `admin-actions/` (50 files incl. tests)

Grouped by domain. Most use `createAdminClient()` (service role) and gate with `checkGroupManage(group)` / `assertGroupAccess(group)` from `src/lib/auth/adminAccess.ts`.

| Domain | Files |
|---|---|
| Onboarding & customers | `onboardingActions.ts` (calls `OnboardingService` → RPC `onboard_customer`), `customerActions.ts`, `customerHistoryActions.ts`, `customerHealthLogActions.ts`, `bulkImportActions.ts`, `kitBulkImportActions.ts`, `accommodationCustomerActions.ts`, `adminPinActions.ts` (reset PIN to temporary), `dietitianAssignmentActions.ts` |
| Subscriptions & billing | `adminSubscriptionActions.ts`, `subscriptionActions.ts`, `adminLifecycleActions.ts`, `adminMealActions.ts` (admin pause override), `subscriptionPaymentActions.ts`, `partialPaymentActions.ts`, `adminCouponActions.ts`, `deliveryChargeActions.ts`, `holidayActions.ts`, `plannedActions.ts` |
| KIT | `kitProductActions.ts`, `kitLifecycleActions.ts`, `kitCustomerShippingActions.ts`, `shippingActions.ts`, `packageImageActions.ts` |
| Riders & routing | `riderActions.ts`, `riderClinicActions.ts`, `serviceAreaActions.ts`, `fixedAssignmentActions.ts`, `routingActions.ts`, `routingSandboxActions.ts`, `liveTrackingActions.ts`, `adminDeliveryActions.ts`, `operationsActions.ts`, `workloadActions.ts`, `fallbackAutomationActions.ts`, `conflictActions.ts` |
| System | `systemActions.ts` (`triggerSystemAutomation`, `runProductLinkingAction`) |
| Inventory & shop | `inventoryActions.ts`, `clinicShopInventoryActions.ts`, `assistedOrderActions.ts`, `clinicSelectorActions.ts` |
| Finance | `financeActions.ts`, `financePayoutActions.ts` |
| Franchise (from admin side) | `franchiseActions.ts`, `franchiseDispatchActions.ts`, `franchiseKitchenActions.ts`, `franchisePincodeActions.ts`, `franchiseProductActions.ts`, `franchiseUserActions.ts` |
| Profile | `adminProfileActions.ts` |

### 4.3 `franchise-actions/` (15)

`franchiseCustomerActions.ts`, `franchiseCustomerManagementActions.ts` (uses `checkFranchiseGroupManage` + shared `customerManagementCore`), `franchiseSubscriptionActions.ts`, `franchiseOperationsActions.ts`, `franchiseRiderActions.ts`, `franchiseServiceAreaActions.ts`, `franchisePincodeRequestActions.ts`, `franchiseInventoryActions.ts` (accept/reject/receive/stock-out → `franchiseInventoryEngine`), `franchiseDisputeActions.ts`, `franchiseDietitianActivityActions.ts`, `franchiseDietitianAssignmentActions.ts`, `franchiseAssistedOrderActions.ts`, `franchiseShopOrderActions.ts`, `franchisePartialPaymentActions.ts`, `franchiseMarketingActions.ts`.

### 4.4 `master-actions/` (28)

Hierarchy: `businessActions`, `cityActions`, `groupActions`, `kitchenActions`, `clinicActions`, `clinicWiringActions`, `franchiseActions`, `franchiseAdminActions`, `franchiseUserActions` (35 KB; franchise users + dietitians), `agreementDocActions`. BI: `biOverviewActions`, `biGrowthActions`, `biLogisticsActions`, `biKitchenOpsActions`, `biInventoryActions`, `biReportActions`, `dashboardActions`, `subscriptionReportActions`, `customerReportActions`, `networkReportActions`. Other: `adminActions` (admin users), `dietitianActions`, `dietitianActivityActions`, `disputeActions`, `rateConfigActions`, `stockTransferActions`, `notificationSettingsActions`, `logActions`.

### 4.5 Other action folders

| File | What it does |
|---|---|
| `rider-actions/shiftActions.ts` | `setRiderOnlineAction` — flips `rider_profiles.is_online` with the RLS session client. |
| `rider-actions/routeActions.ts` | Batch pickup, stop status updates, delivery proof. |
| `rider-actions/profileActions.ts` | Rider profile. |
| `system-actions/orderGeneration.ts` | `generateDailyOrders(targetDate, source)` — preferences → `delivery_orders`. |
| `system-actions/routeEngine.ts` | `executeAutomatedDispatch` — per-clinic scopes, pincode → rider, Google Routes, batch commit. |
| `system-actions/dailyPipeline.ts` | `runDailyPipeline` orchestrator. **Only called from tests** (`__tests__/pipeline-*.test.ts`); production uses the cron routes directly. |
| `inventory-actions/index.ts` | Central warehouse inventory actions (lots, manufacturing, mappings). |
| `dietitian-actions/*` | `dietitianCustomerActions`, `healthLogActions`, `reportCardActions`, `reportCardLifecycleActions`. |

---

## 5. `src/services/` (37 files + tests)

| File | Role | Called by |
|---|---|---|
| `AuthService.ts` | `login`, password reset/update helpers. | `authActions.ts` |
| `PinService.ts` | bcrypt hash/verify PIN, set permanent, reset to temporary. | `pinAuthActions`, `adminPinActions`, onboarding |
| `PinThrottleService.ts` | 5 failed attempts → 15-minute lock in `otp_login_throttle`. | `pinAuthActions` |
| `EligibilityChecker.ts` | "Exactly one CUSTOMER record in IN_PROGRESS/COMPLETED" rule. | `pinAuthActions` |
| `OtpLoginService.ts` | OTP flow (unmounted). | `mobileAuthActions` |
| `signupService.ts` | Legacy signup. | — |
| `OnboardingService.ts` (62 KB) | Admin onboarding orchestration → RPC `onboard_customer`. | `onboardingActions`, franchise onboarding |
| `SubscriptionService.ts` | Subscription lifecycle helpers. | admin/franchise actions |
| `BillingService.ts`, `SubscriptionPaymentService.ts` | Invoices, partial payments, outstanding balance. | checkout, partial payment actions |
| `DeliveryChargeService.ts` | `computeForCustomer` — per-clinic delivery charge. | checkout, onboarding |
| `RateConfigService.ts` | Resolves per-clinic rates (rider payout per km, delivery charge) with core fallback. | routeEngine, delivery charge |
| `AccommodationService.ts` (61 KB), `AccommodationPaymentHostService.ts` | Stay lifecycle, billing, recalculation. | stay actions |
| `KitLifecycleService.ts`, `KitReportService.ts`, `KitReportTemplate.tsx` | KIT states + PDF. | kit actions, `api/kit-report` |
| `HealthLogService.ts`, `HealthReportService.ts`, `HealthReportTemplate.tsx` | Daily health logs and report PDF. | dietitian + stay |
| `ReportCardService.ts`, `DietitianReportService.ts`, `DietitianReportTemplate.tsx` | Report card lifecycle and PDF. | dietitian actions |
| `CadenceService.ts` | Shared dietitian cadence engine (admin + franchise + master). | dietitian activity actions |
| `DietitianAccountService.ts`, `DietitianLogWorkspaceService.ts`, `AssignmentService.ts` | Dietitian accounts, workspace, assignment. | master/franchise actions |
| `AssistedOrderService.ts` (41 KB) | Admin/franchise places shop order for a customer (walk-in support). | assisted order actions |
| `addonOrderCore.ts`, `customerCouponCore.ts`, `customerManagementCore.ts` | **Ungated "core" functions** shared by admin and franchise wrappers; the wrappers own the permission check. | admin + franchise actions |
| `inventoryEngine.ts` (65 KB) | Central warehouse: lots, FIFO, manufacturing. | `inventory-actions`, master warehouse |
| `franchiseInventoryEngine.ts` | Franchise catalog, incoming transfers, receive/stock-out via RPCs. | franchise pages/actions |
| `dashboardMetrics.ts` | Admin dashboard KPIs. | admin dashboard |
| `FallbackAutomationService.ts` | Fallback when automations did not run. | `fallbackAutomationActions` |
| `ShopReceiptService.ts`, `ShopReceiptTemplate.tsx` | Shop receipt PDF. | `api/shop-receipt` |
| `emailService.ts` | Resend client wrapper (`sendEmail`). | `lib/notifications.ts`, emails |
| `addressService.ts` | Address helpers. | address actions |

---

## 6. `src/repositories/`

Root: `customerOnboardingRepository.ts` (`findCustomerByMobile`, onboarding writes), `subscriptionPaymentRepository.ts`, `stayRepository.ts`, `stayPaymentRepository.ts`, `stayExtensionHistoryRepository.ts`, `stayRecalculationHistoryRepository.ts`, `kitLifecycleRepository.ts`, `healthReportRepository.ts`, `addonServiceRepository.ts`, `disputeRepository.ts`, `otpThrottleRepository.ts`, `appDownloadThrottleRepository.ts`.
- `clinic/`: business, city, clinic, kitchen, service area, clinic product + ledger, snapshot repositories (+ `index.ts`).
- `dietitian/`: assignment, audit, cadence, dietitian, health log, report card repositories.
- `franchise/`: agreement docs, city, franchise clinic, franchise inventory, franchise, group, warehouse repositories (+ `index.ts`).


---

## 7. `src/lib/` — helpers by subfolder

| Folder / file | What it holds | Key exports |
|---|---|---|
| `supabase/server.ts` | Session (RLS-bound) client built from request cookies. | `createClient()` |
| `supabase/client.ts` | Browser client. | `createClient()` |
| `supabase/admin.ts` | Service-role client (bypasses RLS). | `createAdminClient()` |
| `supabase/cached-auth.ts` | `getCachedRiderAuth` wrapped in React `cache()` (dedupes layout + page). | |
| `supabase/franchise-session.ts` | `setFranchiseSessionContext` → RPC `set_franchise_context` (only when flag on). | |
| `auth/adminAccessCore.ts` | **Pure** RBAC rules (edge-safe): levels, groups, path classifier, `isPortalPathAllowed`, `landingRouteFor`, clinic scope validation. | used by middleware + layouts |
| `auth/adminAccess.ts` | `server-only` guards: `getCurrentAdminContext`, `assertGroupAccess/Manage`, `checkGroupManage`, `guardAdminGroup`, `guardCustomersWorkspace`, franchise twins, warehouse/clinic/dietitian guards. | actions + pages |
| `auth/scope-resolver.ts`, `scope-predicate.ts`, `dashboard-scope.ts`, `global-tables.ts`, `sharedCustomerActor.ts` | Scope (core vs franchise) resolution and predicates for shared code. | |
| `franchise/*` | Feature flag (`constants.ts`), `context.ts` (resolve franchise context), `stamping.ts` + `server-stamp.ts` (franchise_id stamping), `queries.ts`, `status-transitions.ts`, `assignment-resolver.ts`, `global-table-guard.ts`. | |
| `franchise-inventory/*` | Pure rules: FIFO depletion, on-hand calculator, transfer state reducer, stock-out validation, guards (with colocated tests). | |
| `clinic/*` | Core-clinic model: order/batch stamping, pincode resolver, workload snapshots (`workload.ts`), conflicts, reassignment, visibility. | |
| `dates/ist.ts` | All IST date logic: `getISTDateString`, 5 PM rollover, `isPastNextDayCutoff`. | |
| `onboarding/*` | Cutoff, daily preferences builder, discount, misc charge, category, routing, sections. | |
| `delivery/*` | Order statuses, delivery charge math, duty lifecycle, auto-off-duty sweep, batch completion, status notifications. | |
| `routing/googleRoutes.ts` | Google Routes `computeRoutes` with waypoint optimisation. | `computeOpenLoopRoute` |
| `distance.ts` | Haversine + open-loop fallback route. | `computeOpenLoopHaversineRoute` |
| `geocoding.ts` | Address → coordinates with pincode fallback. | `resolveAddressCoordinates` |
| `notifications.ts` + `notifications/*` | `notifyAdmins`, `sendNotificationToUser`, `buildPushPayload`, customer order notifications. | |
| `onesignal/server.ts` | OneSignal Node SDK wrapper. | |
| `payments/partialPaymentBreakup.ts`, `pricing/inclusive-tax.ts`, `coupons/*`, `invoices/index.ts` | Money math. | |
| `shop/*` | Clinic stock (`clinicStock.ts`), franchise stock failsafe, assisted order core/pricing/walk-in, retarget unlinked addon orders. | |
| `inventory/*` | Product schema (zod-like catalog shape), warehouse access, capability flags. `schema.ts.bak` is a leftover backup. | |
| `dietitian/*` | Scope, cadence, field sets, log slots, report card lifecycle, franchise customer scope. | |
| `accommodation/*`, `kit/*`, `subscriptions/overlap.ts`, `subscription/subscriptionNotifications.ts` | Product-line helpers. | |
| `appDistribution/*` | APK landing: config, content, manifest, QR, rate limit, slug, storage (signed URLs), Turnstile verify. | |
| `capacitor/*` | Web-safe stubs and native helpers: background-geolocation stub (delegates to `registerPlugin`), keep-awake, back button, splash, tracking permissions, OEM battery instructions. | |
| `automation/logging.ts` | `automation_logs` upserts and sub-task tracking. | |
| `pin/pinUtils.ts`, `mobile/normalizeMobile.ts`, `otp/otpPolicy.ts` | Input normalisation. | |
| `perf/server-timing.ts` | `createServerTimer` timing logs. | |
| Others | `logger.ts` (`logAdminAction`), `holidays.ts`, `zip.ts`, `utils.ts` (`cn`), `csv/exportCsv.ts`, `bulk-migration/*` (Excel import templates/validation), `address/*`, `customer/get-session.ts`, `customers/customerArchive.ts`, `products/catalog-queries.ts`, `cart/sync-cart-stock.ts`. | |

## 8. `src/validations/` (zod)

`onboardingSchema.ts`, `accommodationSchema.ts`, `healthLogSchema.ts`, `subscriptionPaymentSchema.ts`, `franchise.ts`, `franchiseSchemas.ts`, `franchiseInventory.ts`, `clinic.ts`, `clinicShopInventory.ts`, `dietitianSchema.ts`, `disputeSchema.ts`, `kitBulkImportSchema.ts`, `kitLifecycleSchema.ts`, `kitTrackerSchema.ts`, `addressSchema.ts`, `addressCaptureSchema.ts`, `profileSchema.ts`, `profileCompletionSchema.ts`, `adminProfileSchema.ts`, `passwordSchema.ts`, `realEmailSchema.ts`, `appDistribution.ts`. Note: zod is **v4** (`zod@^4.3.6`).

## 9. `src/types/`

One file per domain: `accommodation`, `bi-dashboard`, `clinic`, `clinicShop`, `dashboard`, `dietitian`, `dispute`, `franchise`, `franchiseInventory`, `kitLifecycle`, `kitProduct`, `kitShipping`, `onboarding`, `partialPayment`, `product`, `subscriptionPayment`. There is **no generated Supabase `Database` type**; query results are typed by hand or `any`.

## 10. `src/shared/`

| Folder | Contents |
|---|---|
| `components/ui/` (29) | shadcn primitives (button, card, dialog, select, table…). |
| `components/forms/` | `login-form.tsx` (shared email/password login), other forms. |
| `components/layout/` | `customer-header`, `customer-sidebar`, `rider-bottom-nav`, `RouteProgressBar`. |
| `components/loader/` | `GlobalLoader` and app-ready beacon. |
| `components/customer/` (26 + subfolders) | PIN/OTP forms, dashboard widgets, subscription plans/checkout/manage, meals, tracking map, kit tracker, health report, shop, `DeferredClientProviders`. |
| `components/admin/` | `core/`, `customers/` (41 files incl. `Customer360Dashboard`), `inventory/` (+ `ledger/`, `modals/`), `operations/`, `product-inventory/`, `subscriptions/`, `riders/`, `finance/`, `dashboard/`, `profile/`. Reused by franchise and master pages. |
| `components/rider/` (16) | `rider-status-toggle.tsx`, `LiveLocationTracker.tsx`, `BatteryPermissionOnboarding.tsx`, `NativeShellProvider.tsx`, `RiderLoginForm.tsx`, route cards. |
| `components/dietitian/` (14) | Health log workspace, report card UI. |
| `components/franchise/`, `master/`, `bi/`, `shop/`, `address/`, `app-download/`, `notifications/` (`OneSignalProvider`), `perf/`, `shared/invoice/` | Portal-shared pieces. |
| `hooks/` | `use-sync-cart-stock`, `useAutoOffDutyTimer`, `useFranchiseScope`, `useOffDutyReconcile`. |
| `stores/` | `useInventoryStore`, `useFranchiseInventoryStore` (zustand staging carts). |
| `utils/` | `admin-toast.ts`, `clinicStockErrors.ts`. |

## 11. `src/emails/`

`WelcomeEmail.ts`, `SubscriptionConfirmationEmail.ts`, `RiderPaymentEmail.ts`, `FranchiseWelcomeEmail.ts`, `AccountDeletedEmail.ts` — functions that return HTML strings, sent through `services/emailService.ts` (Resend).

## 12. `scripts/` (SQL, run by hand in the Supabase SQL editor)

Grouped by prefix:
- `create-*-rpc.sql` — Postgres functions: `onboard_customer`, `dispatch_to_franchise`, `accept/reject_franchise_transfer`, `receive_franchise_transfer`, `record_franchise_stock_out`, `franchise_shop_stock_in`, `transfer_stock`, `clinic_shop_apply_sale`, `clinic_shop_stock_in`, `place_assisted_addon_order`, `move_pincode`, `create/delete group with kitchen`, `move_franchise_to_group`, `provision_franchise_inventory`, `upsert_rider_live_location`, `verify_clinic_stock_ledger_parity`.
- `create-*-table(s).sql` — new tables (accommodation, clinic hierarchy, franchise, kit, dietitian, disputes, rate configs…).
- `create-*-rls*.sql`, `enable-/disable-franchise-rls.sql` — Row Level Security policies and on/off switches.
- `add-*.sql` — additive column migrations (franchise_id, clinic stamps, PIN columns, discounts, delivery charges…).
- `update-onboard-customer-with-*.sql`, `add-*-to-onboard-rpc.sql` — successive versions of the onboarding RPC.
- `create-subscription-payment-lifecycle.sql`, `create-subscription-early-closure-recalculation.sql`, `create-stay-*.sql` — payment and recalculation functions.
- `add-supabase-cron-jobs.sql` — the pg_cron schedule (contains a literal secret — do not copy).
- `backfill-*`, `fix-*`, `migrate-*`, `seed-*` — one-off data fixes and seeds.
- `update-master-admin-credentials.sql`, `set-default-temp-pin-for-existing-customers.sql` — credential scripts (may contain sensitive values; treat as secrets).
- `verify-apk-secrets.mjs/.sh` — checks an APK build for leaked secrets.

The base schema for older tables (users, subscriptions, delivery_orders…) is **not** in `scripts/`; it predates these files. `.clinerules` has an old snapshot.

## 13. `native/plugins/background-geolocation/`

Capacitor plugin fork. `src/definitions.ts` + `src/index.ts` (JS API), `dist/` (built), `android/src/main/java/com/equimaps/.../BackgroundGeolocation.java` (bridge), `android/.../com/arogyadiet/rider/location/*.java` (foreground service, engine, SQLite queue, sync worker, uploader, boot receiver, shift state, wake lock), `AndroidManifest.xml`. Details in `11-native-mobile-capacitor.md`.

## 14. Tests

- Colocated `__tests__/` folders under `actions/`, `services/`, `lib/`, `app/api/cron/auto-off-duty/`, some pages.
- `src/test/`: `a11y/`, `accommodation/`, `architecture/`, `customer-mobile-onboarding/`, `customer-pin-auth/`, `db/`, `dietitian/`, `inventory/`, `shop/`, `stubs/` (server-only stub), `setup-dom.ts`.
- `lib/franchise-inventory/*.test.ts`, `lib/shop/*.test.ts` colocated with source.
See `14-testing.md`.
