# ArogyaDiet — Executive System Map

> **Level 1 — Client-facing view.** Every claim is grounded in the actual repository (file paths cited) or in the supplied `AROGYADIET_DASHBOARDS_FEATURES.md` and SQL schema. Items that could not be verified are labeled `UNVERIFIED`.
>
> Companion technical documents live in this folder: see `14-architecture-inventory.md` for the full index.

---

## 1. What has been built

ArogyaDiet is a **multi-portal, multi-tenant SaaS platform** for three related product lines that all run through one shared spine (customers → subscriptions → dietitians → deliveries):

1. **Meal Subscription** — daily cooked-meal delivery with pause credits, per-day address changes and dietary preferences.
2. **KIT** — a shipped, self-administered diet kit tracked day-by-day by the customer with dietitian oversight.
3. **Accommodation / Stay** — an in-clinic wellness stay with nightly billing, extensions, add-on services and health reports.

A fourth axis, **Franchise**, gives a second tenant model: a franchise operator runs a franchise-scoped copy of most operational tools against `franchise_id`-partitioned data.

### One-line story

```
AROGYADIET
     │
     ▼
Multi-Portal Platform (5 isolated portals, subdomain-routed)
     │
     ├── Customers  (subscribe, track, pay, log health, shop)
     ├── Operations (admin + franchise: onboarding, dispatch, inventory, finance)
     └── Management (master: BI, hierarchy, rates, disputes)
     │
     ▼
Shared Business Logic (Server Actions → Services → Repositories → RPCs)
     │
     ▼
Data + Integrations
     ├── Supabase (Postgres + RLS + Auth + Storage)
     ├── Razorpay (payments)
     ├── OneSignal (push), Resend (email)
     ├── Google Maps + Google Routes (tracking + routing)
     └── Native Android (rider background GPS app)
```

**AI / models: none.** A full repository sweep (1,657 files, package.json, env references, all provider-name and SDK patterns) found **no AI/model-provider integration of any kind**. See `04-ai-model-architecture.md` for the negative-evidence evidence list.

---

## 2. How the platform works

Five portals run behind subdomain routing enforced in `src/middleware.ts`:

| Subdomain | Rewritten path | Role | Purpose |
|---|---|---|---|
| `customer.*` | `/customer` | Customer session | Self-service subscriber portal |
| `deliverypartner.*` | `/rider` | Rider session | Mobile delivery portal (runs inside the Capacitor APK) |
| `admin.*` | `/admin` | `ADMIN` (+ access-level tiers) | Core-business operations control center |
| `franchies.*` | `/franchise` | `FRANCHISE_ADMIN` | Franchise-scoped operations portal |
| `master.*` | `/master` | `MASTER_ADMIN` | BI / super-admin / hierarchy provisioning |

All server logic is Next.js App Router **Server Components + Server Actions**. Data flows through a strict chain:

```
UI (React) → Server Actions (src/actions) → Services (src/services)
           → Repositories (src/repositories) → Postgres RPCs → Supabase Postgres
```

Row Level Security (RLS) is the database boundary; the service-role client (`createAdminClient`) is used only where the application itself re-enforces scope (documented in `08-security-and-scoping.md`).

## 3. What major features are live

Status legend: ✅ verified live · 🟡 live with caveat · ⚠️ built but unmounted/partial · ⛔ stub

| Capability | Customer | Rider | Admin | Franchise | Master |
|---|---|---|---|---|---|
| Meal subscription lifecycle | ✅ | — | ✅ | ✅ | 🟡 report-only |
| KIT product line (tracker, history, expiry) | ✅ | — | ✅ | 🟡 shared components | 🟡 BI only |
| Accommodation/Stay (tracker, billing, invoices) | ✅ | — | ✅ | 🟡 shared | 🟡 BI only |
| Pause credits / per-day planner | ✅ | — | ✅ bulk override | ✅ | — |
| Shop / add-on orders | ✅ | — | ✅ assisted | ✅ own catalog | 🟡 BI only |
| Razorpay payments | ✅ 2 flows | — | 🟡 manual entry | 🟡 manual | — |
| PIN login / OTP login | ✅ / ⚠️ unmounted | — | — | — | — |
| Live GPS tracking | ✅ view | ✅ native background | ✅ map view | 🟡 shared | — |
| Dispatch / route assignment | — | ✅ consumes | ✅ manual + sandbox | ✅ own scope | — |
| Rider payouts | — | ✅ views | ✅ settles | 🟡 own riders | ✅ BI + settle view |
| Inventory (warehouse / transfers / clinic shop) | — | — | ✅ | ✅ (no warehouse view) | ✅ |
| Dietitian workspace + report cards | — | — | ✅ | ✅ | ✅ |
| Disputes | — | — | — | ✅ raise | ✅ resolve |
| Hierarchy + rate configuration | — | — | — | — | ✅ |
| BI dashboards | — | — | 🟡 exec summary | — | ✅ |
| APK distribution (QR landing) | ✅ | ✅ login QR | — | — | — |

## 4. How the business flows work (plain-language)

- **Daily meal delivery:** every evening an automation generates tomorrow's delivery orders from active subscriptions, links any shop/add-on purchases to those orders, snapshots kitchen workload per clinic, then assigns riders by pincode and builds optimized routes. Riders use the Android app: go on duty (background GPS starts), pick up, mark each stop, and payouts accrue per kilometer. A monthly job rolls payouts into rider summaries for settlement.
- **Subscription payment:** customer checks out → Razorpay → client callback verifies and activates. The shop/add-on flow additionally has a server webhook backstop for Android UPI app-switch interruptions; the subscription flow does **not** (documented design limitation, see `06-business-workflows.md` §5).
- **KIT:** admin provisions kit → ships by courier → customer logs daily food/weight/activity → kit auto-expires → PDF report.
- **Accommodation:** booking → stay activation → daily health logs (customer + admin) → extensions/early checkout with recalculation → final invoice → health report.
- **Franchise inventory:** central kitchen dispatches stock (FIFO lot-locked RPC) → franchise accepts/rejects → receives into its own inventory → stock-outs on sale → optional move into its customer shop.

## 5. What remains (honest gaps, evidence-based)

The most consequential, verified items — full analysis in `13-completed-vs-next.md`:

1. **Rider payout `net_payable`/`total_earnings` column mismatch** — settlement cron writes `total_earnings`; payout UI/leaderboard read `net_payable`; the fill path for `net_payable` was not located. Genuine functional gap (also flagged in `AROGYADIET_DASHBOARDS_FEATURES.md` §12).
2. **Subscription checkout is not webhook-reconciled** — a UPI app-switch kill during subscription payment leaves the payment captured on Razorpay with no subscription activation; the code itself documents this (`src/app/api/webhooks/razorpay/route.ts` header comment).
3. **OTP login unmounted** — complete (`src/services/OtpLoginService.ts`, `src/actions/mobileAuthActions.ts`, `MobileOtpLoginForm.tsx`, unit + wiring + a11y tests) but not referenced by `/login`; superseded by `MobilePinLoginForm` per `.kiro/specs/customer-pin-auth/design.md`. Deliberate or oversight is unresolved.
4. **Cron scheduling lives outside `vercel.json`** — `vercel.json` has `"crons": []`; actual scheduling is Supabase pg_cron (`scripts/add-supabase-cron-jobs.sql`) calling `admin.arogyadiet.com/api/cron/*`. The SQL script contains a **hardcoded secret value** that should be rotated/parameterized.
5. **Dead/legacy routes** — e.g. `src/app/rider/subscription`, `src/app/rider/tracking`, `src/app/master/subscription` vs `master/(main)/subscriptions` (duplicate surfaces), `src/app/sandbox` (OneSignal test page), `/api/temp-fix-schema`, `/api/migrate/*` (ops one-offs exposed as routes), `admin/(main)/test-routing` (routing sandbox).
6. **Spec-level verification gaps** — `.kiro/specs/report-card-lifecycle` and `app-apk-distribution` tasks lists contain unchecked items (PDF export, operator steps, end-to-end verification).

## 6. What we do next (recommended order)

1. Close the rider-payout column mismatch (production-blocker class).
2. Persist subscription `checkoutData` server-side pre-payment and extend the Razorpay webhook to reconcile the subscription flow (reliability).
3. Decide OTP login fate: mount, or delete the dead path (code hygiene).
4. Rotate the pg_cron secret embedded in `scripts/add-supabase-cron-jobs.sql` and move it out of source (security).
5. Remove or gate the dead routes and ops/migration endpoints (attack-surface reduction).
6. Close the unchecked spec items (report-card PDF, APK distribution verification).

---

*Full traceability: every claim above is expanded with file paths and status in `02-portal-feature-map.md`, `06-business-workflows.md`, `07-database-domain-map.md`, `10-automation-and-cron.md`, `11-native-mobile-architecture.md`, and `14-architecture-inventory.md`.*


