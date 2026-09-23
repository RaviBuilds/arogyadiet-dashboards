# ArogyaDiet — Architecture Analysis Package

> **Isolated documentation workspace.** Everything in `architecture-analysis/` is generated documentation only. Deleting this folder restores the repository to its pre-analysis state — no application source, configuration, dependency, SQL, or test file was created or modified by this exercise.

This folder contains **two related packages**:

---

## Part A — Product Feature Maps (current task)

Client-facing **Portal → Module → Feature → Sub-feature** maps. Product-oriented; statuses only (✅ Implemented · 🟡 Partial · ⛔ Not available · 🔍 Unverified).

| # | Document | Content |
|---|---|---|
| 01 | master-product-map | One-diagram overview: ArogyaDiet → 5 portals → modules |
| 02 | customer-feature-map | Full customer tree with sub-features and statuses |
| 03 | rider-feature-map | Rider tree incl. native GPS tracking, payout caveat |
| 04 | admin-feature-map | Admin/operations tree (customers, subscriptions, dispatch, inventory, finance, dietitian) |
| 05 | franchise-feature-map | Franchise tree, shared vs franchise-specific clearly marked |
| 06 | master-feature-map | Master/BI + hierarchy + rate config tree |
| 07 | shared-features | Cross-portal shared/reused/portal-specific relationship view |
| 08 | feature-status | Overall implemented-vs-pending status map |
| 09 | model-feature-links | AI/model statement (none found) |

**Sources:** `AROGYADIET_DASHBOARDS_FEATURES.md` (product structure), the supplied SQL schema (feature verification), and direct code inspection (statuses). Where the sources disagreed, see Part B document `14-architecture-inventory.md` → Contradictions & Resolutions.

---

## Part B — Technical Architecture Audit (previous task, kept for reference)

Deep engineering view: layers, database domains, security/scoping, automation, native mobile, integrations, contradictions, roadmap.

| # | Document | Question it answers |
|---|---|---|
| 00 | executive-system-map | What was built, how it works, what's live, what's next |
| 01 | platform-architecture | How layers connect (Diagrams A & B) |
| 02 | portal-feature-map | Technical portal/route map with access rules (Diagram G) |
| 03 | application-layer-map | Domain → action → service → table/RPC traceability |
| 04 | ai-model-architecture | AI layer verdict: none (with evidence) |
| 05 | model-feature-matrix | Model ↔ feature matrices (empty by design) |
| 06 | business-workflows | End-to-end flows (Diagrams E & F + 7 more) |
| 07 | database-domain-map | Database by domain (Diagram H) |
| 08 | security-and-scoping | Auth → role → scope → data enforcement chain |
| 09 | external-integrations | Every external provider, entry point, webhook |
| 10 | automation-and-cron | Scheduler → route → pipeline → DB |
| 11 | native-mobile-architecture | Capacitor APK + background GPS fork (Diagram I) |
| 12 | shared-vs-portal-specific | Reuse vs duplication quality assessment |
| 13 | completed-vs-next | Status rollup, gap cards, client-ready roadmap |
| 14 | architecture-inventory | Full inventory, contradictions & resolutions, discovery summary |

---

## Conventions

**Status legend (feature maps):** ✅ Implemented · 🟡 Partial · ⛔ Not available · 🔍 Unverified

**Evidence hierarchy (audit):** `DIRECT CODE` > `CONFIGURATION` > `SCHEMA` > `TEST` > `DOCUMENTATION` > `INFERENCE` (labeled).

## Read-only declaration

```text
READ-ONLY ANALYSIS COMPLETE

Application source modified:        NO
Application configuration modified: NO
Dependencies modified:              NO
Database/schema files modified:     NO
Tests modified:                     NO

All findings are based on repository/schema/documentation evidence.
```
