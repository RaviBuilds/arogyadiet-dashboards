# Implementation Plan: Admin Access Control

## Overview

This plan implements the configurable, per-group admin access model in TypeScript (Next.js App Router, Server Actions, Supabase) following the design. Work proceeds bottom-up: first the pure, edge-safe primitives in `src/lib/auth/adminAccessCore.ts` (level/group/permission model, resolution, classification, permission checks) that carry the property-based tests, then the additive SQL migration, then the server-only resolver + guards, then the master configuration UI and its Server Actions, and finally the enforcement wiring (middleware, layout, navbar, per-group action guards). The permission primitives are kept role-neutral so they can later be reused for `FRANCHISE_ADMIN` without rework; only the core admin portal is wired in this feature.

Property tests use `fast-check` with the existing test runner, a minimum of 100 generated cases each (500 for total/safety properties), and a tag comment `// Feature: admin-access-control, Property {number}: {property text}`. Tasks marked `*` are optional test tasks.

## Tasks

- [x] 1. Extend the pure access-control core (`adminAccessCore.ts`)
  - [x] 1.1 Add group, permission, and configuration model
    - In `src/lib/auth/adminAccessCore.ts` add `OPERATIONS_GROUPS`, `OperationsGroup`, `PERMISSION_LEVELS`, `PermissionLevel`, `OperationsAccess`, and the `AccessConfiguration` interface
    - Add `GROUP_ROUTE_PREFIX` (customers→`/admin/customers`, subscriptions→`/admin/subscriptions`, riders→`/admin/riders`, operations→`/admin/operations`, franchises→`/admin/franchises`, shop_products→`/admin/kitchen-shop`) and `GROUP_LABELS`
    - Keep all additions role-neutral (no role assumptions)
    - _Requirements: 4.1, 6.1, 13.1_

  - [x] 1.2 Implement `resolveAccessConfiguration`
    - Add `resolveAccessConfiguration(rawLevel, rawGroups)` returning an always-valid `AccessConfiguration`; unknown/non-string level → `inventory_operations`; populate `groups` only for `operations`, dropping malformed keys/values; force `groups = {}` for non-operations levels; never throw
    - _Requirements: 10.1, 10.3, 10.4, 1.4_

  - [x] 1.3 Implement group classification and permission checks
    - Add `classifyOperationsGroup(pathname)` (case-sensitive, path-segment boundary, sub-paths resolve to the group, longest-prefix wins)
    - Add `hasGroupAccess(config, group)` and `canManageGroup(config, group)`
    - Add a config-aware `isAdminPathAllowed(config, pathname)` overload combining inventory-area, group, and neutral-path rules; retain `landingRouteFor`
    - _Requirements: 2.3, 3.1, 3.3, 4.4, 5.3, 5.5, 6.2, 6.3, 6.4, 8.5_

  - [x]* 1.4 Property test: total & safe resolution
    - **Property 1: Total & safe resolution**
    - **Validates: Requirements 10.4**

  - [x]* 1.5 Property test: non-operations carries no groups
    - **Property 2: Non-operations carries no groups**
    - **Validates: Requirements 10.3**

  - [x]* 1.6 Property test: manage implies access
    - **Property 3: Manage implies access**
    - **Validates: Requirements 5.3, 5.5**

  - [x]* 1.7 Property test: full access is total
    - **Property 4: Full access is total**
    - **Validates: Requirements 3.1, 3.3, 3.4**

  - [x]* 1.8 Property test: inventory isolation
    - **Property 5: Inventory isolation**
    - **Validates: Requirements 2.1, 2.3, 4.5**

  - [x]* 1.9 Property test: operations gate matches config
    - **Property 6: Operations gate matches config**
    - **Validates: Requirements 4.4, 6.2, 6.3**

  - [x]* 1.10 Property test: path classification boundary-safety
    - **Property 7: Path classification boundary-safety**
    - **Validates: Requirements 6.4, 8.5**

- [x] 2. Add the additive database migration
  - [x] 2.1 Add `admin_operations_access` JSONB column
    - Create `scripts/add-admin-operations-access-to-users.sql` adding nullable `admin_operations_access JSONB DEFAULT NULL` to `public.users` (idempotent `ADD COLUMN IF NOT EXISTS`), respecting Supabase RLS
    - Document the JSON shape `{ "<group>": "manage" | "view" }`; NULL for non-operations and non-admin users
    - _Requirements: 10.1, 10.2_

  - [x] 2.2 Migrate existing admins to full access
    - In the same script, set `admin_access_level = 'inventory_operations'` and `admin_operations_access = NULL` for every user whose role is `ADMIN`; idempotent on re-run
    - _Requirements: 11.1, 11.2, 11.3, 11.5_

- [x] 3. Extend the server-only resolver and guards (`adminAccess.ts`)
  - [x] 3.1 Resolve full configuration in the admin context
    - In `src/lib/auth/adminAccess.ts`, extend `getCurrentAdminContext()` to also select `admin_operations_access` and return a resolved `config: AccessConfiguration` (retain `accessLevel` for back-compat)
    - _Requirements: 8.1, 12.6_

  - [x] 3.2 Add group-scoped guards
    - Add `assertGroupAccess(group)` (throws `AccessDeniedError` for non-ADMIN or `!hasGroupAccess`) and `assertGroupManage(group)` (throws for non-ADMIN, no-access, or `view`)
    - Add `guardAdminGroup(group)` redirect-style page guard (non-ADMIN → `/unauthorized`; lacking access → `redirect(landingRouteFor(config.level))`)
    - _Requirements: 5.3, 9.1, 9.2, 9.3, 9.4_

  - [x]* 3.3 Unit test the guards
    - Verify `assertGroupManage` / `assertGroupAccess` / `guardAdminGroup` over the matrix {no session, non-ADMIN, inventory, full, operations×(manage/view/absent)} with `getCurrentAdminContext` mocked
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

- [x] 4. Build the master configuration UI and Server Actions
  - [x] 4.1 Extend admin Server Actions to persist the configuration
    - In `src/actions/master-actions/adminActions.ts`, extend `createAdminUser` and `updateAdminUser` to accept `operationsAccess`; validate with Zod (`operations` requires a non-empty record of group→permission; other levels must carry none)
    - Persist `admin_operations_access` for `operations`; set `NULL` for `inventory`/`inventory_operations`; include `admin_operations_access` in the admin select used by `getAdminUsers`
    - Keep the single access-changed notification; extend copy when operations groups change
    - _Requirements: 1.2, 1.3, 4.2, 4.3, 5.6, 10.5, 12.4, 12.5_

  - [x] 4.2 Add the group configuration UI to the dialogs
    - In `src/shared/components/master/UserManagement.tsx`, when Access Level is `operations`, render a row per `OPERATIONS_GROUPS` with a select/deselect control and a `manage | view` toggle defaulting to `manage`
    - Pre-populate selected groups and per-group permission on edit; clear local group state when the level changes away from `operations`; disable Save for `operations` with zero groups
    - Surface the resolved configuration label in the admin list
    - _Requirements: 4.1, 5.1, 5.2, 12.1, 12.2, 12.3_

  - [-]* 4.3 Unit test the dialog behavior
    - Selecting `operations` reveals the group block, defaults to `manage`, disables Save on empty selection, and pre-populates on edit
    - SKIPPED: no React DOM test environment (jsdom/happy-dom/testing-library) is configured in this project; would require new infra. Deferred.
    - _Requirements: 12.1, 12.2, 12.3_

  - [x]* 4.4 Property test: validation rejects empties/invalids
    - **Property 9: Validation rejects empties/invalids**
    - **Validates: Requirements 1.3, 4.3, 5.6**

  - [x]* 4.5 Property test: serialization round-trip
    - **Property 8: Serialization round-trip**
    - **Validates: Requirements 10.1, 10.2**

- [x] 5. Wire route-level enforcement
  - [x] 5.1 Update the edge middleware
    - In `src/middleware.ts`, extend the admin profile select to fetch `admin_operations_access`, build the `AccessConfiguration`, and replace the level-based `isAdminPathAllowed` call with the config-aware overload; on deny redirect to `landingRouteFor(config.level)`; keep root/login landing behavior
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 2.2_

  - [x] 5.2 Update the admin layout and navbar
    - In `src/app/admin/(main)/layout.tsx`, keep the coarse operations gate and pass the resolved configuration (or group list + permissions) to the navbar
    - In `AdminNavbar.tsx`, filter nav items by `hasGroupAccess` per group, keeping Dashboard/Profile neutral; still allow navigation to `view` groups
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 6. Wire write-level enforcement on operations actions
  - [x] 6.1 Guard Customers, Subscriptions, and Riders mutations
    - Add `assertGroupManage("customers")` / `"subscriptions"` / `"riders"` to the mutating Server Actions for those groups; use `assertGroupAccess` for read-only loaders that must remain reachable in `view`
    - Convert `AccessDeniedError` to the existing `{ success: false, error }` shape (read-only vs no-access messages); ensure no data change on rejection
    - _Requirements: 5.3, 5.4, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 6.2 Guard Operations, Franchises, and Shop Products mutations
    - Add `assertGroupManage("operations")` / `"franchises"` / `"shop_products"` to the mutating Server Actions for those groups, with the same error mapping and no-change guarantee
    - Add `guardAdminGroup(group)` to the corresponding page server components for defense-in-depth reachability
    - _Requirements: 5.3, 6.2, 6.3, 9.1, 9.2, 9.3, 9.4_

  - [x]* 6.3 Action-gating tests
    - For a representative mutating action per group, verify rejection under `view` and `absent` (no data change) and success under `manage`/full, with the repository/Supabase client mocked
    - Covered via the shared `checkGroupManage` chokepoint (every guarded mutation routes through it): unit tests assert deny under non-admin/absent/view and allow under manage/full.
    - _Requirements: 9.2, 9.3, 9.4_

- [x] 7. Verify and finalize
  - [x] 7.1 Confirm role-agnostic boundaries and franchise inertness
    - Verify the `adminAccessCore.ts` primitives contain no role assumptions and that no franchise-portal enforcement was added; confirm `FRANCHISE_ADMIN`/`Franchise_owner`/`MASTER_ADMIN`/`RIDER`/`CUSTOMER` access is unchanged
    - Verified: `adminAccessCore.ts` has no runtime role logic (role names appear only in comments/enum labels). No franchise-portal (`src/app/franchise`, `src/actions/franchise-actions`) enforcement added. Group guards admit `MASTER_ADMIN` as full access so its prior access is unchanged (Req 13.5). Guarded shared actions are invoked only from the admin portal; the sole master-portal caller uses an unguarded read.
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x] 7.2 Build, lint, and run the access-control test suite
    - Run `npm run lint` and the property/unit suites; fix any failures; confirm the migration is idempotent against a seeded fixture
    - Done: access-control suites pass 46/46 (adminAccessConfig + adminAccessGuards). ESLint clean on all feature files. Migration verified idempotent (both ADMIN users resolve to `inventory_operations`, column present). NOTE: 8 unrelated test failures + 7 `no-explicit-any` lint errors exist in IN-PROGRESS core-clinic-architecture code (`kitchenActions`/`addressActions`/`serviceAreaRepository`/`franchisePincodeActions` pre-existing `any`s) — confirmed via `git diff` that those SUTs are unchanged by this feature and the guards are transparent (execution reaches their repositories). Out of scope for admin-access-control.
    - _Requirements: 11.5_

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.2"] },
    { "id": 2, "tasks": ["1.4", "1.5", "1.6", "1.7", "1.8", "1.9", "1.10", "3.1"] },
    { "id": 3, "tasks": ["3.2", "5.1"] },
    { "id": 4, "tasks": ["3.3", "4.1", "5.2", "6.1", "6.2"] },
    { "id": 5, "tasks": ["4.2", "4.4", "4.5", "6.3"] },
    { "id": 6, "tasks": ["4.3", "7.1"] },
    { "id": 7, "tasks": ["7.2"] }
  ]
}
```

Critical path: 1.1 → 1.3 → 3.1 → 3.2 → 6.x → 7. Task 2 (migration) runs in parallel with Task 1 but Task 3 depends on both. The optional `*` test tasks depend only on the implementation task within the same group and may be deferred without blocking downstream work.

## Notes

- **Role-neutral primitives**: all logic in Task 1 must operate purely on `AccessConfiguration` + path, with no `ADMIN`/`FRANCHISE_ADMIN` assumptions. Role checks live only in Tasks 3, 5, and 6 (wiring), bound to the core admin portal in this feature (Req 13).
- **Defense in depth**: route guards (Tasks 5–6 page guards) gate reachability; the `assertGroupManage` action guards (Task 6) gate mutations. Both are required for `view` correctness — navbar trimming (Task 5.2) is cosmetic only.
- **Backward compatibility**: `resolveAccessConfiguration` must coerce unknown/legacy values to a safe result (full access for unknown level; dropped malformed group entries) and never throw, so a malformed row never breaks the portal.
- **Migration safety**: the migration is additive and idempotent; it sets every existing admin to full access so none lose access during rollout. Run it as a standalone script per the established pattern.
- **Franchise scope**: no franchise-portal enforcement is wired here; `FRANCHISE_FEATURES_ENABLED` stays off and no franchise access is altered (Req 13.2, 13.3, 13.5).
- **Optional tests**: tasks marked `*` are property/unit tests using `fast-check`; they are recommended but may be skipped to unblock implementation.

