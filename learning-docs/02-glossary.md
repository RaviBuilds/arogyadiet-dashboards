# 02 — Glossary

Each term: a plain explanation, then where it appears in this codebase.

| Term | Plain meaning | Where in ArogyaDiet |
|---|---|---|
| **App Router** | Next.js routing based on folders in `app/`, with layouts and Server Components | `src/app/**` |
| **Pages Router** | Older Next.js router using `pages/` | only `src/pages/architecture/*` (temporary doc viewer) |
| **Route group** | Folder in parentheses that organises routes without changing the URL | `(auth)`, `(main)`, `(public)` |
| **RSC (React Server Component)** | Component that runs only on the server and can `await` data | every `page.tsx`/`layout.tsx` without `"use client"` |
| **Client component** | Component with `"use client"`; runs in the browser, has state/events | `meal-planner-client.tsx`, `ReceiveTransferControls.tsx` |
| **Server Action** | Async function in a `"use server"` file, called from the client like a function; really an HTTP POST | `src/actions/**` |
| **Route handler** | `route.ts` answering raw HTTP | `src/app/api/**` |
| **Middleware / Proxy** | Code that runs before every matched request (renamed `proxy` in Next 16) | `src/middleware.ts` |
| **Rewrite** | Serve a different internal path without changing the browser URL | middleware subdomain → `/admin`, `/customer`… |
| **Subdomain** | Prefix of a host (`admin.` in `admin.arogyadiet.com`) | portal selection |
| **`revalidatePath`** | Mark cached render output for a path as stale | most actions |
| **`router.refresh()`** | Re-fetch the current route's RSC payload | client components after actions |
| **`after()`** | Run code after the response is sent | cron routes |
| **React `cache()`** | Deduplicate a function call within one server request | `get-session.ts`, `cached-auth.ts` |
| **Suspense / streaming** | Show fallback while async parts load; stream HTML in chunks | `customer/layout.tsx`, `loading.tsx` files |
| **`next/dynamic`** | Lazy-load a component, optionally client-only | `DeferredClientProviders.tsx` |
| **Supabase** | Hosted Postgres + Auth + Storage + Realtime + APIs | everywhere |
| **PostgREST** | Supabase's auto-generated REST API over Postgres used by supabase-js | `.from()`, `.rpc()` |
| **Anon key** | Public Supabase key for browser/app clients; access controlled by RLS/grants | `NEXT_PUBLIC_SUPABASE_ANON_KEY`, native uploader |
| **Service-role client** | Supabase client with the secret service key; bypasses RLS | `createAdminClient()` in `src/lib/supabase/admin.ts` |
| **Session (SSR) client** | Supabase client built from request cookies; RLS applies | `src/lib/supabase/server.ts` |
| **JWT** | Signed token carrying user identity and expiry | Supabase session cookies |
| **`auth.getUser()`** | Server-verified identity lookup (vs `getSession` which only decodes) | middleware, layouts, actions |
| **RLS (Row Level Security)** | Postgres rules that filter rows per request | `scripts/*rls*.sql`, `supabase/migrations/*rls*.sql` |
| **Policy** | One RLS rule for SELECT/INSERT/UPDATE/DELETE | `CREATE POLICY ...` in scripts |
| **RPC** | Calling a Postgres function over the API | `supabase.rpc("dispatch_to_franchise", ...)` |
| **Postgres function (plpgsql)** | Stored procedure written in SQL/plpgsql; body runs in one transaction | `scripts/create-*-rpc.sql` |
| **SECURITY DEFINER** | Function runs with its owner's privileges, not the caller's | most RPCs; `upsert_rider_live_location` |
| **`search_path`** | Which schemas Postgres looks in; fixed in definer functions for safety | `SET search_path = public` |
| **GRANT / REVOKE EXECUTE** | Who may call a function | only a few scripts grant explicitly |
| **Transaction** | Group of writes that all succeed or all fail | inside RPCs; not across supabase-js calls |
| **`FOR UPDATE`** | Row lock inside a transaction to prevent concurrent changes | FIFO lots, transfers, KIT trigger |
| **Trigger** | Function the DB runs automatically on writes | KIT tracker sync, received-date lock, ledger immutability |
| **CHECK constraint** | DB rule that a column value must satisfy | statuses, lat/lng ranges |
| **UNIQUE constraint** | No two rows may share a value | `groups.kitchen_id`, service-area pincode |
| **Foreign key** | Column that must reference an existing row | `subscriptions.customer_profile_id` |
| **Index** | Lookup structure to speed filters/joins | `idx_*` in scripts |
| **View** | Saved query you can select from | `v_report_card_editability`, `v_health_log_timeline` |
| **JSONB** | JSON stored in a column | `users.admin_operations_access` |
| **Migration** | Script that changes the schema | `scripts/*.sql`, `supabase/migrations` |
| **Idempotent** | Running twice has the same effect as once | order generation, transfer receive, webhook |
| **Idempotency key** | Unique id used to detect repeats | `razorpay_payment_id`, order generation key |
| **Compensating action** | Undo step when a cross-system transaction is impossible | delete auth user if `onboard_customer` fails |
| **Ledger** | Append-only record of every movement | `inventory_transactions`, `clinic_product_ledger`, `franchise_inventory_ledger`, payment ledgers |
| **Derived balance** | Balance computed from the ledger, not stored | `deriveSubscriptionBalance`, `deriveStayBalance` |
| **Lot / batch** | One quantity of stock with its own expiry/cost | `inventory_lots`, `franchise_inventory_lots` |
| **FIFO** | First in, first out (here: earliest expiry first) | dispatch, stock-out RPCs |
| **State machine** | Fixed set of states and allowed transitions | transfers, disputes, report cards, stays |
| **Multi-tenancy** | One system serving isolated tenants | franchises via `franchise_id` |
| **Tenant / scope** | The data partition a user may act on | `resolveScope()` → full_network / franchise / core |
| **Stamping** | Writing tenant/clinic ids onto a row at creation | `stampFranchiseId`, `resolveOrderClinicStamp` |
| **RBAC** | Permissions based on roles | `roles.code` + access levels |
| **Access level** | Sub-type of ADMIN/FRANCHISE_ADMIN | `inventory`, `operations`, `inventory_operations`, `dietitian` |
| **Operations group** | Admin section with manage/view permission | `OPERATIONS_GROUPS` in `adminAccessCore.ts` |
| **Manage / view** | Write vs read-only permission | `canManageGroup` / `hasGroupAccess` |
| **Franchise owner override** | Owner gets full access regardless of level | middleware, layout, `resolveFranchiseAccessContext` |
| **Clinic-scoped admin** | Operations admin limited to one core clinic | `users.admin_clinic_id` |
| **Feature flag** | Switch to enable code paths | `FRANCHISE_FEATURES_ENABLED` |
| **Defense in depth** | Several independent checks | middleware + layout + action + DB |
| **Webhook** | Server-to-server HTTP callback from a provider | `/api/webhooks/razorpay` |
| **HMAC** | Keyed hash proving a message came from the key holder | Razorpay signature checks |
| **Razorpay order / payment** | Order = intent with amount; payment = actual charge | `orders.create`, `fetchPayments` |
| **Checkout.js** | Razorpay's browser payment popup | `step-5-preview.tsx`, shop checkout |
| **Reconciliation** | Comparing our records with the provider's to fix gaps | `checkAndReconcile*PaymentAction` |
| **Cron** | Time schedule for jobs | `scripts/add-supabase-cron-jobs.sql` |
| **pg_cron** | Postgres cron extension | Supabase jobs |
| **pg_net** | Postgres HTTP client extension | `net.http_get` |
| **IST** | India Standard Time, UTC+5:30 | `src/lib/dates/ist.ts` |
| **Cutoff (5 PM rule)** | After 17:00 IST, tomorrow can't be edited | `isPastNextDayCutoff` |
| **Pause credits** | Days a customer may pause; extend end date | `subscriptions.pause_credits_*`, `manageMealActions.ts` |
| **Daily preferences** | One row per subscription day | `subscription_daily_preferences` |
| **Workload snapshot** | Per-clinic meal/product counts for the kitchen | `workload_snapshots`, `src/lib/clinic/workload.ts` |
| **Dispatch / batch** | Assigning orders to riders; one batch per rider per day | `routeEngine.ts`, `delivery_batches` |
| **Haversine** | Straight-line distance on a sphere | `src/lib/distance.ts` |
| **Waypoint optimisation** | Provider reorders stops for shortest route | Google Routes `optimizeWaypointOrder` |
| **Field mask** | Header listing response fields to return | `X-Goog-FieldMask` |
| **Geocoding** | Address/pincode → coordinates | `src/lib/geocoding.ts` |
| **Supabase Realtime** | Push DB changes to browsers over WebSocket | `LiveTrackingMap.tsx` |
| **OneSignal** | Push notification service | `src/lib/onesignal/server.ts`, `OneSignalProvider.tsx` |
| **External id** | Our user id registered in OneSignal to target pushes | `OneSignal.login(userId)` |
| **Resend** | Email API | `src/services/emailService.ts` |
| **Turnstile** | Cloudflare's CAPTCHA alternative | `src/lib/appDistribution/turnstile.ts` |
| **Signed URL** | Temporary link to a private Storage file | APK download, documents |
| **Capacitor** | Native shell around a web app with plugin bridge | rider APK, `capacitor.config.json` |
| **Plugin / bridge** | Native code callable from JS | `BackgroundGeolocation.java` |
| **WebView** | Browser embedded in the app | rider app |
| **Foreground service** | Android service with a persistent notification allowed to run in background | `LocationForegroundService.java` |
| **Doze / App Standby** | Android battery modes that suspend background work | tested in steering doc |
| **START_STICKY** | Ask Android to restart a killed service | foreground service |
| **Wake lock** | Keep CPU awake | `WakeLockManager.java` |
| **Heartbeat** | Periodic "still alive" signal | 30 s native re-upload |
| **Offline queue** | Local storage of pending uploads | `LocationQueue.java` (SQLite) |
| **zod** | TypeScript-first schema validation library (v4 here) | `src/validations/**` |
| **react-hook-form / zodResolver** | Form state library + zod adapter | onboarding, dialogs |
| **zustand** | Small global state library | `useCartStore`, inventory stores |
| **`persist` middleware** | zustand plugin saving state to localStorage | cart |
| **Property-based testing** | Tests over many generated inputs | fast-check, `*.property.test.ts` |
| **fast-check** | JS property-testing library | 219 test files |
| **axe-core** | Accessibility checker | `src/test/a11y` |
| **vitest** | Test runner | `vitest.config.ts` |
| **`server-only`** | Import that fails the build if bundled for the client | `src/lib/auth/adminAccess.ts` |
| **Placeholder email** | Generated internal email for customers without one | `src/lib/onboarding/testEmail.ts` |
| **PIN / temp PIN** | 6-digit customer login code; temp PIN set by staff, must be changed | `PinService.ts` |
| **Throttle / lockout** | Limit attempts, then block for a period | `PinThrottleService.ts` |
| **Kiro spec** | Requirements/design/tasks documents per feature | `.kiro/specs/**` |
| **Steering file** | Always-loaded AI agent guidance | `.kiro/steering/**` |
