# Implementation Plan: Customer Portal Data Optimization

## Overview

This plan implements the customer portal data optimization by: (1) extending middleware to propagate `customer_category` via header, (2) extending the `getCustomerSession()` helper with `customerProfileId`, (3) migrating all customer pages to use the unified session helper, (4) eliminating nested sub-select patterns, and (5) parallelizing independent queries. All changes use TypeScript with the existing Next.js App Router architecture.

## Tasks

- [x] 1. Extend Middleware to resolve and propagate customer category
  - [x] 1.1 Add customer_category resolution and x-customer-category header to middleware
    - After the existing CUSTOMER role check passes, query `subscriptions` table for the active subscription's `customer_category` using the already-resolved customer profile ID
    - Set `x-customer-category` header on the response with the resolved value (or empty string if unresolvable)
    - Reuse the existing Supabase client instance — do not create a new one
    - Ensure all existing authentication, role-based gating, redirect behavior, and cookie propagation remain unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 7.1, 7.2, 7.5_

  - [ ]* 1.2 Write unit tests for middleware customer_category propagation
    - Test that header is set to "KIT" for user with active KIT subscription
    - Test that header is set to "MEAL" for user with active MEAL subscription
    - Test that header is set to "" when no active subscription exists
    - Test that header is set to "" when customer_category is null
    - Test that existing auth redirects still function correctly
    - _Requirements: 1.1, 1.2, 1.3, 1.5_

- [x] 2. Extend GetCustomerSession helper with customerProfileId
  - [x] 2.1 Add customerProfileId to CustomerSession type and getCustomerSession implementation
    - Update the `CustomerSession` type in `src/lib/customer/get-session.ts` to include `customerProfileId: string | null`
    - After fetching the `users` row, query `customer_profiles.id` where `user_id = profile.id`
    - Return `customerProfileId: null` if no profile exists or if user lookup failed
    - Ensure the function remains wrapped in React `cache()` for per-request deduplication
    - Use the same Supabase client instance for the new query to preserve RLS enforcement
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 2.2 Write property test for session cache deduplication
    - **Property 1: Session Cache Deduplication**
    - For any request lifecycle calling `getCustomerSession()` N times (N ≥ 1), underlying queries execute exactly once, and all calls return the same result reference
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 3.3, 4.7, 8.3**

  - [ ]* 2.3 Write unit tests for getCustomerSession customerProfileId resolution
    - Test that `customerProfileId` is returned when customer profile exists
    - Test that `customerProfileId` is null when no customer profile exists
    - Test that `customerProfileId` is null when auth fails
    - _Requirements: 3.1, 3.2, 3.4_

- [x] 3. Refactor Customer Layout to read category from header
  - [x] 3.1 Replace inline createClient and subscription query with header read in layout
    - In `src/app/customer/(main)/layout.tsx`, remove the existing `createClient()` call and nested sub-select that fetches `customer_category` from `subscriptions`
    - Import and use `headers()` API to read the `x-customer-category` header value
    - Treat empty or absent header as `null`
    - Continue passing `customerCategory` to `CustomerSidebar` and `CustomerHeader` components
    - Call `getCustomerSession()` for user/profile data (benefits from cache deduplication)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 8.2_

  - [ ]* 3.2 Write unit tests for layout header reading
    - Test that layout reads "KIT" from header and passes to sidebar/header
    - Test that layout treats empty header as null
    - Test that layout treats absent header as null
    - _Requirements: 2.1, 2.3, 2.4_

- [x] 4. Checkpoint - Verify core infrastructure
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Unify customer pages to use getCustomerSession helper
  - [x] 5.1 Refactor subscription/page.tsx to use getCustomerSession and parallelize queries
    - Replace independent `createClient()`, `auth.getUser()`, and `users` table lookups with `getCustomerSession()`
    - Use `customerProfileId` from the session helper
    - Wrap independent `customer_profiles` data and `subscription_plans` queries in `Promise.all`
    - Redirect to `/login` on auth failure
    - _Requirements: 4.1, 6.1, 7.3, 7.4, 8.1_

  - [x] 5.2 Refactor profile/page.tsx to use getCustomerSession and parallelize queries
    - Replace independent `createClient()`, `auth.getUser()`, and `users` table lookups with `getCustomerSession()`
    - Use `customerProfileId` from the session helper
    - Wrap independent `customer_profiles` data and `addresses` queries in `Promise.all`
    - Redirect to `/login` on auth failure
    - _Requirements: 4.2, 6.4, 7.3, 7.4, 8.1_

  - [x] 5.3 Refactor meals/page.tsx to use getCustomerSession and parallelize queries
    - Replace independent `createClient()`, `auth.getUser()`, and `users` table lookups with `getCustomerSession()`
    - Use `customerProfileId` from the session helper
    - Ensure today's delivery order and subscription preference queries execute concurrently with `Promise.all`
    - Redirect to `/login` on auth failure
    - _Requirements: 4.3, 6.2, 7.3, 7.4, 8.1_

  - [x] 5.4 Refactor shop/orders/page.tsx to use getCustomerSession and parallelize queries
    - Replace independent `createClient()`, `auth.getUser()`, and `users` table lookups with `getCustomerSession()`
    - Use `customerProfileId` from the session helper
    - Combine any independent queries (customer profile + orders) into `Promise.all`
    - Redirect to `/login` on auth failure
    - _Requirements: 4.4, 6.3, 7.3, 7.4, 8.1_

  - [ ]* 5.5 Write property test for auth redirect on null session
    - **Property 2: Auth Redirect on Null Session**
    - For any customer page, when `getCustomerSession()` returns null user or non-null error, the page redirects to `/login` without executing further queries
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 7.4**

- [x] 6. Eliminate nested sub-select patterns
  - [x] 6.1 Refactor subscription/manage/address/page.tsx to eliminate nested sub-select
    - Replace the nested sub-select pattern (`.eq("user_id", (await supabase.from("users")...).data?.id)`) with `getCustomerSession()`
    - Use `customerProfileId` from the session helper directly in query filters
    - Remove the redundant `users` table query entirely
    - Redirect to `/login` on auth failure
    - _Requirements: 4.5, 5.1, 5.3, 7.3, 7.4_

  - [x] 6.2 Refactor subscription/manage/planner/page.tsx to eliminate nested sub-select
    - Replace the nested sub-select pattern (`.eq("user_id", (await supabase.from("users")...).data?.id)`) with `getCustomerSession()`
    - Use `customerProfileId` from the session helper directly in query filters
    - Remove the redundant `users` table query entirely
    - Redirect to `/login` on auth failure
    - _Requirements: 4.6, 5.2, 5.3, 7.3, 7.4_

  - [ ]* 6.3 Write property test for maximum round-trips per navigation
    - **Property 3: Maximum Round-Trips Per Navigation**
    - For any customer page navigation, combined session-resolution queries across Middleware + Layout + Page total no more than 3 Supabase round-trips
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 8.1**

- [x] 7. Checkpoint - Verify all pages and round-trip reduction
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Integration verification
  - [x] 8.1 Verify end-to-end data flow and RLS enforcement
    - Confirm that `getCustomerSession()` cache deduplication works across layout + page in the same request
    - Verify no `createClient()` calls remain in refactored pages (static grep check)
    - Verify no nested sub-select patterns remain in address/planner pages
    - Verify all queries use the authenticated Supabase client from the session helper (RLS enforced)
    - Confirm middleware creates exactly one Supabase client instance
    - _Requirements: 4.7, 7.3, 8.1, 8.2, 8.3_

  - [ ]* 8.2 Write integration tests for full navigation flow
    - Test middleware → layout → page flow with authenticated user
    - Verify RLS enforcement: page queries only return data for authenticated user
    - Verify existing gatekeeper logic passes without modification
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 8.1_

- [x] 9. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Resolve the `/api` middleware early-return decision for Requirement 12
  - [x] 10.1 Evaluate the Open Question from design.md and document the chosen direction
    - Review the two viable directions: (a) implement Requirement 12 independently of Identity_Headers using a single combined `auth.getUser()` + `users` lookup with the SSR client, or (b) add a narrow, additive exception inside the existing `/api` early-return block in `src/middleware.ts` that runs identity-resolution (not the full gatekeeper/rewrite logic) specifically for `/api/notifications`
    - Add a code comment in `src/middleware.ts` immediately above the `/api` early-return documenting the chosen direction and rationale, satisfying the design's smoke-test gate that this decision be explicitly resolved and documented before Requirement 12 is implemented
    - Note: if both directions appear equally viable, surface the tradeoff to the user for a brief decision checkpoint before proceeding to Task 17
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [x] 11. Implement Middleware Identity Header Propagation
  - [x] 11.1 Add x-auth-user-id and x-customer-profile-id headers to middleware
    - Inside the existing `currentSubdomain === "customer"` branch, alongside the existing `x-customer-category` header assignment, set `x-auth-user-id` from the already-resolved `user.id` and `x-customer-profile-id` from the already-resolved `customerProfileId` (when present)
    - Set these headers only on the `NextResponse.rewrite(...)` / `NextResponse.next({ request })` object used to construct the forwarded request — never via `response.cookies.set` and never in a way that copies them onto the outer browser-visible response
    - Do not introduce any new Supabase client instantiation or additional query — reuse the data already resolved by the existing `auth.getUser()` and `users` query
    - _Requirements: 9.1, 9.2, 9.3, 9.7_

  - [ ]* 11.2 Write property test for middleware identity header propagation
    - **Property 4: Middleware Identity Header Propagation**
    - For any authenticated request where Middleware resolves `roleCode === "CUSTOMER"` and grants access, the rewritten request carries correct `x-auth-user-id`/`x-customer-profile-id` headers with zero additional Supabase queries
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 9.1, 9.2, 9.3**

  - [ ]* 11.3 Write property test for identity headers never leaking to the client
    - **Property 7: Identity Headers Never Leak to the Client**
    - For any request where the Identity_Headers are set on the internal rewritten request, the outer HTTP response's headers and `Set-Cookie` entries never contain `x-auth-user-id` or `x-customer-profile-id` under any key or cookie name
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 9.7**

  - [ ]* 11.4 Write unit tests for middleware header setting
    - Test that `x-auth-user-id` and `x-customer-profile-id` are set on the rewritten request for an authenticated CUSTOMER
    - Test that these headers do not appear on the outer `NextResponse`'s client-visible headers/cookies
    - Test that existing auth redirects and cookie propagation still function correctly
    - _Requirements: 9.1, 9.2, 9.7_

- [x] 12. Implement GetCustomerSession Identity Header Trust Branch
  - [x] 12.1 Add trust/fallback branching logic to getCustomerSession() in src/lib/customer/get-session.ts
    - Read `x-auth-user-id` via `headers()`; when present, skip `supabase.auth.getUser()` and construct a minimal `User`-shaped object carrying only `id`
    - When trusted, perform exactly one Supabase query (the `users` table lookup) and set `customerProfileId` directly from the `x-customer-profile-id` header value without querying `customer_profiles`
    - When `x-auth-user-id` is absent, fall back to today's unchanged behavior: `auth.getUser()` → `users` → `customer_profiles`
    - Ensure the returned `supabase` client is constructed identically from the request's own cookies in both branches so RLS applies regardless of identity source
    - Keep the `CustomerSession` return shape unchanged and keep the function wrapped in `cache()`
    - _Requirements: 9.4, 9.5, 9.6, 9.8, 9.9_

  - [ ]* 12.2 Write property test for identity header trust fallback
    - **Property 5: Identity Header Trust Fallback**
    - For any incoming request, header-present resolves via exactly one query with `customerProfileId` taken directly from the header; header-absent behaves identically to the pre-Requirement-9 implementation
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 9.4, 9.5, 9.6**

  - [ ]* 12.3 Write property test for RLS client construction independence
    - **Property 6: RLS Client Construction Is Identity-Source-Independent**
    - For any invocation of `getCustomerSession()`, the returned `supabase` client is constructed identically from request cookies regardless of whether identity came from an Identity_Header or `auth.getUser()`
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 9.8**

  - [ ]* 12.4 Write unit tests for getCustomerSession header trust behavior
    - Test that `supabase.auth.getUser()` is not invoked when `x-auth-user-id` is present (assert mock call count)
    - Test that `customerProfileId` is taken from `x-customer-profile-id` directly without a `customer_profiles` query
    - Test fallback to `auth.getUser()` + `users` + `customer_profiles` when headers are absent
    - _Requirements: 9.4, 9.5, 9.6_

- [x] 13. Checkpoint - Verify identity header propagation
  - Ensure all tests pass, ask the user if questions arise.
  - Build passes clean (`npm run build`). Middleware sets `x-auth-user-id`/`x-customer-profile-id` only via `response.headers.set` on the rewritten request; `getCustomerSession()` branches correctly on their presence with a documented fallback path.

- [x] 14. Migrate remaining unmigrated pages to GetCustomerSession helper
  - [x] 14.1 Refactor subscription/manage/billing/page.tsx
    - Replace independent `createClient()`, `auth.getUser()`, and `users`/`customer_profiles` queries with `getCustomerSession()`
    - Use `customerProfileId` from the session helper; keep the existing `Promise.all([addonOrders, subscriptions])` batch unchanged
    - Redirect to `/login` on auth failure
    - _Requirements: 10.1, 10.6, 10.7_

  - [x] 14.2 Refactor subscription/checkout/page.tsx
    - Replace independent `createClient()` + `auth.getUser()` with `getCustomerSession()`
    - Replace the `customer_profiles` query filtered by the embedded `users!inner(auth_user_id)` join with a query keyed directly on the helper's `customerProfileId`
    - Keep the existing `Promise.all([plans, latestSubscription, categories])` batch unchanged
    - Redirect to `/login` on auth failure
    - _Requirements: 10.2, 10.6, 10.7_

  - [x] 14.3 Refactor tracking/[orderId]/page.tsx
    - Replace independent `createClient()` + `auth.getUser()` with `getCustomerSession()`, used only for the `user`/`error` null-check
    - Leave the `delivery_orders` query unchanged
    - Redirect to `/login` on auth failure
    - _Requirements: 10.3, 10.6, 10.7_

  - [x] 14.4 Refactor shop/page.tsx
    - Replace independent `createClient()`, `auth.getUser()`, and `users` table lookups with `getCustomerSession()`
    - Replace the three-step chain to reach `franchise_id` with a single `customer_profiles.select("franchise_id").eq("id", customerProfileId)` query
    - Redirect to `/login` on auth failure
    - _Requirements: 10.4, 10.6, 10.7_

  - [x] 14.5 Fix kit-tracker/page.tsx's redundant customer_profiles query
    - Remove the redundant second `createClient()` + `customer_profiles` query that resolves `cpRow.id`
    - Use the `customerProfileId` already returned by `getCustomerSession()` in its place, keeping the subsequent `subscriptions`/`kit_daily_logs` queries keyed on it
    - _Requirements: 10.5, 10.6, 10.7_

  - [ ]* 14.6 Write property test for page migration completeness
    - **Property 8: Page Migration Completeness**
    - For any of the 5 migrated pages and any generated `getCustomerSession()` result, the redirect contract holds on null/error, and rendering on success performs zero independent `auth.getUser()` calls or `users`/`customer_profiles` queries
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7**

  - [ ]* 14.7 Write unit tests for migrated pages
    - Test each of the 5 pages (billing, checkout, tracking, shop, kit-tracker) redirects to `/login` on null user/error
    - Test `checkout/page.tsx` resolves `franchise_id`/`dietary_preference` via the `customerProfileId`-keyed query, not the `users!inner` join
    - Test `shop/page.tsx` resolves `franchise_id` via the single `customer_profiles` query
    - Test `kit-tracker/page.tsx` no longer calls `createClient()` a second time
    - _Requirements: 10.2, 10.4, 10.5, 10.6_

- [x] 15. Parallelize Kit Tracker and instrument Kit History
  - [x] 15.1 Parallelize kit-tracker's active-subscription-category check and getKitTrackerStateAction()
    - In `kit-tracker/page.tsx`, batch the independent active-subscription-category query and `getKitTrackerStateAction()` call into a single `Promise.all`
    - Keep the tracker-fields subscription query and `kit_daily_logs` query sequential, since each depends on the previous step's result
    - Preserve existing returned data shape and redirect/branching behavior
    - _Requirements: 11.1, 11.2, 11.3, 11.6_

  - [x] 15.2 Add server-timing instrumentation to getKitHistoryAction()
    - In the action wrapping `KitLifecycleService.getKitHistory(...)`, add a `createServerTimer("getKitHistoryAction")` with marks around `authenticateCustomer()` and the service call, consistent with the pattern used in `getCustomerSession()`
    - _Requirements: 11.4, 11.5_

  - [ ]* 15.3 Write property test for kit tracker/history parallelization output equivalence
    - **Property 9: Kit Tracker/History Parallelization Output Equivalence**
    - For any generated fixture of `customer_profiles`, `subscriptions`, `kit_shipping_info`, and `kit_daily_logs` rows, the parallelized data-fetching logic produces the same rendered branch and resulting props/data shape as a sequential reference implementation
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.5, 11.6**

  - [ ]* 15.4 Write unit tests for kit-tracker parallelization and kit-history instrumentation
    - Test that the active-subscription-category check and `getKitTrackerStateAction()` execute concurrently
    - Test that `getKitHistoryAction()` contains `createServerTimer` instrumentation around `authenticateCustomer()` and the service call
    - _Requirements: 11.1, 11.4_

- [x] 16. Checkpoint - Verify migrated pages and kit tracker/history changes
  - Ensure all tests pass, ask the user if questions arise.
  - Build passes clean. All 5 pages (billing, checkout, tracking, shop, kit-tracker) migrated to `getCustomerSession()` with zero independent `auth.getUser()`/`users` queries. kit-tracker's category check + `getKitTrackerStateAction()` now run via `Promise.all`. `getKitHistoryAction()` has timing instrumentation. Generalized `ServerTimer.measure<T>()` to be properly typed (fixed a TS narrowing issue surfaced during this task).

- [x] 17. Optimize and deduplicate the Notifications route and NotificationBell
  - [x] 17.1 Refactor /api/notifications/route.ts identity resolution
    - Implement `resolveAuthenticatedUserId()` per the direction chosen in Task 10: if an Identity_Header is available, resolve `userId` via a single combined `users` lookup keyed on the trusted `auth_user_id`; otherwise fall back to the existing `auth.getUser()` + `users` lookup using the SSR client instead of a separate `createAdminClient()` round-trip
    - Preserve the existing response shaping: `{ notifications: [], unreadCount: 0 }` for unauthenticated requests, and the exact computed `unreadCount` (no cap) for authenticated requests
    - Ensure at most two sequential round-trips (identity resolution, then notifications query) for a successful request when the Identity_Header path is used
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.7, 12.8_

  - [x] 17.2 Add in-flight fetch guard to NotificationBell.tsx
    - Add an `inFlightRef` guard around `fetchNotifications` so concurrent/rapid duplicate calls collapse into a single in-flight request
    - Preserve the existing legitimate triggers: mount, refresh event, popover open, and poll interval
    - _Requirements: 12.5, 12.6_

  - [ ]* 17.3 Write property test for notifications route identity resolution equivalence
    - **Property 10: Notifications Route Identity Resolution Equivalence**
    - For any generated request scenario (header present/absent, matching/no-matching row), the route resolves the same `userId`/`unauthenticated` outcome as the reference logic and respects the round-trip bound
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 12.1, 12.2, 12.3, 12.4**

  - [ ]* 17.4 Write property test for notification bell fetch deduplication
    - **Property 11: Notification Bell Fetch Deduplication**
    - For any generated sequence of NotificationBell lifecycle events for a fixed `userId`, the number of actual fetch calls does not exceed the number of legitimate trigger occurrences
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 12.5, 12.6**

  - [ ]* 17.5 Write property test for notification unread count accuracy
    - **Property 12: Notification Unread Count Accuracy**
    - For any generated notification set, unauthenticated requests return `{ notifications: [], unreadCount: 0 }`; authenticated requests return the exact uncapped count of unread rows
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 12.7, 12.8**

  - [ ]* 17.6 Write unit tests for notifications route and bell guard
    - Test the route resolves `userId` via a single combined step when an Identity_Header is present
    - Test the route falls back to `auth.getUser()` + `users` when no Identity_Header is present
    - Test the route returns `{ notifications: [], unreadCount: 0 }` for unauthenticated requests
    - Test the NotificationBell in-flight guard drops a concurrent duplicate call
    - _Requirements: 12.2, 12.3, 12.6, 12.7_

- [x] 18. Fix client-side SPA transition timing measurement
  - [x] 18.1 Redesign HydrationTimer.tsx keyed on usePathname()
    - Restructure `HydrationTimer` so an inner component receives `pathname` from `usePathname()` and re-executes its logging logic on every committed route change via the `[pathname]` dependency array
    - Preserve the one-time-only full-page-load branch via a ref that is not reset by route changes
    - Only log an SPA-transition duration when a real `route-transition-start` mark exists; clear the mark after use to avoid stale reuse on the next navigation
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_

  - [ ]* 18.2 Write property test for SPA transition timer firing correctness
    - **Property 13: SPA Transition Timer Fires Exactly Once Per Navigation Without Fabrication**
    - For any generated sequence of route changes with optional preceding marks, the full-page-load branch fires exactly once and the SPA-transition branch logs exactly one duration per marked change and none for unmarked changes
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5**

  - [ ]* 18.3 Write property test for SPA transition timing value validity
    - **Property 14: SPA Transition Timing Values Are Physically Valid**
    - For any logged SPA_Transition duration, the value is greater than or equal to zero, and distinct navigations never share identical logged timestamps
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 13.6**

  - [ ]* 18.4 Write unit tests for HydrationTimer
    - Test the full-page-load branch logs exactly once across multiple simulated pathname changes
    - Test no duration is logged when no `route-transition-start` mark exists
    - _Requirements: 13.4, 13.5_

- [x] 19. Add OneSignal domain guard
  - [x] 19.1 Add isOneSignalDomainAllowed() check to OneSignalProvider.tsx
    - Implement `isOneSignalDomainAllowed()` reading `NEXT_PUBLIC_ONESIGNAL_ALLOWED_HOSTNAMES` (defaulting to the production hostname), returning `true` on SSR, empty config, or a thrown error (fail-open)
    - Call it at the top of `runWithOneSignal`, skipping the init/login flow for that page load when the domain does not match
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [ ]* 19.2 Write property test for OneSignal domain guard correctness
    - **Property 15: OneSignal Domain Guard Correctness**
    - For any generated hostname and allowed-domains configuration, `OneSignal.init()` is invoked if and only if the hostname is a member of the allowed set
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 14.1, 14.2, 14.3, 14.4**

  - [ ]* 19.3 Write property test for OneSignal guard fail-open behavior
    - **Property 16: OneSignal Guard Fails Open on Error or Inconclusive Result**
    - For any scenario where the detection logic throws or is inconclusive, the guard treats the outcome as no mismatch and `OneSignal.init()` is still invoked
    - Use fast-check with min 100 iterations
    - **Validates: Requirements 14.5**

  - [ ]* 19.4 Write unit tests for OneSignal domain guard
    - Test the guard skips `init()` when hostname is not in the allowed list
    - Test the guard proceeds with `init()` when hostname matches
    - Test the guard proceeds with `init()` when the detection check throws
    - _Requirements: 14.1, 14.3, 14.5_

- [x] 20. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.
  - Build passes clean (`npm run build`). All core implementation tasks 10-19 complete.

- [ ] 21. Checkpoint - Confirm measured latency improvement
  - Re-run the existing profiling instrumentation (`server-timing.ts` and the timing logs already in `src/middleware.ts`, `src/lib/customer/get-session.ts`, and `src/app/customer/(main)/layout.tsx`) across the same navigations profiled originally (`/`, `/profile`, `/dashboard`, `/kit-tracker`, `/kit-history`, `/subscription/manage/billing`)
  - Compare the before/after timing numbers to confirm the previously measured ~1.2s duplicate-identity-resolution cost has been reduced, and record the observed reduction
  - Ask the user if the measured improvement does not match expectations before proceeding

- [ ] 22. Final checkpoint - Ensure all tests pass
  - Ensure all tests and the production build pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All code uses TypeScript with the existing Next.js App Router / Supabase SSR patterns
- The `getCustomerSession()` helper's `cache()` wrapper is critical — do not remove it during refactoring
- Maintain data dependencies: queries depending on other results must NOT be in the same `Promise.all` batch
- Task 10 must be completed (and, if needed, confirmed with the user) before Task 17 begins, since it determines whether `/api/notifications` receives Identity_Headers
- Tasks 14.5 and 15.1 both modify `kit-tracker/page.tsx` — complete 14.5 before starting 15.1

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "3.1"] },
    { "id": 2, "tasks": ["3.2", "5.1", "5.2", "5.3", "5.4"] },
    { "id": 3, "tasks": ["5.5", "6.1", "6.2"] },
    { "id": 4, "tasks": ["6.3", "8.1"] },
    { "id": 5, "tasks": ["8.2"] },
    { "id": 6, "tasks": ["10.1"] },
    { "id": 7, "tasks": ["11.1", "12.1"] },
    { "id": 8, "tasks": ["11.2", "11.3", "11.4", "12.2", "12.3", "12.4"] },
    { "id": 9, "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5", "15.2"] },
    { "id": 10, "tasks": ["14.6", "14.7", "15.1"] },
    { "id": 11, "tasks": ["15.3", "15.4"] },
    { "id": 12, "tasks": ["17.1", "17.2", "18.1", "19.1"] },
    { "id": 13, "tasks": ["17.3", "17.4", "17.5", "17.6", "18.2", "18.3", "18.4", "19.2", "19.3", "19.4"] }
  ]
}
```
