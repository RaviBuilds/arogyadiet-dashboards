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

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples and edge cases
- All code uses TypeScript with the existing Next.js App Router / Supabase SSR patterns
- The `getCustomerSession()` helper's `cache()` wrapper is critical — do not remove it during refactoring
- Maintain data dependencies: queries depending on other results must NOT be in the same `Promise.all` batch

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "3.1"] },
    { "id": 2, "tasks": ["3.2", "5.1", "5.2", "5.3", "5.4"] },
    { "id": 3, "tasks": ["5.5", "6.1", "6.2"] },
    { "id": 4, "tasks": ["6.3", "8.1"] },
    { "id": 5, "tasks": ["8.2"] }
  ]
}
```
