# Learning Docs — Progress Tracker

Baseline before any doc was written (2026-11-02 02:37 IST): `git status --short` returned **empty** (clean working tree) on commit `0e3fadd`.

Resume rule: if a session restarts, read this file and continue from the first unchecked item.

## Core docs (write order: 03, 01, 04, 05, 06, 07, 08, modules, flows, 09-13, 14-16, interview-prep, 17, 02, 00)
- [x] 03-folder-and-file-map.md
- [x] 01-big-picture.md
- [x] 04-request-lifecycle.md
- [x] 05-auth-and-single-login.md
- [x] 06-rbac-and-multitenancy.md
- [x] 07-database-for-a-frontend-dev.md
- [x] 08-server-actions-services-repositories.md
- [x] modules/* (list below)
- [x] flows/* (list below)
- [x] 09-integrations.md
- [x] 10-cron-and-automation.md
- [x] 11-native-mobile-capacitor.md
- [x] 12-frontend-patterns-and-components.md
- [x] 13-state-and-data-sources-of-truth.md
- [x] 14-testing.md
- [x] 15-kiro-specs-digest.md
- [x] 16-known-issues-and-tech-debt.md
- [x] interview-prep/* (list below)
- [x] 17-self-quiz-and-exercises.md
- [x] 02-glossary.md
- [x] 00-START-HERE.md
- [x] Final quality pass + git status check

## Final quality pass (2026-11-02 ~08:30 IST)
- `git status --short` after writing: only `?? learning-docs/` (untracked new folder). No existing project file was modified.
- 62 files in `learning-docs/` (~436 KB): 20 core docs, 25 modules, 10 flow files (11 flows; KIT + stay share one file), 8 interview-prep files.
- Secret scan of learning-docs (cron secret literals, JWT prefixes, live/test Razorpay keys, personal email, phone numbers, default temp PIN): no matches.
- Doc references: every backticked `*.md` reference to a learning-docs file resolves; unresolved names are repo files outside learning-docs (AGENTS.md, CLAUDE.md, spec files) — intended.
- Mermaid: heuristic lint (semicolons in sequence diagrams, unquoted parentheses in flowchart labels); two semicolons fixed; ER block made multi-line. Not rendered in a Mermaid engine — rendering is UNVERIFIED.
- Portal coverage: Customer, Rider, Admin, Franchise, Master each have module docs and at least one flow.

## UNVERIFIED items (need DB / other-repo access)
- Which `scripts/*.sql` were actually applied; live `cron.job` schedule (link-products date issue).
- EXECUTE grants on SECURITY DEFINER functions; whether franchise RLS is enabled.
- Whether `net_payable` exists as a generated column/trigger in the DB.
- UNIQUE constraints on `razorpay_transactions` and order-generation keys.
- Capacitor `server.url` (lives in the separate rider-mobile-app repo).
- Storage bucket policies; Realtime publication for `rider_live_locations`.
- Exploitability of ungated Server Actions (code reading only; no requests sent).
- KIT PENDING→ACTIVE exact transition point; reject-transfer stock return path.

## Modules
Planned (tick when written):
- [x] customer-subscription-checkout.md
- [x] customer-meal-planner-and-pause.md
- [x] shop-and-addons.md
- [x] dispatch-and-routing.md (incl. order generation + workload)
- [x] rider-duty-and-gps.md
- [x] rider-route-and-delivery.md
- [x] rider-payouts.md
- [x] customer-live-tracking.md
- [x] admin-onboarding.md
- [x] admin-customer-360-and-operations.md
- [x] central-inventory-and-manufacturing.md
- [x] clinic-shop-inventory.md
- [x] franchise-inventory-transfers.md
- [x] franchise-portal-operations.md
- [x] franchise-disputes.md
- [x] master-hierarchy-and-rates.md
- [x] master-users-and-access.md
- [x] master-bi-and-finance.md
- [x] dietitian-report-cards.md
- [x] kit-lifecycle.md
- [x] accommodation-stay.md
- [x] partial-payments-and-billing.md
- [x] notifications.md
- [x] app-apk-distribution.md
- [x] customer-login-and-profile.md

## Flows
- [x] customer-login.md
- [x] subscription-purchase-razorpay.md
- [x] daily-order-generation-and-dispatch.md
- [x] rider-duty-delivery-payout.md
- [x] franchise-stock-transfer.md
- [x] shop-order-with-webhook.md
- [x] report-card-lifecycle.md
- [x] kit-and-stay-lifecycles.md (KIT + stay)
- [x] middleware-decision-tree.md
- [x] franchise-permission-check.md

## Interview prep
- [x] pitch.md
- [x] architecture-questions.md (20)
- [x] frontend-nextjs-questions.md (20)
- [x] backend-database-questions.md (21)
- [x] security-rbac-questions.md (20)
- [x] system-design-questions.md (18)
- [x] tricky-questions.md (20)
- [x] weak-spots-and-honest-answers.md

## Notes / learnings for resume (verified from code, session 1)
- Next 16.2.6: `src/middleware.ts` uses the DEPRECATED `middleware` convention (renamed `proxy` in v16, see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
- `src/pages/architecture/*` = temporary Pages Router viewer of architecture-analysis/ (public; middleware bypass for /architecture).
- Admin inventory lives ONLY at `src/app/admin/inventory/**` (own layout, inventory-level gate). Old docs' "duplicate admin/(main)/inventory" is stale. No `/api/temp-fix-schema`, no `admin/(main)/test-routing`, no `master/subscription` in current tree (docs stale).
- `runDailyPipeline` (system-actions/dailyPipeline.ts) is called ONLY by tests. Production = separate cron routes: generate-orders (17:15 IST) and link-products (23:55 IST per SQL) which runs dispatch via `after()`.
- link-products route uses getISTDateString(0); SQL schedules 18:25 UTC = 23:55 IST (route comment says ~12:05 AM) -> suspected wrong-day bug. VERIFY cron.job in DB.
- generate-rider-payments: fallback secret literal, NOT scheduled in SQL. cleanup-dispatch-images: hardcoded literal secret in code. SQL file has literal secret (never copy).
- Rider payout page: history reads total_earnings, leaderboard + dashboard read net_payable.
- CRITICAL: /api/reset-franchise-password (unauthenticated, resets ANY user password by email); /api/migrate/* unauthenticated. middleware returns early for /api.
- setPermanentPinAction(mobile,newPin,confirmPin) does not verify caller proved temp PIN -> possible account takeover. Middleware isTempPin never assigned (dead guard).
- Customer PIN login: shared CUSTOMER_SERVER_PASSWORD + signInWithPassword(email from users.mobile).
- checkoutActions.activateSubscription: not atomic, trusts client checkoutData.customerProfileId, verify path has no idempotency check (reconcile path does).
- Webhook only ADDON; doesn't run clinic_shop_apply_sale for core clinic orders (only franchise decrement).
- Franchise RLS uses set_config(...,true) tx-local -> doesn't persist across PostgREST calls; franchise pages use cookie x-franchise-id + createAdminClient + explicit .eq filters.
- Most SECURITY DEFINER RPCs in scripts have no REVOKE EXECUTE (Supabase default grants to anon/authenticated) -> VERIFY ACLs.
- runProductLinkingAction exported from "use server" systemActions.ts; gate only when source==="manual" (default "cron").
- Native: APK in separate repo `rider-mobile-app`, Capacitor server.url -> deliverypartner.arogyadiet.com; web build aliases native plugins to stubs (next.config.ts).
- Actions WITHOUT any visible caller auth check (service role): master-actions/adminActions.ts (create/update/delete ADMIN users), admin-actions/adminPinActions.ts resetCustomerPinAction, biOverview/bi* actions, financeActions/financePayoutActions (only getUser, no role?), routingSandboxActions, kitProductActions, franchiseRiderActions, workloadActions, conflictActions, manageMealActions.cascadePendingSubscriptionDates & repairOverLimitPauseCredits (exported). VERIFY each before claiming exploitable.
- franchiseRiderActions.franchiseOnboardRider trusts formData.franchiseId, no session check.
- Payment status values inconsistent: subscription checkout writes SUCCESS; shop/webhook/onboarding write PAID.
