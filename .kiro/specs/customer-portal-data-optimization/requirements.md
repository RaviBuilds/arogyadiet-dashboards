# Requirements Document

## Introduction

The customer portal (customer.arogyadiet.com) suffers from redundant sequential Supabase/auth round-trips during page navigation. Currently, every navigation incurs 4-6+ sequential network calls before content renders because middleware, layout, and individual pages each independently resolve the authenticated user, query the `users` table, and fetch `customer_profiles`. This feature eliminates those redundancies by propagating middleware-resolved data downstream via request headers, unifying all pages behind the existing `cache()`-wrapped `getCustomerSession()` helper, fixing inline nested sub-selects that force sequential waterfalls, and parallelizing independent queries. The target outcome is reducing per-navigation Supabase round-trips from 4-6+ down to 2-3, yielding an estimated 100-300ms TTFB improvement.

Requirements 1-8 above were implemented in an earlier phase of this feature. Direct instrumentation (server-side timing logs added to `src/middleware.ts`, `src/lib/customer/get-session.ts`, and `src/app/customer/(main)/layout.tsx`, plus browser DevTools observation) was then added to measure the real-world effect of that work across live navigations to `/`, `/profile`, `/dashboard`, `/kit-tracker`, `/kit-history`, and `/subscription/manage/billing`. This measured profiling data — not estimates — revealed that the dominant remaining cost (~55% of total navigation time, ~1.2s average) is a duplicate identity resolution: Middleware fully resolves the authenticated user on the Edge_Runtime, then GetCustomerSession_Helper redoes the entire resolution from scratch on the Node_Runtime, because the two runtimes cannot share React `cache()` state. The profiling also found several Customer_Pages that were never migrated to GetCustomerSession_Helper during the earlier phase, unparallelized query chains on the slowest pages, a slow and duplicated `/api/notifications` route, and a client-side timing tool that is not measuring what it was intended to measure. Requirements 9 and onward below address these measured findings.

## Glossary

- **Middleware**: The Next.js Edge Runtime middleware (`src/middleware.ts`) that intercepts every request, performs authentication, resolves user roles, and applies route protection before the request reaches layouts or pages.
- **Customer_Layout**: The server-side layout component (`src/app/customer/(main)/layout.tsx`) that wraps all customer portal pages and renders the sidebar, header, and shared UI shell.
- **Customer_Page**: Any server-rendered page component within the customer portal route group (`src/app/customer/(main)/...`).
- **GetCustomerSession_Helper**: The `cache()`-wrapped async function (`src/lib/customer/get-session.ts`) that creates a Supabase client, resolves `auth.getUser()`, and fetches the `users` table row, returning `{ supabase, user, profile, error }`.
- **Customer_Category**: A string value (`KIT` or `MEAL`) stored on the active subscription's `customer_category` column, used to conditionally filter sidebar navigation items.
- **Customer_Profile_ID**: The primary key of the `customer_profiles` table row linked to the authenticated user via `customer_profiles.user_id = users.id`.
- **Request_Header**: An HTTP header set by Middleware on the rewritten request object, readable by downstream Server Components via `headers()`.
- **Nested_Sub_Select**: A pattern where one Supabase query is embedded inside another query's `.eq()` filter (e.g., `.eq("user_id", (await supabase.from("users")...).data?.id)`), forcing sequential execution.
- **Round_Trip**: A single network request-response cycle between the application server and the Supabase/PostgreSQL backend.
- **RLS**: Row Level Security — PostgreSQL policies that restrict data access based on the authenticated user's JWT, enforced at the database level.
- **Edge_Runtime**: The V8-isolate-based JavaScript runtime that Middleware executes in. It has no access to Node.js APIs and cannot share in-memory state (including React `cache()`) with code running on the Node_Runtime.
- **Node_Runtime**: The Node.js runtime that Server Components, Server Actions, and Route Handlers execute in. React `cache()` deduplication only applies within a single Node_Runtime request lifecycle and is not shared with the Edge_Runtime.
- **Identity_Header**: A Request_Header set by Middleware on the downstream request carrying a value the Middleware has already verified via `auth.getUser()` (e.g., the resolved `auth_user_id` and/or Customer_Profile_ID), allowing Node_Runtime code to trust the value instead of re-resolving it from Supabase.
- **Verified_Identity**: The combination of `auth_user_id`, internal `users.id`, and Customer_Profile_ID that Middleware has already confirmed belongs to an authenticated, authorized customer session for the current request.
- **Unmigrated_Page**: A Customer_Page that independently calls `createClient()`, `auth.getUser()`, and/or queries the `users`/`customer_profiles` tables instead of using GetCustomerSession_Helper.
- **Notification_Route**: The Route Handler at `src/app/api/notifications/route.ts` that resolves the authenticated user's internal `users.id` and returns that user's notification rows.
- **Hydration_Timer**: The client component (`src/shared/components/perf/HydrationTimer.tsx`) responsible for measuring and logging client-side full-page-load hydration time and SPA route-transition time.
- **SPA_Transition**: A client-side navigation between two Customer_Pages performed by the Next.js App Router without a full browser page reload (i.e., the Customer_Layout and its top-level effects are not remounted).
- **Route_Transition_Mark**: The `performance.mark("route-transition-start")` entry created by `RouteProgressBar` when a same-origin internal navigation is detected, used by Hydration_Timer to compute SPA_Transition duration.
- **Notification_Bell**: The client component (`src/shared/components/shared/NotificationBell.tsx`) that fetches and displays notification data by calling the Notification_Route.
- **Kit_Tracker_Page**: The Customer_Page at `src/app/customer/(main)/kit-tracker/page.tsx`.
- **Kit_History_Page**: The Customer_Page at `src/app/customer/(main)/kit-history/page.tsx`.

## Requirements

### Requirement 1: Middleware Resolves and Propagates Customer Category

**User Story:** As a customer portal user, I want the middleware to resolve my subscription category once and pass it downstream, so that the layout does not perform a redundant database lookup for sidebar filtering.

#### Acceptance Criteria

1. WHEN the Middleware authenticates a user with roleCode `CUSTOMER`, THE Middleware SHALL query the `subscriptions` table for the active subscription's `customer_category` value using the already-resolved user profile data.
2. WHEN the Middleware resolves a `customer_category` value, THE Middleware SHALL set a Request_Header named `x-customer-category` on the downstream request with the resolved value.
3. IF the Middleware cannot resolve a `customer_category` (no active subscription or null value), THEN THE Middleware SHALL set the `x-customer-category` Request_Header to an empty string.
4. THE Middleware SHALL resolve `customer_category` without introducing additional Supabase client instantiations beyond the one already created for authentication.
5. THE Middleware SHALL continue to enforce all existing authentication, role-based gating, and redirect behavior without modification.
6. IF the Middleware inadvertently creates more than one Supabase client instance while resolving `customer_category`, THEN THE Middleware SHALL continue processing the request rather than failing it, so that no customer is prevented from logging in due to this condition.

### Requirement 2: Layout Reads Category from Header Instead of Database

**User Story:** As a customer portal user, I want the layout to read my subscription category from the request header, so that page rendering is not blocked by a redundant database query.

#### Acceptance Criteria

1. THE Customer_Layout SHALL read the `x-customer-category` value from the incoming Request_Header using the `headers()` API.
2. THE Customer_Layout SHALL remove the existing inline `createClient()` call and nested sub-select query that fetches `customer_category` from the `subscriptions` table.
3. THE Customer_Layout SHALL pass the header-derived `customerCategory` value to the `CustomerSidebar` and `CustomerHeader` components exactly as before.
4. IF the `x-customer-category` header is empty or absent, THEN THE Customer_Layout SHALL treat `customerCategory` as `null`.
5. WHEN the `x-customer-category` Request_Header contains a non-empty value, THE Customer_Layout SHALL use that value directly as `customerCategory` without additional validation.

### Requirement 3: Extend GetCustomerSession Helper with Customer Profile ID

**User Story:** As a developer, I want the shared session helper to also resolve the `customer_profiles.id`, so that pages needing it do not perform redundant lookups.

#### Acceptance Criteria

1. THE GetCustomerSession_Helper SHALL resolve the Customer_Profile_ID by querying `customer_profiles.id` where `user_id` equals the already-fetched `users.id`.
2. THE GetCustomerSession_Helper SHALL include `customerProfileId` (type `string | null`) in the returned session object alongside the existing `supabase`, `user`, `profile`, and `error` fields.
3. THE GetCustomerSession_Helper SHALL remain wrapped in React's `cache()` function, ensuring the extended query executes at most once per request lifecycle.
4. IF no customer profile exists for the user, THEN THE GetCustomerSession_Helper SHALL set `customerProfileId` to `null`.
5. THE GetCustomerSession_Helper SHALL perform the `customer_profiles` lookup in the same Supabase client instance used for the `users` query, preserving RLS enforcement.

### Requirement 4: Unify Pages to Use GetCustomerSession Helper

**User Story:** As a customer portal user, I want all pages to use the shared cached session helper, so that redundant `auth.getUser()` and `users` table lookups are eliminated across navigation.

#### Acceptance Criteria

1. THE Customer_Page at `subscription/page.tsx` SHALL use GetCustomerSession_Helper instead of independently calling `createClient()`, `auth.getUser()`, and querying the `users` table.
2. THE Customer_Page at `profile/page.tsx` SHALL use GetCustomerSession_Helper instead of independently calling `createClient()`, `auth.getUser()`, and querying the `users` table.
3. THE Customer_Page at `meals/page.tsx` SHALL use GetCustomerSession_Helper instead of independently calling `createClient()`, `auth.getUser()`, and querying the `users` table.
4. THE Customer_Page at `shop/orders/page.tsx` SHALL use GetCustomerSession_Helper instead of independently calling `createClient()`, `auth.getUser()`, and querying the `users` table.
5. THE Customer_Page at `subscription/manage/address/page.tsx` SHALL use GetCustomerSession_Helper instead of independently calling `createClient()`, `auth.getUser()`, and querying the `users` table.
6. THE Customer_Page at `subscription/manage/planner/page.tsx` SHALL use GetCustomerSession_Helper instead of independently calling `createClient()`, `auth.getUser()`, and querying the `users` table.
7. WHEN a Customer_Page calls GetCustomerSession_Helper after the Customer_Layout has already called it in the same request, THE GetCustomerSession_Helper SHALL return the cached result without executing additional database queries.

### Requirement 5: Eliminate Nested Sub-Select Patterns

**User Story:** As a developer, I want inline nested sub-selects replaced with clean sequential variable assignments, so that query dependencies are explicit and debuggable.

#### Acceptance Criteria

1. THE Customer_Page at `subscription/manage/address/page.tsx` SHALL replace the nested sub-select pattern (`.eq("user_id", (await supabase.from("users")...).data?.id)`) with a named variable holding the result of GetCustomerSession_Helper's `profile.id`.
2. THE Customer_Page at `subscription/manage/planner/page.tsx` SHALL replace the nested sub-select pattern (`.eq("user_id", (await supabase.from("users")...).data?.id)`) with a named variable holding the result of GetCustomerSession_Helper's `profile.id`.
3. WHEN a nested sub-select is replaced, THE Customer_Page SHALL use either the `customerProfileId` from GetCustomerSession_Helper directly or a sequential named-variable assignment that queries the `users` table separately, provided the inline nested sub-select pattern itself is eliminated.

### Requirement 6: Parallelize Independent Queries

**User Story:** As a customer portal user, I want independent database queries to execute in parallel, so that page load time is minimized.

#### Acceptance Criteria

1. WHEN the Customer_Page at `subscription/page.tsx` fetches both `customer_profiles` data and `subscription_plans` data after resolving the user session, THE Customer_Page SHALL execute these independent queries concurrently using `Promise.all`.
2. WHEN the Customer_Page at `meals/page.tsx` has resolved the user session via GetCustomerSession_Helper and needs today's delivery order and today's subscription preference, THE Customer_Page SHALL execute these independent queries concurrently using `Promise.all` only after session resolution completes.
3. WHEN the Customer_Page at `shop/orders/page.tsx` has resolved the user session via GetCustomerSession_Helper, THE Customer_Page SHALL wait for that session resolution to complete before combining any queries that do not depend on each other into a `Promise.all` call.
4. WHEN the Customer_Page at `profile/page.tsx` fetches `customer_profiles` data and `addresses` data after resolving the user identity, THE Customer_Page SHALL execute these independent queries concurrently using `Promise.all`.
5. THE Customer_Page SHALL maintain correct data dependencies — a query that depends on the result of another query SHALL NOT be included in the same `Promise.all` batch.

### Requirement 7: Preserve Authentication and RLS Behavior

**User Story:** As a system administrator, I want the optimization to preserve all existing security behavior, so that no data leaks or auth bypasses are introduced.

#### Acceptance Criteria

1. THE Middleware SHALL continue to redirect unauthenticated users to the login page for all protected routes.
2. THE Middleware SHALL continue to enforce the customer portal gatekeeper logic (role check, onboarding status validation, temp PIN check) without modification.
3. WHEN a Customer_Page executes Supabase queries, THE Customer_Page SHALL use the authenticated Supabase client (from GetCustomerSession_Helper) that carries the user's JWT, ensuring RLS policies are enforced.
4. THE Customer_Page SHALL continue to redirect to `/login` when `getCustomerSession()` returns a null user or an auth error.
5. THE Middleware SHALL continue to propagate Supabase session cookies (set/refresh) in the response without interference from the new `x-customer-category` header.
6. IF RLS policies fail to apply to a query despite the Supabase client carrying a valid, properly authenticated JWT, THEN THE Customer_Page SHALL block that query's result from being used and SHALL treat it as a query error rather than returning unauthorized data.

### Requirement 8: Reduce Total Round-Trips Per Navigation

**User Story:** As a customer portal user, I want navigation to complete faster, so that the portal feels responsive and usable.

#### Acceptance Criteria

1. WHEN a customer navigates to any page within the customer portal, THE combined data-fetching chain (Middleware + Layout + Page) SHALL execute no more than 3 Supabase round-trips for session resolution (auth.getUser + users table + customer_profiles).
2. THE Customer_Layout SHALL execute zero additional Supabase queries for `customer_category` resolution beyond reading the Request_Header.
3. WHEN multiple Customer_Pages are loaded during a single request lifecycle, THE GetCustomerSession_Helper SHALL execute its database queries exactly once due to React `cache()` deduplication.

### Requirement 9: Propagate Verified Identity from Middleware to GetCustomerSession Helper

**User Story:** As a customer portal user, I want the identity my session was already verified with in Middleware to be reused by Server Components, so that navigation does not pay for a second full identity resolution on every request.

#### Acceptance Criteria

1. WHEN the Middleware authenticates a user with roleCode `CUSTOMER` and grants access to the customer portal, THE Middleware SHALL set an Identity_Header carrying the resolved `auth_user_id` on the downstream request.
2. WHEN the Middleware resolves a Customer_Profile_ID for roleCode `CUSTOMER`, THE Middleware SHALL set an Identity_Header carrying the resolved Customer_Profile_ID on the downstream request.
3. THE Middleware SHALL set the identity Request_Headers described in this Requirement using data already resolved by the existing `auth.getUser()` and `users` query, without introducing additional Supabase round-trips.
4. WHEN GetCustomerSession_Helper executes and finds a valid Identity_Header for `auth_user_id` on the incoming request, THE GetCustomerSession_Helper SHALL use the header value in place of calling `supabase.auth.getUser()`.
5. WHEN GetCustomerSession_Helper trusts an Identity_Header for `auth_user_id`, THE GetCustomerSession_Helper SHALL still perform exactly one Supabase query to resolve the corresponding `users` row and Customer_Profile_ID needed for its returned session object.
6. IF the Identity_Header for `auth_user_id` is absent from the incoming request, THEN THE GetCustomerSession_Helper SHALL fall back to calling `supabase.auth.getUser()` exactly as it does today, so non-customer-portal contexts and direct testing continue to work.
7. IF a Request_Header is used to carry Verified_Identity, THEN THE Middleware SHALL set that Request_Header only on the internal rewritten request object and SHALL NOT expose it as a Supabase session cookie or client-readable response header.
8. THE GetCustomerSession_Helper SHALL continue to return a Supabase client whose queries are subject to RLS, regardless of whether the `auth_user_id` was obtained from an Identity_Header or from `supabase.auth.getUser()`.
9. WHEN GetCustomerSession_Helper trusts an Identity_Header, THE combined data-fetching chain (Middleware + GetCustomerSession_Helper) SHALL be designed to avoid a second `auth.getUser()` call per navigation; an implementation detail that results in more than one `auth.getUser()` call SHALL NOT be treated as a defect as long as the Identity_Header is trusted and the overall session-resolution flow completes correctly.

### Requirement 10: Migrate Remaining Unmigrated Pages to GetCustomerSession Helper

**User Story:** As a developer, I want every customer-facing page to resolve identity through the shared session helper, so that no page silently reintroduces a duplicate auth/profile round-trip.

#### Acceptance Criteria

1. THE Customer_Page at `subscription/manage/billing/page.tsx` SHALL use GetCustomerSession_Helper instead of independently calling `createClient()`, `auth.getUser()`, and querying the `users` and `customer_profiles` tables.
2. THE Customer_Page at `subscription/checkout/page.tsx` SHALL use GetCustomerSession_Helper instead of independently calling `createClient()` and `auth.getUser()`, and SHALL use the Customer_Profile_ID and `franchise_id` obtained via GetCustomerSession_Helper and its associated profile data instead of the current `customer_profiles` query filtered by an embedded `users!inner` join.
3. THE Customer_Page at `tracking/[orderId]/page.tsx` SHALL use GetCustomerSession_Helper instead of independently calling `createClient()` and `auth.getUser()`.
4. THE Customer_Page at `shop/page.tsx` SHALL use GetCustomerSession_Helper instead of independently calling `createClient()`, `auth.getUser()`, and querying the `users` table, and SHALL resolve `franchise_id` from a single `customer_profiles` query keyed on the Customer_Profile_ID returned by GetCustomerSession_Helper.
5. THE Kit_Tracker_Page SHALL remove its additional `createClient()` and `customer_profiles` query used to resolve `cpRow.id`, and SHALL use the `customerProfileId` value already returned by GetCustomerSession_Helper.
6. WHEN any Customer_Page listed in this Requirement is migrated, THE Customer_Page SHALL continue to redirect to `/login` when GetCustomerSession_Helper returns a null user or an auth error, consistent with Requirement 7.4; WHEN GetCustomerSession_Helper instead resolves successfully, THE Customer_Page SHALL render normally on its current route without making any independent backup `auth.getUser()` call.
7. AFTER migration, THE Customer_Pages listed in this Requirement SHALL perform zero independent `auth.getUser()` calls and zero independent `users` table queries for identity resolution.

### Requirement 11: Parallelize Independent Query Chains on Kit Tracker and Kit History Pages

**User Story:** As a customer using the KIT tracker, I want the tracker and history pages to load without waiting on unnecessary sequential round-trips, so that these pages are not the slowest pages in the portal.

#### Acceptance Criteria

1. WHEN the Kit_Tracker_Page evaluates the customer's active subscription category and needs the result of `getKitTrackerStateAction()`, THE Kit_Tracker_Page SHALL NOT execute the active-subscription-category query and the tracker-fields subscription query as two separate sequential queries where their results are not both required for the same branch.
2. WHEN the Kit_Tracker_Page's data dependencies allow two queries to run without needing each other's results first, THE Kit_Tracker_Page SHALL execute those queries concurrently using `Promise.all`.
3. THE Kit_Tracker_Page SHALL maintain correct data dependencies — a query whose input depends on the output of another query SHALL NOT be included in the same `Promise.all` batch.
4. THE Kit_History_Page's underlying query chain (`getKitHistoryAction()` and the repository/service functions it calls) SHALL have server-side timing instrumentation added, consistent with the instrumentation pattern already used in `getCustomerSession()` and `CustomerLayout`, so that its internal query chain is individually measurable.
5. WHEN the instrumented Kit_History_Page query chain reveals independent queries that do not depend on each other's results, THE Kit_History_Page's query chain SHALL execute those queries concurrently using `Promise.all`.
6. THE Kit_Tracker_Page and Kit_History_Page SHALL preserve their existing returned data shape and existing redirect/branching behavior after query parallelization.

### Requirement 12: Optimize and Deduplicate the Notifications Route

**User Story:** As a customer portal user, I want the notification bell to load quickly and only fetch data once per intended trigger, so that it does not add multi-second delays or unnecessary load on every page navigation.

#### Acceptance Criteria

1. THE Notification_Route SHALL resolve the internal `users.id` needed to query notifications using at most one combined identity-resolution step, instead of the current sequential `auth.getUser()` call followed by a separate `createAdminClient()` query against the `users` table.
2. WHERE an Identity_Header carrying a verified `auth_user_id` or internal `users.id` is available on the incoming request to the Notification_Route, THE Notification_Route SHALL use that Identity_Header instead of calling `supabase.auth.getUser()`.
3. IF no Identity_Header is available to the Notification_Route, THEN THE Notification_Route SHALL fall back to its existing `auth.getUser()`-based resolution.
4. THE Notification_Route SHALL execute at most two sequential Supabase/database round-trips in total (identity resolution, then the notifications query) for a successful request with a resolved user.
5. THE Notification_Bell SHALL fetch notifications at most once per mount for a given `userId`, unless triggered by a user-initiated refresh event, a popover open, or the existing poll interval.
6. IF investigation confirms the duplicate double-fetch observed on every page navigation is caused by a missing guard against concurrent or rapid repeated fetch calls in Notification_Bell, THEN THE Notification_Bell SHALL be updated to prevent the duplicate fetch from firing.
7. THE Notification_Route SHALL continue to return an empty `notifications` array and `unreadCount` of `0` for unauthenticated requests, consistent with its current behavior; THE Notification_Route MAY perform its internal unread-count calculation before determining a request is unauthenticated, but SHALL still return `0` as the `unreadCount` value in the response for that request.
8. FOR authenticated requests that resolve to a valid `userId`, THE Notification_Route SHALL return the actual computed `unreadCount` for that user's notifications, with no artificial cap or restriction on the returned value.

### Requirement 13: Fix Client-Side Route Transition Timing Measurement

**User Story:** As a developer, I want accurate client-side timing data for every page navigation, so that future performance work can be based on real SPA transition measurements instead of a broken measurement gap.

#### Acceptance Criteria

1. WHEN a Customer_Page finishes an SPA_Transition triggered by a Route_Transition_Mark, THE Hydration_Timer SHALL log a measured SPA_Transition duration for that navigation.
2. THE Hydration_Timer SHALL log a measured SPA_Transition duration on every SPA_Transition during a browser session, not only on the first navigation after a cold page load.
3. THE Hydration_Timer SHALL be placed or re-implemented such that its logging logic re-executes on each committed route change, even though the Customer_Layout itself does not remount during an SPA_Transition.
4. THE Hydration_Timer SHALL NOT report a full-page-load timing branch result for a navigation that was actually an SPA_Transition.
5. IF no Route_Transition_Mark exists for a completed navigation, THEN THE Hydration_Timer SHALL NOT log a fabricated or repeated SPA_Transition duration for that navigation.
6. THE Hydration_Timer SHALL NOT produce timing values that are physically impossible (e.g., negative response-download time, identical timestamps across distinct navigations) once corrected.

### Requirement 14: Guard Against OneSignal Domain Mismatch in Non-Production Environments

**User Story:** As a developer working in a local or non-production environment, I want the OneSignal integration to recognize it is not on an allowed domain, so that the application does not repeatedly re-run failing initialization logic on every navigation.

#### Acceptance Criteria

1. WHERE the OneSignal SDK is initialized in a non-production environment whose domain does not match the OneSignal-configured allowed domain, THE customer portal SHALL detect the domain mismatch before invoking the OneSignal initialization/login flow.
2. IF a domain mismatch is detected, THEN THE customer portal SHALL skip the OneSignal initialization/login flow for that page load instead of re-running and failing it on every navigation.
3. THE customer portal SHALL continue to run the OneSignal initialization/login flow unmodified in environments where the domain matches the OneSignal-configured allowed domain.
4. THE domain-mismatch guard described in this Requirement SHALL remain active in the production environment; because a properly configured production deployment's domain matches the OneSignal-configured allowed domain, the guard SHALL NOT change observed OneSignal push-notification behavior in production, but SHALL still apply if a domain mismatch were ever detected there.
5. IF the domain-mismatch detection check itself fails to execute or returns an inconclusive result, THEN THE customer portal SHALL treat the outcome as no mismatch detected and SHALL proceed to run the OneSignal initialization/login flow.
