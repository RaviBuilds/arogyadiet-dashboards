-- ============================================================================
-- ROLLBACK: DISABLE FRANCHISE HIERARCHY RLS — Emergency recovery script
-- ============================================================================
-- Spec: multi-tenant-franchise — Task 15.1
-- Requirements: 10.7, 18.7, 20.8
--
-- This is the EMERGENCY ROLLBACK for enable-franchise-hierarchy-rls.sql.
-- It IMMEDIATELY disables RLS on every franchise-hierarchy table that the
-- enable script turns on. With RLS off, all queries return all rows again
-- (pre-RLS behavior) regardless of session context. The idle policies remain
-- defined but have no effect once RLS is disabled.
--
-- Safe to run at any time — instant recovery. Run this if anything breaks after
-- enablement. It does NOT touch the base tables handled by
-- disable-franchise-rls.sql.
--
-- Idempotency: ALTER TABLE ... DISABLE ROW LEVEL SECURITY is a no-op when RLS is
-- already disabled, so this script is safe to re-run.
--
-- Order: reverse of the enable script — structure tables first (cities,
-- franchises), then the tenant-isolated tables, ending with groups.
-- ============================================================================

-- Structure tables enabled by the hierarchy script (NOT by enable-franchise-rls.sql)
ALTER TABLE public.franchises DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.cities DISABLE ROW LEVEL SECURITY;

-- Tenant-isolated + structure tables from the hierarchy enable script
ALTER TABLE public.stock_transfers DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.franchise_warehouse_stock DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.franchise_warehouses DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.franchise_agreement_documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups DISABLE ROW LEVEL SECURITY;

-- Verify: all tables should now be accessible without session context
-- SELECT count(*) FROM groups;             -- Should work without set_franchise_context
-- SELECT count(*) FROM stock_transfers;    -- Should work without set_franchise_context
-- ============================================================================
