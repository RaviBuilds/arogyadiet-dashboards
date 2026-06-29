-- ============================================================================
-- ENABLE FRANCHISE HIERARCHY RLS — Companion to enable-franchise-rls.sql
-- ============================================================================
-- Spec: multi-tenant-franchise — Task 15.1
-- Requirements: 10.7, 18.7, 20.8
--
-- PRODUCTION SAFETY: ENABLE LAST. This script turns ON Row Level Security for
-- the franchise-HIERARCHY tables. Run it ONLY after every prerequisite below is
-- deployed and verified. Enabling RLS before policies/context exist will hide
-- rows from the application and can cause an outage. Run ONE TABLE AT A TIME.
-- After each ALTER, verify an ADMIN session can still query the table. If
-- anything breaks: immediately run disable-franchise-hierarchy-rls.sql.
--
-- PREREQUISITES (all must be true before running):
--   1. create-franchise-rls-policies.sql applied — defines the helper functions
--      is_global_role() and current_franchise_id() AND the base franchise
--      policies. MUST run first.
--   2. create-franchise-hierarchy-rls-policies.sql applied — creates the IDLE
--      hierarchy policies for the tables enabled below. MUST run before this.
--   3. enable-franchise-rls.sql already applied for the base franchise-scoped
--      tables (this script is its companion, not a replacement).
--   4. Application code deployed with the franchise Scope binding /
--      set_franchise_context session context — and verified working.
--   5. Feature flag tested in staging for 24+ hours.
--
-- This script is run MANUALLY by the operator, step by step — it is not part of
-- an automated migration run.
--
-- Idempotency: ALTER TABLE ... ENABLE ROW LEVEL SECURITY is a no-op when RLS is
-- already enabled, so every step below is safe to re-run.
-- ============================================================================

-- Pre-check: Verify session context + helpers are working before enabling.
-- Run these first to confirm the RPC + helpers resolve:
-- SELECT set_franchise_context('ADMIN', '');
-- SELECT current_setting('app.role', true);  -- Should return 'ADMIN'
-- SELECT is_global_role();                    -- Should return true

-- ─── Enable RLS table by table ─────────────────────────────────────────────

-- Step 1 — groups (structure table; readable by all, writable by global roles)
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
-- VERIFY: SELECT count(*) FROM groups; (ADMIN should still see all rows)

-- Step 2 — franchise_agreement_documents (read: own franchise + global; write: global only)
ALTER TABLE public.franchise_agreement_documents ENABLE ROW LEVEL SECURITY;
-- VERIFY: SELECT count(*) FROM franchise_agreement_documents; (ADMIN sees all)

-- Step 3 — franchise_warehouses (tenant-isolated on franchise_id)
ALTER TABLE public.franchise_warehouses ENABLE ROW LEVEL SECURITY;
-- VERIFY: SELECT count(*) FROM franchise_warehouses; (ADMIN sees all)

-- Step 4 — franchise_warehouse_stock (tenant-isolated on franchise_id)
ALTER TABLE public.franchise_warehouse_stock ENABLE ROW LEVEL SECURITY;
-- VERIFY: SELECT count(*) FROM franchise_warehouse_stock; (ADMIN sees all)

-- Step 5 — stock_transfers (tenant-isolated on dest/source franchise_id)
ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
-- VERIFY: SELECT count(*) FROM stock_transfers; (ADMIN sees all)

-- ─── Structure tables NOT already enabled by enable-franchise-rls.sql ───────
-- NOTE: enable-franchise-rls.sql does NOT enable RLS on cities or franchises,
-- so they are enabled HERE (their write-guard policies live in
-- create-franchise-hierarchy-rls-policies.sql). If a future revision of
-- enable-franchise-rls.sql starts enabling either table, REMOVE the matching
-- step below to avoid duplicating the base script. (ENABLE is idempotent, so
-- a duplicate is harmless, but keep ownership in exactly one script.)

-- Step 6 — cities (structure table; readable by all, writable by global roles)
ALTER TABLE public.cities ENABLE ROW LEVEL SECURITY;
-- VERIFY: SELECT count(*) FROM cities; (ADMIN sees all)

-- Step 7 — franchises (structure table; readable by all, writable by global roles)
ALTER TABLE public.franchises ENABLE ROW LEVEL SECURITY;
-- VERIFY: SELECT count(*) FROM franchises; (ADMIN sees all)

-- ============================================================================
-- POST-ENABLEMENT SMOKE TEST (run after all tables are enabled):
--
-- As admin (service role):
--   SELECT set_franchise_context('ADMIN', '');
--   SELECT count(*) FROM groups;                          -- Should see ALL
--   SELECT count(*) FROM franchise_warehouses;            -- Should see ALL
--   SELECT count(*) FROM stock_transfers;                 -- Should see ALL
--
-- As franchise admin:
--   SELECT set_franchise_context('FRANCHISE_ADMIN', '<franchise-uuid>');
--   SELECT count(*) FROM franchise_warehouses;            -- Only their franchise
--   SELECT count(*) FROM franchise_agreement_documents;   -- Only their docs
--   SELECT count(*) FROM stock_transfers;                 -- Inbound + outbound for them
--
-- As core user:
--   SELECT set_franchise_context('RIDER', '');
--   SELECT count(*) FROM franchise_warehouses;            -- Only NULL franchise_id
-- ============================================================================
