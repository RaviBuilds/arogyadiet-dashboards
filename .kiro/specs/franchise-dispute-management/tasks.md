# Implementation Plan: Franchise Dispute Management

## Overview

This plan implements the franchise dispute management feature across the database layer, shared types/validation, repository, server actions, and portal UIs. Each task builds incrementally — starting with the data foundation, then the data access layer, then server actions, and finally wiring the frontend components for both franchise and master portals.

## Tasks

- [x] 1. Database schema and foundational types
  - [x] 1.1 Create the database migration script for `franchise_disputes`
    - Create `scripts/create-franchise-disputes-table.sql` with the full schema: table, CHECK constraints, trigger, RLS policies, and indexes
    - Include: `franchise_disputes` table with all columns (id, franchise_id, category, description, status, master_admin_comment, related_order_ids, created_at, updated_at)
    - Include: CHECK constraint for category (Inventory, Customer, Subscriptions, KIT, Rider, Shop_Products, Operations, Others)
    - Include: CHECK constraint for status (Open, Under_Investigation, Solved)
    - Include: Foreign key to `franchises(id)`
    - Include: `update_franchise_disputes_updated_at` trigger function and trigger
    - Include: RLS enable + 4 policies (franchise select, franchise insert, master select, master update)
    - Include: Indexes on `franchise_id` and `created_at DESC`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [x] 1.2 Create TypeScript types for disputes
    - Create `src/types/dispute.ts` with interfaces: `Dispute`, `DisputeWithFranchiseName`, `ReceivedOrderOption`, `CreateDisputeInput`
    - Types must align with the database schema columns and the design document
    - _Requirements: 1.1, 3.2, 7.2_

  - [x] 1.3 Create Zod validation schemas
    - Create `src/validations/disputeSchema.ts` with: `DISPUTE_CATEGORIES`, `DISPUTE_STATUSES`, `DisputeCategory`, `DisputeStatus` types
    - Implement `createDisputeSchema` with category enum, description (1–2000 chars, trimmed, non-empty), optional related_order_ids array with refinement for Inventory category
    - Implement `updateDisputeStatusSchema` with dispute_id (UUID), status enum, comment (10–1000 chars trimmed)
    - Implement `VALID_TRANSITIONS` map and `isValidTransition()` helper
    - _Requirements: 4.4, 4.5, 5.6, 8.2, 8.3, 8.4_

- [x] 2. Repository layer
  - [x] 2.1 Implement `disputeRepository.ts`
    - Create `src/repositories/disputeRepository.ts`
    - Implement `getDisputesByFranchise(franchiseId)` — fetches disputes filtered by franchise_id, ordered by created_at DESC, using `createClient`
    - Implement `getAllDisputes(franchiseFilter?)` — fetches all disputes joined with franchise name, optional franchise filter, ordered by created_at DESC, using `createAdminClient`
    - Implement `createDispute(data: CreateDisputeInput)` — inserts dispute via `createAdminClient`, returns `{ id }`
    - Implement `updateDisputeStatus(id, status, comment)` — updates status and master_admin_comment via `createAdminClient`
    - Implement `getReceivedOrdersForFranchise(franchiseId)` — queries `franchise_stock_transfers` where dest_franchise_id matches, state = 'RECEIVED', received_at within 72 hours
    - Implement `getFranchisesWithDisputes()` — returns distinct franchises that have at least one dispute
    - _Requirements: 1.1, 3.1, 3.4, 3.5, 5.2, 7.1, 7.3, 7.4, 9.6_

  - [ ]* 2.2 Write property tests for validation schemas and utility functions
    - **Property 1: Description truncation preserves content** — generate strings 0–5000 chars, verify truncation logic
    - **Property 4: Whitespace-only descriptions are rejected** — generate whitespace-only strings, verify schema rejection
    - **Property 7: Status transitions require valid comments** — generate comments 0–2000 chars, verify acceptance iff 10 ≤ trimmed length ≤ 1000
    - **Property 8: Invalid status transitions are rejected** — generate (currentStatus, attemptedStatus) pairs, verify rejection for invalid pairs
    - **Validates: Requirements 3.2, 4.4, 7.2, 8.2, 8.3, 8.4**

- [x] 3. Server actions
  - [x] 3.1 Implement franchise dispute server actions
    - Create `src/actions/franchise-actions/franchiseDisputeActions.ts`
    - Implement `createDisputeAction(formData: FormData)`: resolve scope (FRANCHISE_ADMIN), extract franchise_id from cookie, validate with `createDisputeSchema`, call `createDispute`, revalidate path, return ActionResult
    - Implement `fetchReceivedOrdersAction()`: resolve scope, get franchise_id from cookie, call `getReceivedOrdersForFranchise`, return ActionResult with order list
    - Handle errors: scope failure, validation failure, DB error — return structured error responses
    - _Requirements: 4.3, 4.4, 4.7, 5.1, 5.2, 9.1, 9.3, 9.6_

  - [x] 3.2 Implement master dispute server actions
    - Create `src/actions/master-actions/disputeActions.ts`
    - Implement `updateDisputeStatusAction(formData: FormData)`: resolve scope (MASTER_ADMIN), validate with `updateDisputeStatusSchema`, check `isValidTransition` against current status, call `updateDisputeStatus`, revalidate path, return ActionResult
    - Handle errors: scope failure, invalid transition, validation failure, DB error
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.7, 9.2, 9.6_

  - [ ]* 3.3 Write property tests for server action logic
    - **Property 3: Valid dispute creation round-trip** — generate valid category × description (1–2000 chars), verify created dispute matches inputs with status "Open"
    - **Property 5: 72-hour received order window filter** — generate timestamps spanning ±100 hours from now, verify inclusion iff within 72 hours
    - **Property 6: Franchise filter returns only matching disputes** — generate dispute arrays with random franchise_ids, filter by one, verify all results match
    - **Validates: Requirements 4.3, 5.2, 7.5**

- [x] 4. Checkpoint - Core logic verification
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Franchise portal UI
  - [x] 5.1 Create the franchise disputes page (Server Component)
    - Create `src/app/franchise/(main)/disputes/page.tsx`
    - Read `x-franchise-id` cookie; if missing/invalid, redirect to login
    - Fetch disputes via repository `getDisputesByFranchise`
    - Pass disputes data to `DisputesClient` component
    - _Requirements: 3.1, 3.5, 3.7, 9.5_

  - [x] 5.2 Implement `DisputesClient` component
    - Create `src/app/franchise/(main)/disputes/DisputesClient.tsx` (Client Component)
    - Render `RaiseDisputeForm` and `DisputeHistoryTable` sections
    - Handle success/error toast notifications on form submission
    - Use `useRouter().refresh()` to refresh data after successful creation
    - _Requirements: 4.6, 4.7_

  - [x] 5.3 Implement `RaiseDisputeForm` component
    - Create `src/app/franchise/(main)/disputes/RaiseDisputeForm.tsx` (Client Component)
    - Category dropdown (no default selection) with all 8 categories
    - Description textarea with character counter (max 2000)
    - Conditional multi-select for received orders when category is "Inventory"
    - Fetch received orders via `fetchReceivedOrdersAction` when Inventory selected
    - Show disabled dropdown with message when no orders available
    - Client-side validation with inline error messages
    - Preserve form data on server error
    - Submit via `createDisputeAction`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 5.4 Implement `DisputeHistoryTable` component
    - Create `src/app/franchise/(main)/disputes/DisputeHistoryTable.tsx` (Client Component)
    - Display table with columns: category, description (truncated 100 chars + "…"), status badge, master admin comment, creation date
    - Status badge with distinct background color per state (Open, Under_Investigation, Solved)
    - Empty state message when no disputes exist
    - _Requirements: 3.2, 3.3, 3.4, 3.6_

  - [x] 5.5 Add "Disputes" navigation button to franchise dashboard
    - Modify the franchise dashboard page to include a "Disputes" button in the primary action area
    - Button navigates to `/disputes` route within the franchise portal
    - _Requirements: 2.1, 2.2_

- [x] 6. Master portal UI
  - [x] 6.1 Create the master disputes page (Server Component)
    - Create `src/app/master/(main)/disputes/page.tsx`
    - Fetch all disputes via repository `getAllDisputes`
    - Fetch franchises with disputes via `getFranchisesWithDisputes` for filter dropdown
    - Pass data to `DisputesClient` component
    - _Requirements: 7.1, 7.4, 9.4_

  - [x] 6.2 Implement master `DisputesClient` component
    - Create `src/app/master/(main)/disputes/DisputesClient.tsx` (Client Component)
    - Render franchise filter dropdown and `DisputeListTable`
    - Handle filtering state (client-side filter by franchise_id from pre-fetched data or re-fetch)
    - Handle success/error toasts on status updates
    - _Requirements: 7.4, 7.5, 7.6, 8.6, 8.7_

  - [x] 6.3 Implement `DisputeListTable` component
    - Create `src/app/master/(main)/disputes/DisputeListTable.tsx` (Client Component)
    - Display table with columns: franchise name, category, description (truncated 100 chars + "…"), status, master admin comment, related order count, creation date
    - Status badge with distinct colors per state
    - Action button per row showing valid next status transition
    - Open `ResolveDisputeDialog` on action click
    - Empty state message when no disputes match filter
    - _Requirements: 7.2, 7.3, 7.7, 8.1_

  - [x] 6.4 Implement `ResolveDisputeDialog` component
    - Create `src/app/master/(main)/disputes/ResolveDisputeDialog.tsx` (Client Component)
    - Dialog/modal with comment textarea (10–1000 chars), character counter
    - Submit calls `updateDisputeStatusAction` with dispute_id, new status, comment
    - Show validation errors inline for comment length
    - On success: close dialog, show success toast, refresh list
    - On failure: show error toast, preserve entered comment
    - _Requirements: 8.2, 8.3, 8.6, 8.7_

  - [x] 6.5 Add "Manage Disputes" navigation button to master dashboard
    - Modify the master dashboard page to include a "Manage Disputes" button visible in the page header area
    - Button navigates to `/disputes` route within the master portal
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 7. Checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Property-based tests for UI logic
  - [ ]* 8.1 Write property test for description truncation
    - **Property 1: Description truncation preserves content**
    - Generate arbitrary strings 0–5000 characters; verify: if length > 100 → first 100 chars + "…"; if ≤ 100 → unchanged
    - **Validates: Requirements 3.2, 7.2**

  - [ ]* 8.2 Write property test for dispute list ordering
    - **Property 2: Dispute list ordering invariant**
    - Generate arrays of dispute objects with random timestamps; verify each item's created_at ≥ next item's created_at
    - **Validates: Requirements 3.4, 7.3**

- [x] 9. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The database migration script (1.1) should be run manually against Supabase before implementing the repository layer
- Server actions use `createAdminClient` for mutations (bypasses RLS) and `createClient` for reads (respects RLS), matching existing project patterns
- The `resolveScope()` pattern from existing actions should be reused for authorization checks

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3"] },
    { "id": 1, "tasks": ["2.1"] },
    { "id": 2, "tasks": ["2.2", "3.1", "3.2"] },
    { "id": 3, "tasks": ["3.3"] },
    { "id": 4, "tasks": ["5.1", "6.1"] },
    { "id": 5, "tasks": ["5.2", "5.4", "5.5", "6.2", "6.5"] },
    { "id": 6, "tasks": ["5.3", "6.3"] },
    { "id": 7, "tasks": ["6.4"] },
    { "id": 8, "tasks": ["8.1", "8.2"] }
  ]
}
```
