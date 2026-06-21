---
inclusion: manual
---

# Franchise Model Execution Plan

## Production Safety Strategy

The franchise model is being implemented on a LIVE production system (Hyderabad core operation). Every change must be additive-only and backward-compatible. The existing `admin.arogyadiet.com` must continue working unchanged throughout implementation.

### Core Principles

1. **Additive-only database changes** — All new columns are `DEFAULT NULL`. No `NOT NULL` constraints on `franchise_id`. Existing rows keep NULL = core operation.
2. **No existing code modifications required for production to keep running** — All new functionality lives in new files/routes.
3. **Feature flag controlled** — `FRANCHISE_FEATURES_ENABLED` environment variable gates all franchise behavior.
4. **RLS is the last thing enabled** — Only after all application code is deployed and tested.
5. **Franchise portal has zero impact until DNS is configured** — `franchies.arogyadiet.com` is entirely new.

---

## Phase 1 — SAFE: Database Schema (Deploy anytime)

**Risk:** ✅ NONE — New tables + nullable columns only

**What gets deployed:**
- New `franchises` table (id, name, status, kitchen_id, owner_user_id)
- New `franchise_pincodes` table (franchise_id, pincode with UNIQUE constraint)
- `franchise_id UUID DEFAULT NULL` added to all tenant-isolated tables
- `franchise_id UUID DEFAULT NULL` added to `users` table
- Indexes on `franchise_id` columns

**Why it's safe:**
- New tables don't affect existing queries
- Nullable columns with DEFAULT NULL mean existing rows are unchanged
- Existing INSERT statements continue to work (new column defaults to NULL)
- No foreign key enforcement that blocks existing operations

**Rollback:** DROP new tables, DROP new columns

---

## Phase 2 — SAFE: Application Code (Deploy anytime)

**Risk:** ✅ NONE — New files only, no existing code modified

**What gets deployed:**
- `src/types/franchise.ts` — TypeScript interfaces
- `src/validations/franchiseSchemas.ts` — Zod validation schemas
- `src/lib/franchise/context.ts` — Session context resolver
- `src/lib/franchise/constants.ts` — Feature flag, core pincodes
- `src/lib/franchise/stamping.ts` — Data stamping utility
- `src/lib/franchise/assignment-resolver.ts` — Pincode resolver
- `src/lib/franchise/queries.ts` — Franchise-aware query helpers
- `src/lib/franchise/routing.ts` — Franchise-scoped routing logic
- `src/actions/admin-actions/franchiseActions.ts` — CRUD + lifecycle
- `src/actions/admin-actions/franchisePincodeActions.ts` — Pincode management
- `src/app/master/franchises/` — Master portal franchise management UI
- `src/shared/components/franchise/` — Franchise-scoped operational components
- `src/shared/components/admin/FranchiseOversight.tsx` — Admin oversight section
- `src/shared/components/master/FranchiseNetworkOverview.tsx` — Consolidated metrics
- `src/shared/components/shared/RBACGate.tsx` — Role-based rendering
- `src/shared/hooks/useFranchiseScope.ts` — Scope hook

**Why it's safe:**
- All new files — nothing existing is imported from them yet
- New master portal pages don't affect existing admin/customer/rider portals
- Admin oversight is an additive section, not a modification of existing pages

**Rollback:** Delete new files

---

## Phase 3 — CONTROLLED RISK: Middleware (Deploy with testing)

**Risk:** ⚠️ LOW-MEDIUM — Modifies `src/middleware.ts` but only adds new conditions

**What gets deployed:**
- Add `franchies` to portals mapping in middleware
- Add FRANCHISE_ADMIN cross-portal prevention (redirect to franchies portal)
- Add franchise session context injection after auth

**Why it's controlled:**
- Only ADDS new conditions to existing if/else chains
- Existing admin/customer/rider/master routing logic untouched
- If feature flag is OFF, franchise middleware logic is skipped entirely

**Testing before deploy:**
- Verify `admin.arogyadiet.com` works for ADMIN users
- Verify `master.arogyadiet.com` works for MASTER_ADMIN users
- Verify customer and rider portals are unaffected

**Rollback:** Revert `src/middleware.ts` to previous version (single file)

---

## Phase 4 — HIGHEST RISK: RLS Enablement (Deploy LAST)

**Risk:** 🔴 HIGH — Enabling RLS can break all queries if session context isn't set correctly

**What gets deployed:**
- `scripts/create-franchise-rls-policies.sql` — Creates policies (but doesn't enable)
- Supabase client modifications to set `app.franchise_id` and `app.role` session variables
- `scripts/enable-franchise-rls.sql` — Enables RLS table by table
- `scripts/disable-franchise-rls.sql` — Rollback script

**Deploy order within this phase:**
1. Deploy Supabase client changes (with feature flag OFF) — no impact
2. Turn feature flag ON in staging — test thoroughly
3. Run `create-franchise-rls-policies.sql` in production — no impact (policies exist but RLS not enabled)
4. Turn feature flag ON in production — session vars now set but RLS not yet enforcing
5. Run `enable-franchise-rls.sql` ONE TABLE AT A TIME — verify after each table
6. If anything breaks → immediately run `disable-franchise-rls.sql`

**Pre-enablement checklist:**
- [ ] All application code deployed and running
- [ ] Feature flag tested ON in staging for 24+ hours
- [ ] Session context (`app.franchise_id`, `app.role`) confirmed working via Supabase logs
- [ ] Rollback script tested in staging
- [ ] Run during LOW TRAFFIC period

**Rollback:** Run `scripts/disable-franchise-rls.sql` (instant recovery)

---

## Phase 5 — SAFE: Franchise Portal (Zero impact until DNS)

**Risk:** ✅ NONE — Entirely new subdomain, not accessible until DNS configured

**What gets deployed:**
- `src/app/franchise/` — Complete portal directory
- Pages: dashboard, customers, riders, inventory, orders, reports, profile
- `vercel.json` domain configuration update

**Why it's safe:**
- New route group that no existing user can reach
- DNS for `franchies.arogyadiet.com` not configured until everything is tested
- Even after code deploy, portal is unreachable without DNS

**Final activation:** Configure DNS for `franchies.arogyadiet.com` → Vercel

---

## Deploy Order (CRITICAL)

```
Step 1: Run Phase 1 SQL scripts (add tables + columns)
   ↓
Step 2: Deploy Phase 2 code (new files only)
   ↓
Step 3: Deploy Phase 3 middleware changes
   ↓
Step 4: TEST - Verify admin.arogyadiet.com still works perfectly
   ↓
Step 5: Deploy Phase 4 Supabase client changes (feature flag OFF)
   ↓
Step 6: Enable feature flag in STAGING → test for 24h
   ↓
Step 7: Enable feature flag in PRODUCTION
   ↓
Step 8: Run RLS policy creation script (doesn't enforce yet)
   ↓
Step 9: Run RLS enablement script ONE TABLE AT A TIME (have rollback ready)
   ↓
Step 10: Deploy Phase 5 franchise portal code
   ↓
Step 11: Configure DNS for franchies.arogyadiet.com (final go-live)
```

---

## Feature Flag Strategy

Environment variable: `FRANCHISE_FEATURES_ENABLED`

| Value | Behavior |
|-------|----------|
| `false` (default) | All existing behavior preserved. Middleware skips franchise logic. Supabase clients don't set session vars. |
| `true` | Franchise routing active. Session context injected. RLS policies enforced (if enabled). |

**Gradual rollout:**
1. Keep OFF during Phases 1-3
2. Turn ON in staging during Phase 4 testing
3. Turn ON in production only when ready for RLS
4. Can be turned OFF instantly if issues arise (RLS still needs separate rollback)

---

## Architecture Decision: Core ≠ Franchise

The Hyderabad core operation is NOT a franchise. It is the parent/base.

| | Core Operation | New Franchises |
|---|---|---|
| `franchise_id` | NULL (unchanged) | Non-null UUID |
| Dashboard | `admin.arogyadiet.com` (unchanged) | `franchies.arogyadiet.com` |
| Data access | No filtering needed | RLS-scoped |
| In `franchises` table? | NO | YES |
| Migration needed? | NO | N/A (new data) |
| Routing | Runs as today (no franchise_id filter) | Scoped per franchise |

---

## RLS Policy Logic Summary

```sql
-- Franchise user: sees only their own franchise data
-- Core user (RIDER/CUSTOMER with NULL franchise_id): sees only core records
-- ADMIN/MASTER_ADMIN: sees everything (core + all franchises)

SELECT policy:
  CASE
    WHEN role IN ('ADMIN', 'MASTER_ADMIN') THEN true  -- see all
    WHEN role = 'FRANCHISE_ADMIN' THEN record.franchise_id = session.franchise_id
    ELSE record.franchise_id IS NULL  -- core users see core records only
  END

INSERT policy:
  CASE
    WHEN role = 'FRANCHISE_ADMIN' THEN new.franchise_id = session.franchise_id
    WHEN role IN ('ADMIN', 'MASTER_ADMIN') THEN true  -- can create for any/core
    ELSE new.franchise_id IS NULL  -- core users create core records
  END
```

---

## Checkpoints

| After Phase | Verify |
|-------------|--------|
| Phase 1 | SQL scripts reviewed, all columns DEFAULT NULL, no NOT NULL |
| Phase 2 | New files compile, no existing imports broken |
| Phase 3 | All existing portals work unchanged, franchise routing works |
| Phase 4 | RLS tested in staging 24h, rollback script tested, admin still works |
| Phase 5 | Franchise portal functional, DNS ready to configure |
| Go-live | End-to-end: admin unchanged, franchise isolated, core untouched |
