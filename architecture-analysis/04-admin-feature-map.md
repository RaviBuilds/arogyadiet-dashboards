# 04 — Admin Portal Feature Map

> Portal: `admin.*` → `/admin`. Role-gated with access levels (inventory / operations / inventory_operations / dietitian). The 11 modules are grouped below into five business areas for readability — the features themselves are unchanged.

## Diagram 4 — Admin Feature Tree (grouped)

```mermaid
%%{init: {"theme":"base","mindmap":{"padding":32},"themeVariables":{"cScale0":"#0f172a","cScale1":"#134e4a","cScale2":"#1e3a8a","cScale3":"#4c1d95","cScale4":"#78350f","cScale5":"#14532d","cScale6":"#0c4a6e","cScale7":"#3f0f5f","cScaleLabel0":"#f1f5f9","cScaleLabel1":"#f1f5f9","cScaleLabel2":"#f1f5f9","cScaleLabel3":"#f1f5f9","cScaleLabel4":"#f1f5f9","cScaleLabel5":"#f1f5f9","cScaleLabel6":"#f1f5f9","cScaleLabel7":"#f1f5f9","primaryColor":"#0f172a","primaryTextColor":"#f1f5f9","primaryBorderColor":"#38bdf8","textColor":"#f1f5f9","defaultColor":"#f1f5f9","lineColor":"#94a3b8"},"themeCSS":"text{fill:#f1f5f9 !important;} .mindmap-node text{fill:#f1f5f9 !important;} [class*=root] text{fill:#f1f5f9 !important;} .node-root text{fill:#f1f5f9 !important;}"}}%%
mindmap
  root((Admin))
    CUSTOMER MANAGEMENT
      Full Onboarding ✅
        Profile and dietary info
        Address
        Subscription + payment in one flow
      Quick Onboarding ✅
      Bulk Import ✅
      Customer 360 ✅
        Subscriptions and deliveries
        Payments and health logs
        Report card and shipping
      Assisted Shop Orders ✅
        Ordered on customer's behalf
      Walk-in Shop Orders ✅
    OPERATIONS
      Daily Orders and Batches ✅
      Dispatch Control ✅
        Automated + manual assignment
      Kitchen Workload Snapshots ✅
        Veg / non-veg / egg counts
        Product counts per clinic
      Routing Sandbox 🟡
        Trial runs without writes
      Fallback Automation ✅
        Holiday-aware regeneration
        Manual re-runs
      Riders Management ✅
        Service areas — pincodes
        Fixed customer assignments
        Live map tracking
        Payout settlement
```

```mermaid
%%{init: {"theme":"base","mindmap":{"padding":32},"themeVariables":{"cScale0":"#0f172a","cScale1":"#134e4a","cScale2":"#1e3a8a","cScale3":"#4c1d95","cScale4":"#78350f","cScale5":"#14532d","cScale6":"#0c4a6e","cScale7":"#3f0f5f","cScaleLabel0":"#f1f5f9","cScaleLabel1":"#f1f5f9","cScaleLabel2":"#f1f5f9","cScaleLabel3":"#f1f5f9","cScaleLabel4":"#f1f5f9","cScaleLabel5":"#f1f5f9","cScaleLabel6":"#f1f5f9","cScaleLabel7":"#f1f5f9","primaryColor":"#0f172a","primaryTextColor":"#f1f5f9","primaryBorderColor":"#38bdf8","textColor":"#f1f5f9","defaultColor":"#f1f5f9","lineColor":"#94a3b8"},"themeCSS":"text{fill:#f1f5f9 !important;} .mindmap-node text{fill:#f1f5f9 !important;} [class*=root] text{fill:#f1f5f9 !important;} .node-root text{fill:#f1f5f9 !important;}"}}%%
mindmap
  root((Admin 2))
    BUSINESS
      Subscriptions 360 ✅
        Timeline and preferences
        Bulk pause/address overrides
        Tenure recalculation 🟡
          Flagged untested
        KIT provisioning ✅
        Per-subscription delivery routing ✅
      Finance ✅
        Payments and manual entry
        Payout approvals
        Partial-payment handling
        Invoices and stay receipts PDF
      Holidays ✅
        Calendar affects dispatch
    INVENTORY
      Warehouse stock ✅
        Lot-based — batches and expiry
        Transactions ledger
      Manufacturing ✅
        Raw to finished processing
        Batches and mappings
      Shop product catalog ✅
      Purchase orders + Excel export ✅
      Duplicate inventory menu 🟡
        Two identical menu roots
    KITCHEN SHOP
      Clinic product visibility and stock ✅
      Stock in / sale ledger ✅
    DIETITIAN
      Log-Customer workspace ✅
        Cadence alerts
      Health log authoring ✅
      Report cards ✅
        Window · finalise · reopen
    FRANCHISES & SUPPORT
      Franchise onboarding ✅
      Suspension / activation ✅
      Agreement documents ✅
      Kitchen wiring ✅
      Own profile and PIN ✅
```

## Notes for the client conversation

- **Access levels are real role separation:** an `inventory`-level admin never sees operations pages and vice versa; the gate is enforced at routing *and* re-checked inside the portal.
- **Customer onboarding is the front door:** accounts are created by admin (self-signup is disabled), with full/quick/bulk variants for different throughput needs.
- **Operations has a safety net:** if the nightly automation misses a step, admins can manually re-run pipeline stages, and holidays automatically pause delivery generation.
- The kitchen-shop module manages clinic-level product stock separately from warehouse inventory.

