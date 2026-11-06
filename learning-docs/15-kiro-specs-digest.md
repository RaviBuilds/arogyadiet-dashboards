# 15 — Digest of `.kiro/` Specs, Steering and `AI_CONTEXT/`

How the project was built: each feature was specified in Kiro as `requirements.md` (numbered requirements like "Req 18.4"), `design.md` (architecture, properties to test), and `tasks.md` (checklist). Code comments cite these numbers (e.g. `[Req 16.5]` in `middleware.ts`), so you can always jump from code to the reason. Task counts below come from counting `- [x]` and `- [ ]` lines on 2026-11-02; `- [ ]*` marks optional tasks (mostly optional property tests).

**Caution:** checklists are not always updated. Example: `accommodation-customer-flow` tasks 12–13 (admin accommodation tab, dialogs) are unchecked, yet `AccommodationTab.tsx`, `NewStayDialog.tsx`, `StayExtensionDialog.tsx` exist. Trust code over checkboxes.

## 1. Steering (always-loaded rules)
| File | Decision it encodes |
|---|---|
| `steering/product.md` | Business model, pincode-based riders, pause credits, distance payouts |
| `steering/tech.md` | Stack; mentions React Query (not actually used in `src/`) |
| `steering/structure.md` | Portal folders, import rules (no cross-portal imports), which Supabase client where |
| `steering/franchise-execution-plan.md` | Phased, flag-gated franchise rollout (additive, inert when flag off) |
| `steering/rider-gps-tracking.md` | Full history of the GPS fix, test results, deploy mechanics, open items |

## 2. AI_CONTEXT (older rules for agents)
`ARCHITECTURE.md` (modular monolith, server-first, middleware flow; mentions non-existent `src/modules`), `BUSINESS_RULES.md` (pincode pivot, pause invariant, payout formula, inventory/manufacturing rules), `DATABASE_RULES.md` (critical tables, dangerous operations: never edit daily preferences without recounting, never hard-delete profiles), `MODULE_BOUNDARIES.md` (isolation), `PROJECT_OVERVIEW.md` (says Next 15 and 4 portals — stale). `docs/system-rules.md`: "do no harm" to customer/rider portals, 5 PM cutoff, reconciliation engine, design standards.

## 3. Specs

| Spec | What it decided and why | Tasks done / open (optional) | Status |
|---|---|---|---|
| `core-clinic-architecture` | Business → Kitchen → Clinic hierarchy; clinic coordinates as route origin; immutable clinic stamps on orders/batches; per-clinic workload snapshots; daily pipeline order (create → link → snapshot → route), 5 PM cutoff as a pure predicate. Why: one kitchen could not model multiple pickup points. | 103 / 0 | Finished |
| `multi-tenant-franchise` | `franchise_id` partitioning, scope resolver, groups/cities, feature flag `FRANCHISE_FEATURES_ENABLED` (inert when off), unknown-subdomain denial, stock transfers (`transfer_stock`). Why: let partners run franchises on the same codebase without risking core production. | 53 / 14 (14) | Core done; optional tests open |
| `franchise-inventory` | Finished-goods-only franchise inventory, transfer state machine via SECURITY DEFINER RPCs, FIFO lots, ledger. Why: atomic, auditable stock movement between tenants. | 66 / 0 | Finished |
| `franchise-customer-dashboard-enhancement` | Bring franchise `/customers` close to admin parity (tabs, filters, actions). | 26 / 9 (9) | Done, optional open |
| `franchise-dispute-management` | One-way dispute flow franchise → master, linear statuses with comments. | 24 / 5 (4) | 1 required item (UI property tests) open |
| `admin-access-levels` | Three levels (inventory / operations / inventory_operations) as sub-classes of ADMIN; NULL = full for backward compatibility; edge-safe pure core module. | 27 / 7 (7) | Done |
| `admin-access-control` | Per-group manage/view model on top of `operations`; role-neutral so franchise can reuse it. | 33 / 0 | Finished |
| `clinic-scoped-shop-inventory` | Per-clinic shop stock with ledger, three sale channels, clinic-scoped admins, deterministic locking, error prefixes. Why: shared stock could not show per-clinic numbers. | 80 / 0 | Finished |
| `shop-product-access-separation` | Separates who may manage shop products vs view (per name/tasks; details UNVERIFIED). | 16 / 6 (6) | Done, optional open |
| `shop-product-delivery-linking-fix` (bugfix) | Paid shop orders were orphaned when target day paused/ended → roll-forward, retarget on pause, late-link snapshot refresh, franchise oversell flag. | 11 / 0 | Finished |
| `admin-place-shop-order-for-customer` | Assisted (staff-placed) shop orders incl. walk-in via one RPC. | 22 / 17 (17) | Done, optional open |
| `customer-mobile-onboarding` | Mobile-first, admin-initiated onboarding; placeholder emails; eligibility rule "exactly one allowed record"; OTP login (later replaced). Why: clinic customers often have no email. | 64 / 0 | Finished |
| `customer-pin-auth` | Replace SMS OTP with 6-digit PIN + throttle; session via shared server password. Why: SMS cost and reliability. | 38 / 0 | Finished (OTP left unmounted) |
| `mandatory-profile-completion-popup` | First-login popup with medical confirmation/documents, different by category. | 20 / 0 | Finished |
| `customer-portal-data-optimization` | Cut 4–6 sequential auth/data calls per navigation: identity headers from middleware, React `cache()`, synchronous shell + loader. | 44 / 29 (27) | 2 required checkpoints open (latency measurement, final test run) |
| `delivery-charges-management` | Distance-based delivery charge per clinic added to Total_Payable; server recomputes and rejects mismatches. | 32 / 16 (16) | Done, optional open |
| `onboarding-past-date-flexibility` | Allow backdated onboarding start dates within rules. | 30 / 0 | Finished |
| `new-plan-past-date-start` | Allow a new plan to start in the past (related rules). | 15 / 10 (9) | 1 required (tests) open |
| `kit-subscription-management` | Separate KIT category for one-time kits. | 57 / 0 | Finished |
| `kit-subscription` | KIT tracker details (received date, daily logs, skipped days). | 28 / 10 (9) | 1 required (property tests) open |
| `kit-lifecycle-management` | Multiple KITs per lifetime, expiry cron, history, new kit eligibility. | 50 / 0 | Finished |
| `accommodation-customer-flow` | ACCOMMODATION fields, lifecycle, health logs, customer dashboards. | 38 / 17 (11) | Checklist shows admin tab tasks open; code exists (stale checklist) |
| `accommodation-payment-lifecycle` | Stay payment ledger, extensions, recalculation, invoices, refunds (138 KB design). | 107 / 25 (25) | Done, optional open |
| `dietitian-management` | Dietitian as an access level, assignment, cadence engine, health logs, RLS helper functions. | 108 / 0 | Finished |
| `report-card-lifecycle` | Report cards as entities per subscription/stay, finalise/reopen, retrospective exemption, editability view. | 50 / 6 (2) | **Open**: Final report + PDF export, close remaining gaps, DB-level verification, final verification |
| `master-inventory-management` | Move product CRUD from admin to master; admin keeps operations. | 47 / 0 | Finished |
| `android-background-gps-tracking` | Foreground started service, durable queue, native upload, duty lifecycle, auto off-duty. | 48 / 11 (11) | Done; pilot status per steering doc |
| `app-apk-distribution` | QR landing + Turnstile + rate limit + signed URLs (no Play Store account). | 40 / 30 (16) | **Open**: operator tasks (bucket, uploads, Turnstile keys, base URL) and E2E device verification; pages/route exist in code |
| `vercel-cron-automations` | Harden cron routes (secret required); scheduling ended up in pg_cron. | 12 / 6 (6) | Done, optional open |

## 4. Recurring design principles across specs
1. **Additive and flag-gated** changes (new nullable columns, policies created but not enabled, `FRANCHISE_FEATURES_ENABLED`).
2. **Atomic writes in SQL functions** for anything multi-row.
3. **Pure helpers + property tests** for every business rule.
4. **Defense in depth**: middleware + layout + action + DB.
5. **Never trust client ids** for tenant or owner.
6. **Requirement IDs in comments** for traceability.

## 5. Unfinished work Ravi should know about
- Report card final report/PDF and verification (`report-card-lifecycle` tasks 4, 6, 7, 8).
- APK distribution operator steps and device verification (`app-apk-distribution` tasks 4, 5, 14).
- Customer portal latency checkpoint (`customer-portal-data-optimization` 21–22).
- Several optional property-test tasks across specs.
- Items from code review in `16-known-issues-and-tech-debt.md` (not tracked in any spec).
