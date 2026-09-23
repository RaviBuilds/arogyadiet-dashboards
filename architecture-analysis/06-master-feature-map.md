# 06 — Master Portal Feature Map

> Portal: `master.*` → `/master`. Super-admin / BI portal with full-network scope, grouped by business capability.

## Diagram 6 — Master Feature Tree (grouped)

```mermaid
%%{init: {"theme":"base","mindmap":{"padding":32},"themeVariables":{"cScale0":"#0f172a","cScale1":"#134e4a","cScale2":"#1e3a8a","cScale3":"#4c1d95","cScale4":"#78350f","cScale5":"#14532d","cScale6":"#0c4a6e","cScale7":"#3f0f5f","cScaleLabel0":"#f1f5f9","cScaleLabel1":"#f1f5f9","cScaleLabel2":"#f1f5f9","cScaleLabel3":"#f1f5f9","cScaleLabel4":"#f1f5f9","cScaleLabel5":"#f1f5f9","cScaleLabel6":"#f1f5f9","cScaleLabel7":"#f1f5f9","primaryColor":"#0f172a","primaryTextColor":"#f1f5f9","primaryBorderColor":"#38bdf8","textColor":"#f1f5f9","defaultColor":"#f1f5f9","lineColor":"#94a3b8"},"themeCSS":"text{fill:#f1f5f9 !important;} .mindmap-node text{fill:#f1f5f9 !important;} [class*=root] text{fill:#f1f5f9 !important;} .node-root text{fill:#f1f5f9 !important;}"}}%%
mindmap
  root((Master))
    BI / INTELLIGENCE
      Executive overview ✅
        Network KPIs
        Customer segments
      Growth ✅
        Customer and subscription trends
      Logistics ✅
        Deliveries and rider performance
      Kitchen Operations ✅
        Workload and meal volumes
      Inventory BI ✅
        Central + franchise stock health
      Finance BI ✅
    REPORTING
      Subscription reports ✅
      Customer reports ✅
      Network reports ✅
    HIERARCHY
      Provisioning ✅
        Business → City → Group + Kitchen
        → Franchise → Clinic
      Core clinics management ✅
    FRANCHISE MANAGEMENT
      Franchise lifecycle ✅
        Onboarding · activation · suspension
      Agreement documents ✅
      Kitchen wiring ✅
    INVENTORY / TRANSFERS
      Central → franchise transfers ✅
      Franchise → franchise transfers ✅
      Warehouse BI ✅
```

```mermaid
%%{init: {"theme":"base","mindmap":{"padding":32},"themeVariables":{"cScale0":"#0f172a","cScale1":"#134e4a","cScale2":"#1e3a8a","cScale3":"#4c1d95","cScale4":"#78350f","cScale5":"#14532d","cScale6":"#0c4a6e","cScale7":"#3f0f5f","cScaleLabel0":"#f1f5f9","cScaleLabel1":"#f1f5f9","cScaleLabel2":"#f1f5f9","cScaleLabel3":"#f1f5f9","cScaleLabel4":"#f1f5f9","cScaleLabel5":"#f1f5f9","cScaleLabel6":"#f1f5f9","cScaleLabel7":"#f1f5f9","primaryColor":"#0f172a","primaryTextColor":"#f1f5f9","primaryBorderColor":"#38bdf8","textColor":"#f1f5f9","defaultColor":"#f1f5f9","lineColor":"#94a3b8"},"themeCSS":"text{fill:#f1f5f9 !important;} .mindmap-node text{fill:#f1f5f9 !important;} [class*=root] text{fill:#f1f5f9 !important;} .node-root text{fill:#f1f5f9 !important;}"}}%%
mindmap
  root((Master 2))
    RATE CONFIGURATION
      Delivery and payout rates ✅
        Core vs per-franchise scope
      Change audit trail ✅
    DISPUTES
      Review and resolve ✅
        Investigation notes
        Resolution comment
    DIETITIAN ACTIVITY
      Network-wide report ✅
        Same engine as Admin & Franchise
      Report cards and history ✅
    SYSTEM / USERS
      User management ✅
        Create/edit admin & franchise users
        Access levels and permissions
      System settings ✅
      Audit logs ✅
      Notification settings ✅
    TRACKING
      Network-wide live rider map ✅
    SUBSCRIPTIONS
      Network reporting 🟡
        Report-only by design
    Authentication ✅
      Email + password — MASTER_ADMIN
```

## Notes for the client conversation

- **Master sees everything, touches the structure.** Where Admin runs today's business and Franchise runs its own territory, Master owns the *network*: which businesses/cities/kitchens/franchises/clinics exist, what delivery and payout rates apply, and who gets access to which portal.
- **BI-first design:** growth, logistics, kitchen-ops, inventory and finance each have a dedicated analytics suite, plus a flexible report engine with exportable outputs.
- **Control loops:** Master both provisions franchises *and* is the escalation point for their disputes and pincode requests; rate changes are audit-logged field-by-field.
- Subscriptions here are deliberately read-only reporting — actual subscription management belongs to Admin/Franchise.

