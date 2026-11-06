# 14 — Testing

Terms:
- **Unit test**: tests one function in isolation.
- **Property-based test**: instead of a few hand-picked inputs, a library (here **fast-check**) generates hundreds of random inputs and checks that a *property* always holds (e.g. "after any sequence of pauses, credits used never exceeds credits total").
- **Integration test**: tests several real pieces together (here: real Postgres + real SQL scripts).
- **a11y test**: accessibility checks with **axe-core** on rendered components.

## 1. Setup
- Runner: **vitest 4** (`npm test` = `vitest run`, `npm run test:watch`).
- Config: `vitest.config.ts` — `environment: "node"` by default; DOM tests opt in with a `// @vitest-environment jsdom` docblock (26 files); `setupFiles: ./src/test/setup-dom.ts` (jest-dom matchers + Radix polyfills, guarded); aliases mirror `tsconfig.json` (`@/components` → `src/shared/components`, etc.); `server-only` is stubbed (`src/test/stubs/server-only.ts`) so server modules can be unit-tested.
- Libraries: `fast-check`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `jsdom`, `axe-core`.

## 2. Inventory (counted on 2026-11-02)
- **318** test files; **196** have "property" in the name; **219** import fast-check; **17** integration files; **2** a11y files.
- Largest clusters: `src/services/__tests__` (44), `src/lib/clinic` (41), `src/test/shop` (29), `src/lib/franchise-inventory` (23, colocated `*.test.ts`), `src/test/dietitian` (20), `src/lib/auth` (17), `src/test/inventory` (17), `src/actions/system-actions/__tests__` (12), `src/actions/admin-actions/__tests__` (11).

## 3. What is covered (with examples)
| Area | Example tests | What they prove |
|---|---|---|
| RBAC | `src/lib/auth/__tests__/*` (e.g. `franchise-customers-workspace-guard.test.ts`) | path gate, group rules, franchise guards |
| Architecture guard | `src/test/architecture/use-server-exports.test.ts` | every `"use server"` file exports only async functions (regression for a real outage) |
| Daily pipeline / routing | `actions/system-actions/__tests__/pipeline-halt.property.test.ts`, `pipeline-integration.test.ts`, `routing-batch-count.property.test.ts`, `routing-clinic-origin.property.test.ts`, `routing-skip-scopes.property.test.ts`, `snapshot-wellformed.property.test.ts` | halt/retry semantics, one batch per rider, clinic origin, scope skipping (Supabase and Google mocked) |
| Cron | `app/api/cron/auto-off-duty/__tests__/route.test.ts` | 401 when `CRON_SECRET` unset/mismatched, sweep behaviour |
| PIN auth | `src/test/customer-pin-auth/*` (`pin-mismatch-rejection.property.test.ts`, `pin-service-set-permanent.property.test.ts`, `pin-temp-store-roundtrip.property.test.ts`, `pin-temp-route-blocking.property.test.ts`) | hashing, mismatch, temp flag; note the route-blocking test models the middleware rule, while the real middleware never sets `isTempPin` |
| Onboarding | `src/test/customer-mobile-onboarding/*`, `lib/onboarding` tests, a11y `onboarding-a11y.test.tsx` | eligibility table, placeholder email, cutoff |
| Shop / clinic stock | `src/test/shop/*` with a **reference model** `clinicStockModel.ts` | SQL-equivalent stock rules, error prefixes, oversell prevention; `lib/shop/*.test.ts` |
| Franchise inventory | `lib/franchise-inventory/*.test.ts`, `franchise/(main)/inventory/__tests__/franchise-inventory-ui.test.tsx` | FIFO, on-hand, state reducer, scope predicate |
| Dietitian | `src/test/dietitian/*` incl. `migration.integration.test.ts`, `rls-scope.integration.test.ts`, `concurrency-and-auth.integration.test.ts` | RLS and RPCs against a real DB |
| Accommodation | `src/test/accommodation/*` incl. `rpc.integration.test.ts` | payment RPC concurrency, balance parity with `deriveStayBalance` |
| Invoices / dates / address | `lib/invoices`, `lib/dates`, `lib/address` tests | pure helpers |
| UI | `shared/components/admin/customers/__tests__`, `AdminLiveTracking.regression.test.tsx`, `subscription-page.test.tsx`, signup redirect | rendering and regressions |

## 4. Database integration tests
`src/test/db/README.md`, `sqlRunner.ts`, `authRunner.ts`: opt-in via `TEST_DATABASE_URL` (+ `TEST_DB_ALLOW_REMOTE=1` for non-localhost). They run `scripts/*.sql` byte-for-byte with `psql`. Without the env var they skip, so `npm test` stays green. `.env.local` is intentionally not loaded so the live project cannot be hit by accident.

## 5. What is not covered (gaps)
- **Payments end-to-end**: no tests found for `checkoutActions.activateSubscription`, `verifyAddonPayment`, or the Razorpay webhook route (searched for test files referencing them — none by name). These are the riskiest flows.
- **Server Action authorization sweep**: no test asserts that every exported action calls a gate (the architecture test only checks export types). A similar static test would have caught the ungated actions listed in `16`.
- **Middleware** as a whole (only modelled pieces).
- **Native Java code**: no Android unit/instrumentation tests in this repo; verification was manual (Logcat + DB polling, steering doc).
- **E2E browser tests** (Playwright/Cypress): none.
- **Meal planner reconciliation engine** (`manageMealActions.ts`): no dedicated test found by name.
- Cron SQL schedule correctness.

## 6. How to run (read-only guidance; not executed during doc writing)
```bash
npm test                         # all unit/property tests
npx vitest run src/lib/auth      # one folder
npx vitest src/test/shop --watch # watch mode
```

## 7. Interview questions
1. *Why property-based tests?* Business rules like stock, FIFO, pause credits, access gates have huge input spaces; random generation finds edge cases (empty lists, ties, boundaries) that example tests miss.
2. *How do you test SQL functions?* Opt-in integration suites that apply the real scripts to a scratch Postgres and call the RPCs, plus "script guarantees" tests that read the SQL text.
3. *What would you add first?* Payment flow tests with a mocked Razorpay and a static test that every exported Server Action calls an auth gate.
