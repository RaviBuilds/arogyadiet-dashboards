# ArogyaDiet — External Integrations

> Every integration verified against imports/API calls in the codebase. Secrets are referenced by env-variable **name only** — no values recorded.
>
> **Evidence quality:** SDK presence = `CONFIGURATION` (`package.json`) + `DIRECT CODE` (import sites); wrapper behavior = `DIRECT CODE`; delivery/runtime configuration (Resend keys, CORS, SMS) = `UNVERIFIED` and labeled inline.

## Summary table

| Integration | Provider / SDK | Used by | Purpose | Entry point | Wrapper | Data in | Data out | Webhook | Retry/Fallback | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Supabase Postgres | `@supabase/supabase-js` + `@supabase/ssr` | All portals, all actions/services | Primary datastore (~90 tables, RLS, RPCs) | All server code | `src/lib/supabase/{client,server,admin,cached-auth,franchise-session}.ts` | SQL | rows | — | — | ✅ |
| Supabase Auth | same | customer/rider/admin/franchise/master logins | Sessions, email/password auth, phone OTP (unmounted flow) | login pages, `api/auth/{callback,recovery}` | `@supabase/ssr` cookie clients | credentials | session/JWT | — | — | ✅ (OTP ⚠️ unmounted) |
| Supabase Storage | same SDK | delivery proof images, product images, transfer package images, APK distribution, medical/agreement docs | File storage | actions using `.storage.from(...)` | — | files | URLs/paths | — | — | ✅ |
| Razorpay | `razorpay` node SDK + Checkout.js | customer subscription + shop checkout; admin/franchise manual entry | Payments | `checkoutActions.ts`, `shop-actions.ts`, webhook | — | orders/payments | payment confirmation | `POST /api/webhooks/razorpay` (ADDON only) | in-app resume reconcile (subscription flow) | ✅ (subscription webhook gap documented) |
| OneSignal | `@onesignal/node-onesignal` + web SDK v16 | customer push, admin notifications, sandbox | Push notifications | `lib/onesignal/server.ts`, `lib/notifications*`, `/sandbox` | `notifyAdmins`, `sendNotificationToUser`, `buildPushPayload` | title/message/actionUrl | in-app + push | — | — | ✅ |
| Resend | `resend` SDK | emailService + cron notifications | Transactional email | `emailService.ts`, `src/emails/*` (5 templates) | — | email payloads | — | — | — | ✅ (`UNVERIFIED` delivery config) |
| Google Maps JS | `@react-google-maps/api`, `@googlemaps/js-api-loader` | admin/master tracking, franchise kitchen, customer tracking | Map rendering | map components | — | markers/polyline | UI | — | — | ✅ |
| Google Routes | REST `routes.googleapis.com/directions/v2:computeRoutes` | dispatch/route engine | Route optimization (waypoint order, distance, polyline) | `src/lib/routing/googleRoutes.ts` ← `routeEngine.ts` | field-masked fetch | waypoints | distance/duration/polyline | — | Haversine fallback (`src/lib/distance.ts`) | ✅ |
| Google Geocoding | fetch wrapper | address capture | lat/lng resolution | `src/lib/geocoding.ts` | — | address | lat/lng | — | `UNVERIFIED` fallback | ✅ |
| Cloudflare Turnstile | REST verify | APK download grant | Bot protection | `api/app-download/grant` | `src/lib/appDistribution/turnstile.ts` | token | pass/fail | — | — | 🟡 registration operator task unchecked |
| Supabase pg_cron (external scheduler) | DB extension | 11 cron routes | Scheduling | `scripts/add-supabase-cron-jobs.sql` → `net.http_get` | — | HTTP GET + secret | job runs | — | — | ✅ (config lives in DB, not repo CI) |

## Razorpay flow detail

Two client flows + one webhook:

1. **Subscription checkout** (`checkoutActions.ts`): create Razorpay order → Checkout.js → client `handler` → `verifyAndActivateSubscriptionAction` → activate subscription + `payments` row. Reconcile-on-resume action exists. **No webhook reconciliation** (checkoutData not persisted pre-payment — documented limitation).
2. **Add-on/shop checkout** (`shop-actions.ts`): same client path (`verifyAddonPayment`) **plus** webhook backstop: `POST /api/webhooks/razorpay` verifies HMAC signature, handles `payment.captured`/`order.paid`, only acts on `checkout_type === "ADDON"`, idempotent on `razorpay_transactions.razorpay_payment_id` unique constraint, updates `payments`→PAID and `addon_orders`→PAID, calls `decrement_franchise_product_stock` per item, notifies customer + admins.
3. **Manual entry** (admin/franchise finance): recorded directly, no gateway call (franchise delivery fee forced 0 per features doc).

## Environment variables (names only — no values)

Server: `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `CUSTOMER_SERVER_PASSWORD` (migration route), `FRANCHISE_FEATURES_ENABLED`.
Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_ONESIGNAL_APP_ID`, `NEXT_PUBLIC_ONESIGNAL_ALLOWED_HOSTNAMES`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_PERF_TIMING`, `NEXT_PUBLIC_STARTUP_TRACE`, `NEXT_PUBLIC_STARTUP_TRACE_ID`.
Also present: Razorpay key id (public, `NEXT_PUBLIC_RAZORPAY_*`) and Resend key (`UNVERIFIED` names — used inside wrappers; key itself env-based). Google Routes API key `UNVERIFIED` whether it shares `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` or has its own server var.

## Native ↔ backend integration

The APK's native GPS layer posts locations **directly to Supabase** (service credentials embedded in the app — see `11-native-mobile-architecture.md` for the security note), bypassing the Next.js server. All other external calls flow through the Next.js server.

## Explicitly absent integrations

No WhatsApp, no analytics SDK (no GA/Segment found), no CAPTCHA other than Turnstile, no third-party SMS provider in-repo (Supabase Auth handles SMS for OTP), and **no AI/model providers** (see `04-ai-model-architecture.md`).

