# 05 — Franchise Portal Feature Map

> Portal: `franchies.*` → `/franchise`. A second tenant model: the franchise operator gets a franchise-scoped copy of the operational tools. Entirely gated by the franchise feature flag (off by default; on in this workspace).
>
> Legend: 🔁 = **shared engine reused** (same logic as Admin, scoped to this franchise) · ⭐ = **franchise-specific** · 🔒 = governed by per-group **manage/view permission**.

## Diagram 5 — Franchise Feature Tree

```mermaid
%%{init: {"theme":"base","mindmap":{"padding":32},"themeVariables":{"cScale0":"#0f172a","cScale1":"#134e4a","cScale2":"#1e3a8a","cScale3":"#4c1d95","cScale4":"#78350f","cScale5":"#14532d","cScale6":"#0c4a6e","cScale7":"#3f0f5f","cScaleLabel0":"#f1f5f9","cScaleLabel1":"#f1f5f9","cScaleLabel2":"#f1f5f9","cScaleLabel3":"#f1f5f9","cScaleLabel4":"#f1f5f9","cScaleLabel5":"#f1f5f9","cScaleLabel6":"#f1f5f9","cScaleLabel7":"#f1f5f9","primaryColor":"#0f172a","primaryTextColor":"#f1f5f9","primaryBorderColor":"#38bdf8","textColor":"#f1f5f9","defaultColor":"#f1f5f9","lineColor":"#94a3b8"},"themeCSS":"text{fill:#f1f5f9 !important;} .mindmap-node text{fill:#f1f5f9 !important;} [class*=root] text{fill:#f1f5f9 !important;} .node-root text{fill:#f1f5f9 !important;}"}}%%
mindmap
  root((Franchise))
    SHARED & REUSED 🔁
      Authentication 🔒 ✅
        Per-area manage or view permission
        Owner = full access
        Suspended franchise blocked
      Customers ✅
        Own customer list
        Customer 360
        Dietitian sees only assigned customers
      Subscriptions ✅
        Own subscriptions 360
        Pause and address overrides
        Partial payments
      Operations ✅
        Own dispatch and batches
        Pincode territory only
      Riders ✅
        Own rider management
        Own service areas
      Shop assisted orders ✅
        For own customers
      Dietitian workspace ✅
        Same engine as Admin and Master
```

```mermaid
%%{init: {"theme":"base","mindmap":{"padding":32},"themeVariables":{"cScale0":"#0f172a","cScale1":"#134e4a","cScale2":"#1e3a8a","cScale3":"#4c1d95","cScale4":"#78350f","cScale5":"#14532d","cScale6":"#0c4a6e","cScale7":"#3f0f5f","cScaleLabel0":"#f1f5f9","cScaleLabel1":"#f1f5f9","cScaleLabel2":"#f1f5f9","cScaleLabel3":"#f1f5f9","cScaleLabel4":"#f1f5f9","cScaleLabel5":"#f1f5f9","cScaleLabel6":"#f1f5f9","cScaleLabel7":"#f1f5f9","primaryColor":"#0f172a","primaryTextColor":"#f1f5f9","primaryBorderColor":"#38bdf8","textColor":"#f1f5f9","defaultColor":"#f1f5f9","lineColor":"#94a3b8"},"themeCSS":"text{fill:#f1f5f9 !important;} .mindmap-node text{fill:#f1f5f9 !important;} [class*=root] text{fill:#f1f5f9 !important;} .node-root text{fill:#f1f5f9 !important;}"}}%%
mindmap
  root((Franchise 2))
    Inventory workflow
      Accept or Reject transfers ✅
        From central kitchen
        Batch and expiry detail
      Receive into own inventory ✅
        Ledger-recorded
      Stock-out ✅
        Sales and wastage
      Package images on transfers ✅
    Own shop catalog and stock ✅
    Disputes ✅
      Raise with category and orders
      Track resolution status
      Resolved by Master only
    Pincode requests ✅
      View assigned pincodes
      Request new pincodes
      Master approves or rejects
    Marketing coupons ✅
    Profile ✅
```

## Notes for the client conversation

- **Reuse, not a copy-paste.** Customers, subscriptions, operations, riders, and the dietitian workspace run on the *same engines* as Admin — the franchise portal just scopes everything to its own franchise. This guarantees, for example, that dietitian activity numbers match what Master reports.
- **The inventory flow is franchise-unique:** central kitchen dispatches stock; the franchise accepts or rejects it, receives it into its own batch-tracked inventory, and consumes it on sales — every movement ledger-recorded. The franchise cannot see the central warehouse; it only sees what was sent to it.
- **Escalation, not independence:** the franchise can raise disputes and request new pincode territories, but only Master resolves/approves them.
- **Permission granularity:** within the franchise team, each user gets manage or view permission per area (customers, subscriptions, riders, operations, shop); the owner always has full access.

