# Flow: Franchise Stock Transfer (central → franchise)

Files: admin/master dispatch UI → `src/actions/admin-actions/franchiseDispatchActions.ts` → `src/services/franchiseInventoryEngine.ts dispatchToFranchise` → `scripts/create-dispatch-to-franchise-rpc.sql` → franchise `src/app/franchise/(main)/inventory/page.tsx` → `_components/IncomingTransfersPanel.tsx`, `ReceiveTransferControls.tsx` → `src/actions/franchise-actions/franchiseInventoryActions.ts` → `src/lib/auth/scope-resolver.ts` → `src/validations/franchiseInventory.ts` → engine → `create-accept-reject-franchise-transfer-rpcs.sql`, `create-receive-franchise-transfer-rpc.sql` → `StockOutModal.tsx` → `create-record-franchise-stock-out-rpc.sql`.

```mermaid
sequenceDiagram
  autonumber
  participant AD as Admin/Master (inventory)
  participant DA as franchiseDispatchActions.ts
  participant FN as Postgres functions
  participant FR as Franchise operator
  participant FA as franchiseInventoryActions.ts
  AD->>DA: dispatch(product, qty, franchise)
  DA->>DA: getCurrentAdminContext (inventory access)
  DA->>FN: dispatch_to_franchise(...)
  FN->>FN: franchise active? qty>0? stock enough? FIFO lots FOR UPDATE
  FN-->>DA: transfer id (state DISPATCHED)
  FR->>FA: acceptTransferAction(transfer_id)
  FA->>FA: resolveScope = franchise(f), zod
  FA->>FN: accept_franchise_transfer(t, f, user) [row lock, must be DISPATCHED]
  FN-->>FA: ACCEPTED (in transit)
  FR->>FA: receiveTransferAction(transfer_id)
  FA->>FN: receive_franchise_transfer(t, f, user)
  FN->>FN: validate all lines, insert franchise_inventory_lots, ledger IN, RECEIVED (idempotent)
  FR->>FA: stockOutAction(product, qty, reason)
  FA->>FN: record_franchise_stock_out (FIFO by expiry, ledger OUT)
  FR->>FA: franchiseShopStockIn(...)
  FA->>FN: franchise_shop_stock_in -> franchise_product_settings.stock_quantity
```

State machine:
```mermaid
stateDiagram-v2
  [*] --> DISPATCHED
  DISPATCHED --> ACCEPTED
  DISPATCHED --> REJECTED
  ACCEPTED --> RECEIVED
```

Interview line: "Every arrow above is one Postgres function, so each step is one transaction with row locks; the app only proves identity and tenancy and passes ids."
