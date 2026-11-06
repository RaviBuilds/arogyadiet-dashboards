# Architecture Questions (with model answers)

Each answer points to files. "Follow-ups" are what a senior interviewer is likely to ask next.

**1. Give me the architecture in one diagram.**
Browser/APK → `src/middleware.ts` (subdomain rewrite, session, role gates) → `(main)/layout.tsx` (re-check) → RSC page (Supabase reads) → client component → Server Action (`src/actions/**`) → service (`src/services/**`) → table query or Postgres RPC (`scripts/*.sql`). Cron: pg_cron → `/api/cron/*`. Payments webhook → `/api/webhooks/razorpay`. GPS: native service → RPC. See `01-big-picture.md`.
Follow-ups: why not a separate backend? (one deployable, typed calls, small team); where does business logic live? (services + pure `lib`).

**2. Why one app with five portals instead of five apps?**
Shared domain model, components and services (`src/shared`, `src/services`); one deploy; isolation via subdomain + role gates. Trade-off: one bad shared change can hit every portal — mitigated by "do no harm" rules (`docs/system-rules.md`) and tests.
Follow-up: how do you stop cross-portal imports? Convention in `.kiro/steering/structure.md`; not enforced by lint (could add `eslint-plugin-boundaries`).

**3. How does subdomain routing work?**
`portals` map in `middleware.ts`; `NextResponse.rewrite` to `/admin...` etc.; `*.vercel.app` previews map to customer; unknown named subdomains → `/unauthorized` when the franchise flag is on.
Follow-up: how is login redirect kept on the same subdomain? `new URL("/login", request.url)`.

**4. Why Server Actions + Postgres functions rather than REST?**
Server Actions remove API boilerplate and are type-safe; Postgres functions give atomic multi-table writes with row locks (`dispatch_to_franchise`, `receive_franchise_transfer`, `onboard_customer`). REST routes are used only where a third party calls us (cron, webhook, PDF downloads, APK grant).
Follow-up: drawbacks? Actions are public endpoints needing explicit gates; logic in SQL is harder to unit-test (hence DB integration tests in `src/test/db`).

**5. What is the layering, and is it strict?**
Action (auth, validation, revalidate) → service (rules) → repository (queries). Not strict: many actions query directly. Shared "core" services (`customerManagementCore.ts`) are ungated and wrapped per portal.

**6. How is multi-tenancy modelled?**
`franchise_id` column (NULL = core) on tenant tables + clinic hierarchy; scope from session (`resolveScope`, `resolveFranchiseContext`); stamping on insert (`stampFranchiseId`); RPCs re-check ownership. See `06`.
Follow-up: why not schema-per-tenant? Few tenants, cross-tenant BI for master, shared catalog — column partitioning is simpler.

**7. Where is RLS used and where is it bypassed?**
Session client (customer/rider pages and actions, layouts) → RLS applies. Service role (admin/franchise/master actions, cron, webhook) → bypass, with app-level checks. Franchise RLS policies exist but rely on transaction-local settings, so the app does not depend on them.

**8. Explain the daily pipeline and its failure handling.**
14:00 activate → 17:15 generate orders → 23:55 link + dispatch (via `after()`) → snapshots → notifications. Re-runnable; manual re-run from `/operations`; no automatic retry in production (pipeline-with-retry exists only in tests). See `10`.
Follow-up: what if dispatch partially fails? Per-rider errors isolated; reset on re-run rebuilds everything re-routable.

**9. Why pg_cron instead of Vercel Cron?**
`vercel.json` crons empty; schedules live next to the data, with run history in `cron.job_run_details` and `net._http_response`. Routes are GET with a shared secret. (The exact original reason is not documented — say "kept scheduling with the database and avoided plan limits".)

**10. How do you avoid cron timeouts?**
Main task only, then `after()` for slow follow-ups; `timeout_milliseconds := 30000` on pg_net; `maxDuration = 60`.

**11. How is the rider app built?**
Capacitor shell with `server.url` to the rider subdomain; web deploys update the app instantly; native GPS plugin maintained in `native/`, copied into the separate Android repo. See `11`.

**12. How do you handle time zones?**
All business dates in IST via `Intl.DateTimeFormat` with `Asia/Kolkata` (`src/lib/dates/ist.ts`); pure helpers for tests; 17:00 rollover constant.

**13. How is routing computed?**
Per core clinic, pincode → rider via `rider_service_areas`, fixed overrides, ≤20 stops, Google Routes TWO_WHEELER `optimizeWaypointOrder` with the farthest stop as destination, Haversine × 1.3 fallback; per-leg payout. `routeEngine.ts`, `googleRoutes.ts`.

**14. How are feature flags used?**
`FRANCHISE_FEATURES_ENABLED` exactly `"true"`; when off, franchise branches are inert but compiled (`src/lib/franchise/constants.ts`). Allowed incremental rollout without breaking core production.

**15. How do you ensure data consistency across Auth and Postgres?**
Compensation: create Auth user first, call atomic RPC, delete Auth user if RPC fails (`OnboardingService.onboard`, `adminActions.createAdminUser`).

**16. What are ledgers used for?**
Inventory transactions, clinic product ledger (append-only by trigger), franchise inventory ledger, subscription and stay payment ledgers with derived balances.

**17. How would you scale it?**
Move BI aggregation to SQL views/materialised views; add caching for read-heavy master pages; queue for notifications; split cron work by clinic; generated DB types. The routing engine already parallelises per rider.

**18. What did you change in Next.js 16 specifically?**
Uses App Router, `after()`, React 19 (`useActionState`), Turbopack aliases. `middleware.ts` still uses the deprecated name (Next 16 renamed it to `proxy.ts`) — a planned codemod.

**19. What is the biggest architectural risk today?**
Authorization relies on every Server Action remembering its gate, and some do not (`16`). The fix is a mandatory wrapper or static test plus revoking EXECUTE on SECURITY DEFINER functions.

**20. If you started again, what would you do differently?**
JWT-claim RLS for tenancy, generated DB types, a single `withGate()` helper for actions, all multi-row writes as RPCs from day one, CLI-managed migrations.
