# Implementation Plan: Admin Access Levels

## Overview

This plan implements three admin access levels (`inventory`, `operations`, `inventory_operations`) as a sub-classification of the existing `ADMIN` role. The work is sequenced bottom-up: first the database column and the pure access-level utilities (which all enforcement layers depend on), then the layered server-side enforcement (middleware, layout guards, server-action guards), then the master create/edit flow with change notification, and finally the UI gating and master user-management surface. Each step builds on the previous, ending with everything wired together.

All code is TypeScript (Next.js 16 App Router, React 19, Supabase). Property-based tests use `fast-check` and are derived directly from the Correctness Properties in the design. Pure functions targeted by PBT are `resolveAccessLevel`, `canAccess`, `classifyAdminPath`, `isAdminPathAllowed`, and `landingRouteFor`.

## Tasks

- [x] 1. Database migration for `admin_access_level`
  - [x] 1.1 Create the additive migration script `scripts/add-admin-access-level-to-users.sql`
    - Add nullable `admin_access_level TEXT DEFAULT NULL` column to `public.users` with `IF NOT EXISTS`
    - Add `users_admin_access_level_check` CHECK constraint allowing only `NULL`, `inventory`, `operations`, `inventory_operations`
    - Add `idx_users_admin_access_level` index and a commented rollback + optional backfill block
    - _Requirements: 1.1, 1.4_

- [x] 2. Core access-level utilities — `src/lib/auth/adminAccess.ts`
  - [x] 2.1 Implement access-level types, labels, `resolveAccessLevel`, and `canAccess`
    - Define `ADMIN_ACCESS_LEVELS`, `AdminAccessLevel`, `AccessArea`, and `ACCESS_LEVEL_LABELS`
    - Implement `resolveAccessLevel(raw)` returning a valid level, coercing `NULL`/unknown/non-string to `inventory_operations`
    - Implement `canAccess(level, area)` returning the exact documented truth table, total over the enum
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 4.1, 4.2, 4.3_

  - [x] 2.2 Write property test for `resolveAccessLevel`
    - **Property 10: Backward-compatible resolution** (idempotent on valid values; all other inputs => `inventory_operations`; never throws/returns null)
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4**

  - [x] 2.3 Implement path classification + gate helpers (`classifyAdminPath`, `isAdminPathAllowed`, `landingRouteFor`)
    - Define `INVENTORY_PREFIXES` / `OPERATIONS_PREFIXES`; classify with path-segment boundary, case-sensitive, longest-prefix-wins (inventory on tie), neutral for malformed/empty paths
    - Implement `isAdminPathAllowed(level, pathname)` (neutral => true; otherwise delegate to `canAccess`)
    - Implement `landingRouteFor(level)` returning `/inventory` only for `inventory`, else `/dashboard`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4_

  - [x] 2.4 Write property test for path classification and the access gate
    - **Property 1: Inventory-only never reaches operations**, **Property 2: Operations-only never reaches inventory**, **Property 3: Full access reaches everything**, **Property 8: Neutral paths are universally reachable**
    - **Validates: Requirements 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4**

  - [ ]* 2.5 Write property test for landing-route and redirect-on-deny behavior
    - **Property 4: Inventory-only landing route is always `/inventory`**, **Property 5: Operations-only and full-access land on `/dashboard`**, **Property 6: Inventory-only requesting `/dashboard` is redirected to `/inventory`**, **Property 7: Redirect-on-deny targets the admin's own landing route**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 6.1, 6.4, 6.5**

  - [ ]* 2.6 Write property test for the `canAccess` truth table
    - **Property 9: canAccess truth table is total and exact** (every level × area returns the documented boolean, no `undefined`)
    - **Validates: Requirements 4.1, 4.2, 4.3**

  - [x] 2.7 Implement server-side admin context resolver and action guard
    - Add `"server-only"` import, `AdminContext` interface, and `getCurrentAdminContext()` resolving `userId`, `roleCode`, and `accessLevel` via the Supabase SSR client (NULL coerced to full)
    - Implement `AccessDeniedError` and `assertAdminAccess(area)` that returns the resolved level when permitted and throws otherwise (non-`ADMIN` and no-session both deny)
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 3. Checkpoint - core utilities
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Middleware access gate — `src/middleware.ts`
  - [x] 4.1 Extend the user lookup and add the access-level path gate
    - Extend the existing `users` select to include `admin_access_level`; resolve `accessLevel` via `resolveAccessLevel`
    - In the `admin` subdomain block, redirect non-`ADMIN` to `/unauthorized`, and on `!isAdminPathAllowed(level, path)` redirect to `landingRouteFor(level)`
    - Replace the hard-coded `/dashboard` post-login / root / login / signup redirect with `landingRouteFor(accessLevel)`; preserve the unauthenticated → login redirect
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 15.1, 15.2_

  - [ ]* 4.2 Write integration tests for the middleware gate
    - Simulate each level against representative inventory/operations/neutral paths; assert pass vs redirect and that the redirect target equals `landingRouteFor(level)` (inventory-only `/dashboard` request => `/inventory`); assert non-admin and root/login redirects
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 15.1_

- [x] 5. Layout and server-action guards
  - [x] 5.1 Add the operations Layout_Guard in `src/app/admin/(main)/layout.tsx`
    - Extend the select to include `admin_access_level`; redirect non-`ADMIN` to `/unauthorized`; redirect when `!canAccess(level, "operations")` to `landingRouteFor(level)`; redirect to `/unauthorized` when no session/level can be resolved
    - Pass `accessLevel` to `AdminNavbar` and children
    - _Requirements: 7.1, 7.3, 7.4, 7.5, 7.6_

  - [x] 5.2 Convert `src/app/admin/inventory/layout.tsx` to an async guard with bell wiring
    - Resolve context via `getCurrentAdminContext`; redirect non-`ADMIN` to `/unauthorized`; redirect when `!canAccess(level, "inventory")` to `landingRouteFor(level)`
    - Pass the resolved `userId` to `InventoryHeader`
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 12.2, 12.4_

  - [x] 5.3 Add `assertAdminAccess("operations")` guards to operations pages
    - Add a guard at the top of each `(main)` operations page (customers, subscriptions, riders, operations, kitchen-shop, franchises) mapping `AccessDeniedError` to `redirect(landingRouteFor(level))`
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 6. Checkpoint - server-side enforcement
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Master server actions — `src/actions/master-actions/adminActions.ts`
  - [x] 7.1 Select the access level in `getAdminUsers`
    - Add `admin_access_level` to the `getAdminUsers` select so each admin row carries its level
    - _Requirements: 14.1_

  - [x] 7.2 Persist access level in `createAdminUser`
    - Accept `accessLevel`, validate via Zod (reject invalid rather than coerce), default to `inventory_operations` when omitted/unchanged, persist on insert and on the reactivate branch, return the persisted level on success
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 7.3 Detect change and fire notification in `updateAdminUser`
    - Read current level before update, resolve `prevLevel`/`nextLevel`, persist `admin_access_level`; on persist failure leave value unchanged and return error; reject invalid level and missing target admin; send exactly one notification only when `prevLevel !== nextLevel`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 11.1, 11.2, 11.3, 11.4_

  - [ ]* 7.4 Write property test for notification count on change
    - **Property 11: Exactly-one notification on change** (count = `prev !== next ? 1 : 0`) using a fake notification sink over random (prev, next) level pairs
    - **Validates: Requirements 10.2, 10.3, 11.2**

  - [ ]* 7.5 Write property test for notification targeting
    - **Property 13: Notification targets the affected admin only** (row `user_id` equals edited admin; no other user receives a row)
    - **Validates: Requirements 11.1**

  - [ ]* 7.6 Write unit tests for create/update edge cases
    - Test invalid-level rejection, omitted-level default, missing target admin, persist-failure path, and unchanged-level zero-notification path with mocked Supabase + spied `sendNotificationToUser`
    - _Requirements: 9.3, 9.4, 9.5, 10.3, 10.4, 10.5, 10.6, 11.3, 11.4_

- [x] 8. UI gating by access level
  - [x] 8.1 Filter navigation in `src/app/admin/(main)/AdminNavbar.tsx`
    - Accept `accessLevel`; tag `NAV_ITEMS` with their area; render only items where `canAccess(level, area)` or neutral; apply to both desktop and mobile sheet
    - _Requirements: 13.1, 13.5_

  - [x] 8.2 Conditionally render KPIs and quick actions in `ExecutiveDashboard.tsx` and its host page
    - Accept `accessLevel`; tag quick actions and KPI cards by area; render operations KPIs for operations/full-access and the Warehouse Value KPI + Warehouse System quick action only for full-access; resolve and pass `accessLevel` from `app/admin/(main)/dashboard/page.tsx`
    - _Requirements: 13.2, 13.3, 13.4, 13.5_

  - [x] 8.3 Mount the NotificationBell on the inventory surface in `InventoryHeader.tsx`
    - Add an optional `userId` prop; render `NotificationBell` wired with `userId` only when present; keep the rest of the header rendering when absent
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [ ]* 8.4 Write component tests for nav and dashboard gating
    - Assert nav/dashboard render a subset of server-permitted areas for each level (no over-exposure), and that the bell mounts on both `AdminNavbar` and `InventoryHeader`
    - **Property 15: UI visibility is a subset of server permission**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5, 12.1, 12.2, 12.3**

- [x] 9. Master user-management surface — `src/shared/components/master/UserManagement.tsx`
  - [x] 9.1 Add the access-level selector and column
    - Add `admin_access_level` to the `AdminUser` interface and to `createForm`/`editForm` state (default `inventory_operations`)
    - Add a Shadcn `Select` with all three `ACCESS_LEVEL_LABELS` options to the Create and Edit dialogs (edit pre-selects the admin's resolved level); pass `accessLevel` into `createAdminUser`/`updateAdminUser`; render an "Access Level" column showing the resolved label
    - _Requirements: 14.2, 14.3, 14.4_

- [x] 10. Final checkpoint - full feature wiring
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Property-based tests use `fast-check` (add as a dev dependency if not already present) and encode Correctness Properties 1–11, 13, and 15 from the design. Property 12 and 16 are covered by the component tests (8.4) and the layout/action guards (5.1–5.3) respectively.
- Each task references granular acceptance criteria for traceability; checkpoints provide incremental validation between layers.
- Enforcement is layered (migration constraint → middleware → layout guards → action guards → UI gating); UI gating is UX-only and never the sole barrier.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "2.3"] },
    { "id": 2, "tasks": ["2.4", "2.5", "2.6", "2.7"] },
    { "id": 3, "tasks": ["4.1", "5.1", "5.2", "7.1", "8.1", "8.3"] },
    { "id": 4, "tasks": ["4.2", "5.3", "7.2", "8.2"] },
    { "id": 5, "tasks": ["7.3"] },
    { "id": 6, "tasks": ["7.4", "7.5", "7.6", "8.4", "9.1"] }
  ]
}
```
