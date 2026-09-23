# 01 — ArogyaDiet Master Product Map

> High-level map only — module names per portal. Features and sub-features live in the per-portal maps (`02`–`06`).

## Diagram 1 — Master Product Map

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#0f172a","primaryTextColor":"#f1f5f9","primaryBorderColor":"#475569","lineColor":"#64748b","textColor":"#f1f5f9","fontSize":"15px"},"themeCSS":".node text, text{fill:#f1f5f9 !important;}"}}%%
flowchart TB
    AD["**AROGYADIET**<br/>Meal Delivery · KIT · Wellness Stay"]

    AD --> C["CUSTOMER<br/>─────────<br/>Authentication<br/>Dashboard<br/>Meal Subscription<br/>KIT<br/>Accommodation<br/>Shop & Orders<br/>Tracking<br/>Health<br/>Profile<br/>Get the App"]

    AD --> R["RIDER<br/>─────────<br/>Authentication<br/>Dashboard<br/>Duty & Shift<br/>Route<br/>Delivery<br/>Live Tracking<br/>Payout<br/>Profile"]

    AD --> A["ADMIN<br/>─────────<br/>Dashboard<br/>Customers<br/>Subscriptions<br/>Operations<br/>Riders<br/>Finance<br/>Inventory<br/>Kitchen Shop<br/>Dietitian<br/>Franchises<br/>Holidays · Profile"]

    AD --> F["FRANCHISE<br/>─────────<br/>Customers<br/>Subscriptions<br/>Operations<br/>Riders<br/>Inventory<br/>Shop<br/>Dietitian<br/>Disputes<br/>Marketing · Pincodes"]

    AD --> M["MASTER<br/>─────────<br/>BI Dashboards<br/>Reports<br/>Hierarchy<br/>Franchises<br/>Rate Config<br/>Stock Transfers<br/>Disputes<br/>Users · System<br/>Tracking"]

    classDef rootN fill:#0f172a,stroke:#38bdf8,stroke-width:2px,color:#f1f5f9;
    classDef portalC fill:#134e4a,stroke:#2dd4bf,stroke-width:1.5px,color:#f1f5f9;
    classDef portalR fill:#78350f,stroke:#fbbf24,stroke-width:1.5px,color:#f1f5f9;
    classDef portalA fill:#1e3a8a,stroke:#60a5fa,stroke-width:1.5px,color:#f1f5f9;
    classDef portalF fill:#4c1d95,stroke:#c084fc,stroke-width:1.5px,color:#f1f5f9;
    classDef portalM fill:#0c4a6e,stroke:#38bdf8,stroke-width:1.5px,color:#f1f5f9;

    class AD rootN;
    class C portalC;
    class R portalR;
    class A portalA;
    class F portalF;
    class M portalM;
```

## How to read the product

- **Three product lines, one spine.** Every customer runs through one account/subscription spine with a category: **MEAL** (daily food delivery), **KIT** (shipped self-administered diet kit), **ACCOMMODATION** (in-clinic wellness stay).
- **Two operations portals.** Admin runs the core business; Franchise runs the same capabilities for its own customers/riders/inventory — reusing the same engines, scoped to its franchise.
- **One management portal.** Master is BI-first: network dashboards, hierarchy provisioning, rate configuration, dispute resolution.
- **One field portal.** Rider is a mobile app built around duty → route → delivery, with native background GPS.

## Feature-count snapshot

| Portal | Modules | Status profile |
|---|---|---|
| Customer | 10 | All modules ✅; OTP login ⛔ unmounted; self-signup ⛔ disabled by design |
| Rider | 7 | All core ✅; payout 🟡; 2 legacy routes ⛔ |
| Admin | 11 | All core ✅; tenure recalculation 🟡; duplicate inventory menu 🟡 |
| Franchise | 9 | All core ✅ (feature-flag gated); warehouse view intentionally absent |
| Master | 12 | All ✅; subscriptions view is report-only 🟡 |
