# Implementation Plan: Franchise Inventory

## Overview

This plan implements the finished-product-only franchise inventory in TypeScript (Next.js App Router + Supabase), following the additive design. Work proceeds bottom-up: shared types and Zod schemas, then the additive database schema and `SECURITY DEFINER` RPCs, then the pure property-tested logic in `src/lib/franchise-inventory/`, then the repository, service, server actions, and finally the franchise-portal UI and the central-kitchen dispatch extension. Each step builds on the previous and ends wired into the layer above it, with integration tests covering the transactional rollback guarantees that cannot be expressed as pure properties.

Property-based tests use `fast-check` + `vitest` at a minimum of 100 iterations, tagged with the design property number and the requirements clause they validate. Optional sub-tasks (marked `*`) are tests and may be skipped for a faster MVP.

## Tasks

- [x] 1. Establish franchise-inventory types and validation schemas
  - [x] 1.1 Define TypeScript types
    - Create `src/types/franchiseInventory.ts` with `FranchiseTransferState`, `StockOutReason`, `FranchiseBatch`, `FranchiseCatalogProduct`, `FranchiseStockTransfer`, and `FranchiseLedgerEntry` as specified in the design
    - _Requirements: 2.4, 7.2, 10.1, 11.1, 11.2_

  - [x] 1.2 Define Zod validation schemas
    - Create `src/validations/franchiseInventory.ts` with schemas for the stock-out input (reason enum, positive whole-number quantity, `OTHER` requires comment of length 1–500), the dispatch input (active-franchise destination id, finished product id, quantity > 0), and the transfer-action inputs (transfer id + franchise id)
    - _Requirements: 6.6, 10.1, 10.4, 10.5, 10.6_

- [x] 2. Create the additive franchise-inventory database schema
  - [x] 2.1 Create `franchise_inventories` table
    - Add `scripts/create-franchise-inventories-table.sql` with `UNIQUE(franchise_id)` 1:1 constraint and the `updated_at` trigger
    - _Requirements: 1.2, 1.3, 1.4, 1.6_

  - [x] 2.2 Create `franchise_inventory_lots` table
    - Add `scripts/create-franchise-inventory-lots-table.sql` with `batch_number`, `expiry_date`, `quantity_remaining` check, `received_at`, `source_transfer_id`, `status`, and the partial FIFO index `(product_id, expiry_date ASC, received_at ASC) WHERE status='ACTIVE'`
    - _Requirements: 9.1, 9.3, 12.1_

  - [x] 2.3 Create `franchise_stock_transfers` and `franchise_stock_transfer_lines` tables
    - Add `scripts/create-franchise-stock-transfers-tables.sql` with the `franchise_transfer_state` enum, the header table (state, timestamps, source kitchen, actor columns), the lines table (batch breakdown, `source_lot_id`), and supporting indexes
    - _Requirements: 6.2, 7.2, 8.6_

  - [x] 2.4 Create `franchise_inventory_ledger` table
    - Add `scripts/create-franchise-inventory-ledger-table.sql` with the `franchise_ledger_direction` enum, identity primary key for insertion order, the `ck_ledger_direction` check, and the `(franchise_id, occurred_at DESC, id DESC)` index
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 2.5 Add RLS policies for the franchise-inventory tables
    - Add `scripts/create-franchise-inventory-rls-policies.sql` following the existing `is_global_role() OR franchise_id = current_franchise_id()` pattern for all four new tables
    - _Requirements: 2.6, 11.3, 11.6, 13.5_

  - [x] 2.6 Extend `inventory_transactions` for franchise dispatch
    - Add `scripts/add-franchise-dispatch-to-inventory-transactions.sql` to add `dest_franchise_id` and `franchise_transfer_id` columns and relax the legacy fixed-branch reason CHECK, leaving existing central records and schema otherwise unchanged
    - _Requirements: 13.2, 13.4_

- [x] 3. Implement atomic mutation RPCs
  - [x] 3.1 Implement `provision_franchise_inventory` RPC
    - Add `scripts/create-provision-franchise-inventory-rpc.sql` using `INSERT ... ON CONFLICT (franchise_id) DO NOTHING` so provisioning is idempotent and concurrency-safe; intended to run inside the franchise-creation transaction
    - _Requirements: 1.1, 1.4, 1.5, 1.6_

  - [x] 3.2 Implement `dispatch_to_franchise` RPC
    - Add `scripts/create-dispatch-to-franchise-rpc.sql`: assert destination is an `active` franchise and quantity > 0, deplete central FIFO lots, create one `DISPATCHED` transfer plus lines summing to the quantity, and write the central outgoing ledger entry stamped with `dest_franchise_id`/`franchise_transfer_id`; raise (roll back) on insufficient/invalid quantity, inactive destination, or ledger-write failure
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6, 6.7, 13.2, 13.3_

  - [x] 3.3 Implement `accept_franchise_transfer` and `reject_franchise_transfer` RPCs
    - Add `scripts/create-accept-reject-franchise-transfer-rpcs.sql`: assert source state is `DISPATCHED`, transition to `ACCEPTED`/`REJECTED` without changing on-hand, and raise with state unchanged on a wrong source state or processing failure
    - _Requirements: 7.4, 7.5, 7.6, 7.7_

  - [x] 3.4 Implement `receive_franchise_transfer` RPC
    - Add `scripts/create-receive-franchise-transfer-rpc.sql`: assert source state `ACCEPTED`, reject lines missing batch number or expiry, reject non-`FINISHED_GOOD` products, create `franchise_inventory_lots` matching the transfer lines, increment on-hand, write the IN ledger entry with the central-kitchen source, treat an already-`RECEIVED` transfer as a no-op, and roll back fully on failure
    - _Requirements: 3.4, 8.3, 8.4, 8.5, 8.7, 8.8, 9.1, 9.3, 11.1, 12.1, 12.2_

  - [x] 3.5 Implement `record_franchise_stock_out` RPC
    - Add `scripts/create-record-franchise-stock-out-rpc.sql`: validate reason/quantity/comment, FIFO-deplete earliest-expiry lots first, reject when requested exceeds available, and write the OUT ledger entry inside the same transaction
    - _Requirements: 9.4, 9.5, 10.2, 10.3, 10.7, 11.2, 11.7_

- [x] 4. Implement the transfer state-machine logic
  - [x] 4.1 Implement the transfer-state reducer
    - Create `src/lib/franchise-inventory/transfer-state-reducer.ts` permitting only `DISPATCHED→ACCEPTED`, `DISPATCHED→REJECTED`, `ACCEPTED→RECEIVED`, with idempotent `RECEIVED`, and computing the lots/on-hand delta produced by a receipt from the transfer lines
    - _Requirements: 7.4, 7.5, 7.6, 8.3, 8.5, 8.6, 8.8_

  - [x]* 4.2 Write property test for the transfer state machine
    - **Property 12: The transfer state machine permits only its legal edges**
    - **Validates: Requirements 7.4, 7.5, 7.6, 8.3, 8.5, 8.6**

  - [x]* 4.3 Write property test for receipt conservation and traceability
    - **Property 13: Receipt is a conserving, traceable stock-in**
    - **Validates: Requirements 8.4, 9.1, 9.3, 11.1, 12.1**

  - [x]* 4.4 Write property test for receipt idempotency
    - **Property 14: Receipt is idempotent**
    - **Validates: Requirements 8.8**

- [x] 5. Implement on-hand and catalog computation
  - [x] 5.1 Implement the on-hand calculator
    - Create `src/lib/franchise-inventory/on-hand-calculator.ts` summing `quantity_remaining` over `ACTIVE` lots per product, excluding in-transit transfers, and building the catalog with batch breakdown ordered by expiry ASC then received ASC
    - _Requirements: 2.4, 6.5, 8.1, 9.2_

  - [x]* 5.2 Write property test for on-hand counting only received active stock
    - **Property 4: On-hand counts only received, active stock**
    - **Validates: Requirements 6.5, 8.1, 9.2**

  - [x]* 5.3 Write property test for catalog reflecting lots with finished products only
    - **Property 6: Catalog reflects lots and contains only finished products**
    - **Validates: Requirements 2.4, 3.1**

  - [x]* 5.4 Write property test for displayed batch ordering
    - **Property 22: Displayed batch breakdown is ordered by expiry then received date**
    - **Validates: Requirements 12.4**

- [x] 6. Implement FIFO depletion and stock-out validation
  - [x] 6.1 Implement the FIFO depletion function
    - Create `src/lib/franchise-inventory/fifo-depletion.ts` depleting the earliest-expiry batch first (ties by earliest received date), fully consuming each batch before the next, returning the per-batch depletion plan
    - _Requirements: 10.2, 12.5_

  - [x] 6.2 Implement stock-out input validation
    - Create `src/lib/franchise-inventory/stock-out-validation.ts` enforcing the reason set, positive whole-number quantity, the `OTHER` comment length 1–500, and an available-stock check that returns requested vs available
    - _Requirements: 10.1, 10.3, 10.4, 10.5, 10.6, 12.6_

  - [x]* 6.3 Write property test for stock-out input validation
    - **Property 16: Stock-out input validation**
    - **Validates: Requirements 10.1, 10.4, 10.5, 10.6**

  - [x]* 6.4 Write property test for FIFO depletion order
    - **Property 17: Stock-out depletes FIFO by earliest expiry**
    - **Validates: Requirements 10.2, 12.5**

  - [x]* 6.5 Write property test for rejecting stock-out exceeding available
    - **Property 18: Stock-out exceeding available is rejected**
    - **Validates: Requirements 10.3, 12.6**

  - [x]* 6.6 Write property test for the stock-out outgoing ledger entry
    - **Property 19: Stock-out records a complete outgoing ledger entry**
    - **Validates: Requirements 10.7, 11.2**

- [x] 7. Implement destination, product, scope, and permission guards
  - [x] 7.1 Implement the active-destination filter
    - Create `src/lib/franchise-inventory/active-destination-filter.ts` returning exactly the `active` franchises and excluding `onboarding`, `suspended`, and any non-`active` status
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 13.1_

  - [x]* 7.2 Write property test for the destination selector
    - **Property 9: Destination selector lists exactly the active franchises**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 13.1**

  - [x] 7.3 Implement the finished-product guard and scope predicate
    - Create `src/lib/franchise-inventory/finished-product-guard.ts` (rejects non-`FINISHED_GOOD` with the offending product identified) and `src/lib/franchise-inventory/scope-predicate.ts` (filters rows to the caller's `franchise_id`)
    - _Requirements: 2.6, 3.1, 3.2, 3.4, 11.3, 11.6_

  - [x]* 7.4 Write property test for non-finished product rejection
    - **Property 7: Non-finished products are rejected everywhere**
    - **Validates: Requirements 3.2, 3.4**

  - [x]* 7.5 Write property test for scope isolation and ordered ledger reads
    - **Property 5: Scope isolation hides other franchises' data**
    - **Property 20: Ledger is scoped and ordered newest-first**
    - **Validates: Requirements 2.6, 11.3, 11.4, 11.6**

  - [x] 7.6 Implement the franchise permission predicate and stock-in guard
    - Create `src/lib/franchise-inventory/permissions.ts` (permits only Stock_In confirmation and Stock_Out recording; denies all product create/edit/delete) and `src/lib/franchise-inventory/stock-in-guard.ts` (requires a `RECEIVED` transfer and a positive quantity)
    - _Requirements: 4.1, 4.2, 4.3, 9.4, 9.5_

  - [x]* 7.7 Write property test for the franchise permission predicate
    - **Property 8: Franchise permission predicate**
    - **Validates: Requirements 4.2, 4.3**

  - [x]* 7.8 Write property test for the stock-in guard
    - **Property 15: Stock-in requires an authorized received transfer and a positive quantity**
    - **Validates: Requirements 9.4, 9.5, 13.5**

- [x] 8. Checkpoint - pure logic and schema
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement the franchise-inventory repository
  - [x] 9.1 Create `franchiseInventoryRepository.ts`
    - Create `src/repositories/franchise/franchiseInventoryRepository.ts` with `getInventoryByFranchise`, `listActiveLots`, `listTransfers`, `getTransferById`, and `listLedgerEntries`, all applying the caller's `Scope` on the denormalized `franchise_id` column (mirrors RLS)
    - _Requirements: 2.6, 11.3, 11.4, 11.6_

- [x] 10. Implement the franchise-inventory service
  - [x] 10.1 Create `franchiseInventoryEngine.ts`
    - Create `src/services/franchiseInventoryEngine.ts` wiring the repository reads and pure logic into `getFranchiseInventoryCatalog`, `getIncomingTransfers`, `acceptTransfer`, `rejectTransfer`, `receiveTransfer`, `recordStockOut`, `getFranchiseLedger`, `listActiveFranchiseDestinations`, and `dispatchToFranchise`, delegating atomic writes to the RPCs via `createAdminClient().rpc(...)`
    - _Requirements: 5.1, 6.1, 7.4, 7.5, 8.3, 9.1, 10.2, 11.4_

- [x] 11. Implement server actions
  - [x] 11.1 Create franchise-portal inventory actions
    - Create `src/actions/franchise-actions/franchiseInventoryActions.ts` with `acceptTransferAction`, `rejectTransferAction`, `receiveTransferAction`, and `recordStockOutAction`: resolve scope, use `scope.franchise_id` as authoritative, validate with the Zod schemas, call the service, return `ActionResult<T>`, and `revalidatePath` the franchise routes; product create/edit/delete actions are intentionally absent
    - _Requirements: 2.6, 4.1, 4.2, 4.3, 7.4, 7.5, 8.3, 10.1, 11.6_

  - [x] 11.2 Create the admin dispatch-to-franchise action
    - Create `dispatchToFranchiseAction` in `src/actions/admin-actions/franchiseDispatchActions.ts` validating the destination is an `Active_Franchise` and quantity > 0, then calling the service `dispatchToFranchise`
    - _Requirements: 6.1, 6.4, 6.6, 6.7, 13.2_

  - [x] 11.3 Extend franchise creation to provision an inventory
    - Update `src/actions/master-actions/franchiseActions.ts` `createFranchise` to call `provision_franchise_inventory` within the franchise-creation transaction and roll back / return an error on provisioning failure
    - _Requirements: 1.1, 1.2, 1.5_

- [x] 12. Checkpoint - data and action layers
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Build the franchise-portal inventory UI
  - [x] 13.1 Create the franchise inventory page
    - Create `src/app/franchise/(main)/inventory/page.tsx` (RSC) reading the catalog and incoming transfers, reusing `ProductCard` with `productManagement={false}`, showing the empty-inventory and out-of-stock states, and an `error.tsx` boundary with a retry action
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 3.3, 4.1, 12.3_

  - [x] 13.2 Create the incoming-transfers panel and receive controls
    - Create `IncomingTransfersPanel` and `ReceiveTransferControls` client leaves rendering DISPATCHED transfers (sender, product, quantity, batch breakdown, timestamp) with Accept/Reject controls and the in-transit ACCEPTED state with a Received control, wired to the transfer actions
    - _Requirements: 7.1, 7.2, 7.3, 8.2_

  - [x] 13.3 Create the stock-out modal
    - Create the `StockOutModal` client leaf with the reason selector, quantity input, conditional `OTHER` comment field, and surfaced validation/insufficient-stock errors, wired to `recordStockOutAction`
    - _Requirements: 10.1, 10.3, 10.5, 10.6_

  - [x] 13.4 Create the franchise ledger page
    - Create `src/app/franchise/(main)/inventory/ledger/page.tsx` (RSC) rendering incoming/outgoing entries newest-first with the empty-ledger state
    - _Requirements: 11.4, 11.5_

  - [x]* 13.5 Write component/example tests for the franchise UI
    - Test empty-inventory state, out-of-stock indicator, absence of product-management controls, incoming-transfer card + controls, reused `ProductCard`/batch popover, and empty ledger
    - _Requirements: 2.2, 2.3, 2.5, 3.3, 4.1, 7.1, 7.2, 7.3, 8.2, 11.5, 12.3_

- [x] 14. Extend the central-kitchen dispatch UI
  - [x] 14.1 Wire active franchises into the dispatch destination selector
    - Update the central-kitchen `DispatchStockModal` destination selector to populate from `listActiveFranchiseDestinations()` while preserving existing non-franchise destinations, and show a "no destinations available" message that disables selection when none are active
    - _Requirements: 5.1, 5.7, 13.1_

  - [x]* 14.2 Write component test for the no-active-destinations state
    - Test the selector renders the no-destinations message and prevents selection when no franchise is active
    - _Requirements: 5.7_

- [x] 15. Integration tests for transactional guarantees
  - [x]* 15.1 Write provisioning rollback and concurrency tests
    - Verify a provisioning failure aborts franchise creation, and concurrent creation yields exactly one inventory
    - _Requirements: 1.5, 1.6_

  - [x]* 15.2 Write transfer-lifecycle rollback tests
    - Verify accept/reject/receive failures leave state and on-hand unchanged, and receipt rollback persists nothing
    - _Requirements: 7.7, 8.7_

  - [x]* 15.3 Write ledger/dispatch rollback and central non-regression tests
    - Verify a ledger-write failure rolls the whole movement back, dispatch rollback leaves central stock unchanged, and central-kitchen records/schema are otherwise unchanged
    - _Requirements: 11.7, 13.3, 13.4_

- [x] 16. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional tests (property, unit/component, integration) and can be skipped for a faster MVP.
- Each task references specific requirements for traceability; property-test tasks additionally cite the design property number they implement.
- The 23 correctness properties from the design are implemented as property-based tests using `fast-check` at a minimum of 100 iterations, placed next to the pure logic they exercise so errors surface early.
- Provisioning concurrency, RLS wiring, and transactional rollback are validated by integration tests rather than pure properties.
- All new database objects are additive; the central kitchen inventory is changed only through the dispatch destination and ledger additions (Requirement 13).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2", "2.3", "2.4", "2.5", "2.6"] },
    { "id": 1, "tasks": ["3.1", "3.2", "3.3", "3.4", "3.5", "4.1", "5.1", "6.1", "6.2", "7.1", "7.3", "7.6"] },
    { "id": 2, "tasks": ["4.2", "4.3", "4.4", "5.2", "5.3", "5.4", "6.3", "6.4", "6.5", "6.6", "7.2", "7.4", "7.5", "7.7", "7.8", "9.1"] },
    { "id": 3, "tasks": ["10.1"] },
    { "id": 4, "tasks": ["11.1", "11.2", "11.3"] },
    { "id": 5, "tasks": ["13.1", "13.2", "13.3", "13.4", "14.1"] },
    { "id": 6, "tasks": ["13.5", "14.2", "15.1", "15.2", "15.3"] }
  ]
}
```
