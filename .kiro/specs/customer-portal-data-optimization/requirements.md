# Requirements Document

## Introduction

The customer portal (customer.arogyadiet.com) suffers from redundant sequential Supabase/auth round-trips during page navigation. Currently, every navigation incurs 4-6+ sequential network calls before content renders because middleware, layout, and individual pages each independently resolve the authenticated user, query the `users` table, and fetch `customer_profiles`. This feature eliminates those redundancies by propagating middleware-resolved data downstream via request headers, unifying all pages behind the existing `cache()`-wrapped `getCustomerSession()` helper, fixing inline nested sub-selects that force sequential waterfalls, and parallelizing independent queries. The target outcome is reducing per-navigation Supabase round-trips from 4-6+ down to 2-3, yielding an estimated 100-300ms TTFB improvement.

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

## Requirements

### Requirement 1: Middleware Resolves and Propagates Customer Category

**User Story:** As a customer portal user, I want the middleware to resolve my subscription category once and pass it downstream, so that the layout does not perform a redundant database lookup for sidebar filtering.

#### Acceptance Criteria

1. WHEN the Middleware authenticates a user with roleCode `CUSTOMER`, THE Middleware SHALL query the `subscriptions` table for the active subscription's `customer_category` value using the already-resolved user profile data.
2. WHEN the Middleware resolves a `customer_category` value, THE Middleware SHALL set a Request_Header named `x-customer-category` on the downstream request with the resolved value.
3. IF the Middleware cannot resolve a `customer_category` (no active subscription or null value), THEN THE Middleware SHALL set the `x-customer-category` Request_Header to an empty string.
4. THE Middleware SHALL resolve `customer_category` without introducing additional Supabase client instantiations beyond the one already created for authentication.
5. THE Middleware SHALL continue to enforce all existing authentication, role-based gating, and redirect behavior without modification.

### Requirement 2: Layout Reads Category from Header Instead of Database

**User Story:** As a customer portal user, I want the layout to read my subscription category from the request header, so that page rendering is not blocked by a redundant database query.

#### Acceptance Criteria

1. THE Customer_Layout SHALL read the `x-customer-category` value from the incoming Request_Header using the `headers()` API.
2. THE Customer_Layout SHALL remove the existing inline `createClient()` call and nested sub-select query that fetches `customer_category` from the `subscriptions` table.
3. THE Customer_Layout SHALL pass the header-derived `customerCategory` value to the `CustomerSidebar` and `CustomerHeader` components exactly as before.
4. IF the `x-customer-category` header is empty or absent, THEN THE Customer_Layout SHALL treat `customerCategory` as `null`.

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
3. WHEN a nested sub-select is replaced, THE Customer_Page SHALL use the `customerProfileId` from GetCustomerSession_Helper rather than executing a separate `users` table query to derive it.

### Requirement 6: Parallelize Independent Queries

**User Story:** As a customer portal user, I want independent database queries to execute in parallel, so that page load time is minimized.

#### Acceptance Criteria

1. WHEN the Customer_Page at `subscription/page.tsx` fetches both `customer_profiles` data and `subscription_plans` data after resolving the user session, THE Customer_Page SHALL execute these independent queries concurrently using `Promise.all`.
2. WHEN the Customer_Page at `meals/page.tsx` fetches today's delivery order and today's subscription preference simultaneously, THE Customer_Page SHALL execute these independent queries concurrently using `Promise.all`.
3. WHEN the Customer_Page at `shop/orders/page.tsx` fetches the customer profile and then the orders list, THE Customer_Page SHALL combine any queries that do not depend on each other into a `Promise.all` call.
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

### Requirement 8: Reduce Total Round-Trips Per Navigation

**User Story:** As a customer portal user, I want navigation to complete faster, so that the portal feels responsive and usable.

#### Acceptance Criteria

1. WHEN a customer navigates to any page within the customer portal, THE combined data-fetching chain (Middleware + Layout + Page) SHALL execute no more than 3 Supabase round-trips for session resolution (auth.getUser + users table + customer_profiles).
2. THE Customer_Layout SHALL execute zero additional Supabase queries for `customer_category` resolution beyond reading the Request_Header.
3. WHEN multiple Customer_Pages are loaded during a single request lifecycle, THE GetCustomerSession_Helper SHALL execute its database queries exactly once due to React `cache()` deduplication.
