-- ============================================================================
-- FRANCHISE HIERARCHY RLS POLICIES — (Creates policies, does NOT enable RLS)
-- ============================================================================
-- Spec: multi-tenant-franchise — Task 1.8
-- Requirements: 7.5, 9.2, 9.3, 10.1, 10.7, 18.7
--
-- IMPORTANT: This script CREATES policies only. Policies are created IDLE —
-- RLS is NOT enabled here. Each policy sits dormant until RLS is turned on for
-- its table via a SEPARATE later script (enable-franchise-hierarchy-rls.sql).
-- Until then these policies have no effect on query results.
--
-- DEPENDENCY: This script REUSES the helper functions is_global_role() and
-- current_franchise_id() defined in create-franchise-rls-policies.sql. That
-- script MUST run FIRST. The helpers are intentionally NOT redefined here.
--
-- Shared tenant predicate (byte-identical in spirit to the reference file):
--   is_global_role()
--   OR franchise_id = current_franchise_id()
--   OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
--
-- Policy Logic (same model as create-franchise-rls-policies.sql):
--   ADMIN / MASTER_ADMIN → see ALL rows (core + all franchises)
--   FRANCHISE_ADMIN      → see only rows where franchise_id = their franchise_id
--   core users           → see only rows where franchise_id IS NULL
--
-- Session variables required (set by application code via set_franchise_context):
--   app.role         — user's role code (ADMIN, MASTER_ADMIN, FRANCHISE_ADMIN, ...)
--   app.franchise_id — user's franchise_id (empty string or UUID)
--
-- Idempotency: every policy uses DROP POLICY IF EXISTS then CREATE POLICY so the
-- script is safely re-runnable (matching the reference file's pattern).
--
-- Rollback: Run the matching disable/enable script to turn RLS off, then DROP
-- each policy manually.
-- ============================================================================


-- ============================================================================
-- 1. FRANCHISE WAREHOUSE TABLES — full 4-policy tenant isolation
--    Tables: franchise_warehouses, franchise_warehouse_stock
--    Keyed on their own franchise_id column. (Req 9.2, 9.3, 18.7, 19.6)
--    INSERT WITH CHECK enforces the row's franchise_id = current_franchise_id()
--    for franchise users, allows global roles, and allows NULL-for-core.
-- ============================================================================

-- ─── franchise_warehouses ──────────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_franchise_warehouses ON public.franchise_warehouses;
CREATE POLICY franchise_select_franchise_warehouses ON public.franchise_warehouses
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_franchise_warehouses ON public.franchise_warehouses;
CREATE POLICY franchise_insert_franchise_warehouses ON public.franchise_warehouses
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_franchise_warehouses ON public.franchise_warehouses;
CREATE POLICY franchise_update_franchise_warehouses ON public.franchise_warehouses
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_delete_franchise_warehouses ON public.franchise_warehouses;
CREATE POLICY franchise_delete_franchise_warehouses ON public.franchise_warehouses
  FOR DELETE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

-- ─── franchise_warehouse_stock ─────────────────────────────────────────────

DROP POLICY IF EXISTS franchise_select_franchise_warehouse_stock ON public.franchise_warehouse_stock;
CREATE POLICY franchise_select_franchise_warehouse_stock ON public.franchise_warehouse_stock
  FOR SELECT USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_franchise_warehouse_stock ON public.franchise_warehouse_stock;
CREATE POLICY franchise_insert_franchise_warehouse_stock ON public.franchise_warehouse_stock
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_franchise_warehouse_stock ON public.franchise_warehouse_stock;
CREATE POLICY franchise_update_franchise_warehouse_stock ON public.franchise_warehouse_stock
  FOR UPDATE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_delete_franchise_warehouse_stock ON public.franchise_warehouse_stock;
CREATE POLICY franchise_delete_franchise_warehouse_stock ON public.franchise_warehouse_stock
  FOR DELETE USING (
    is_global_role()
    OR (franchise_id = current_franchise_id())
    OR (franchise_id IS NULL AND current_franchise_id() IS NULL)
  );


-- ============================================================================
-- 2. STOCK_TRANSFERS — full 4-policy set keyed on dest_franchise_id.
--    SELECT also matches source_franchise_id = current_franchise_id() so a
--    SOURCE franchise can see its OUTBOUND transfers. (Req 18.7, 19.5)
-- ============================================================================

DROP POLICY IF EXISTS franchise_select_stock_transfers ON public.stock_transfers;
CREATE POLICY franchise_select_stock_transfers ON public.stock_transfers
  FOR SELECT USING (
    is_global_role()
    OR (dest_franchise_id = current_franchise_id())
    OR (source_franchise_id = current_franchise_id())
    OR (dest_franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_insert_stock_transfers ON public.stock_transfers;
CREATE POLICY franchise_insert_stock_transfers ON public.stock_transfers
  FOR INSERT WITH CHECK (
    is_global_role()
    OR (dest_franchise_id = current_franchise_id())
    OR (dest_franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_update_stock_transfers ON public.stock_transfers;
CREATE POLICY franchise_update_stock_transfers ON public.stock_transfers
  FOR UPDATE USING (
    is_global_role()
    OR (dest_franchise_id = current_franchise_id())
    OR (dest_franchise_id IS NULL AND current_franchise_id() IS NULL)
  );

DROP POLICY IF EXISTS franchise_delete_stock_transfers ON public.stock_transfers;
CREATE POLICY franchise_delete_stock_transfers ON public.stock_transfers
  FOR DELETE USING (
    is_global_role()
    OR (dest_franchise_id = current_franchise_id())
    OR (dest_franchise_id IS NULL AND current_franchise_id() IS NULL)
  );


-- ============================================================================
-- 3. FRANCHISE_AGREEMENT_DOCUMENTS — read vs. write split (Req 7.5)
--    READ  (SELECT): a franchise may read its own documents; global roles read all.
--    WRITE (INSERT/UPDATE/DELETE): is_global_role() ONLY — Master uploads/manages
--    agreement documents; franchises cannot create/modify/delete them.
-- ============================================================================

DROP POLICY IF EXISTS franchise_select_franchise_agreement_documents ON public.franchise_agreement_documents;
CREATE POLICY franchise_select_franchise_agreement_documents ON public.franchise_agreement_documents
  FOR SELECT USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_insert_franchise_agreement_documents ON public.franchise_agreement_documents;
CREATE POLICY franchise_insert_franchise_agreement_documents ON public.franchise_agreement_documents
  FOR INSERT WITH CHECK (
    is_global_role()
  );

DROP POLICY IF EXISTS franchise_update_franchise_agreement_documents ON public.franchise_agreement_documents;
CREATE POLICY franchise_update_franchise_agreement_documents ON public.franchise_agreement_documents
  FOR UPDATE USING (
    is_global_role()
  );

DROP POLICY IF EXISTS franchise_delete_franchise_agreement_documents ON public.franchise_agreement_documents;
CREATE POLICY franchise_delete_franchise_agreement_documents ON public.franchise_agreement_documents
  FOR DELETE USING (
    is_global_role()
  );


-- ============================================================================
-- 4. STRUCTURE TABLES — readable by everyone, writable by global roles only.
--    (Req 10.1, 10.7) Mirrors how core-clinic treats businesses/cities/clinics:
--    structure is public to read, but only ADMIN/MASTER_ADMIN may mutate it.
--    Tables: groups (full set here); cities and franchises receive write-guard
--    policies under DISTINCT names to avoid duplicating any policies already
--    created in create-franchise-rls-policies.sql.
-- ============================================================================

-- ─── groups ────────────────────────────────────────────────────────────────
-- Everyone may read the structure; only global roles may write.

DROP POLICY IF EXISTS franchise_select_groups ON public.groups;
CREATE POLICY franchise_select_groups ON public.groups
  FOR SELECT USING (true);

DROP POLICY IF EXISTS franchise_insert_groups ON public.groups;
CREATE POLICY franchise_insert_groups ON public.groups
  FOR INSERT WITH CHECK (is_global_role());

DROP POLICY IF EXISTS franchise_update_groups ON public.groups;
CREATE POLICY franchise_update_groups ON public.groups
  FOR UPDATE USING (is_global_role());

DROP POLICY IF EXISTS franchise_delete_groups ON public.groups;
CREATE POLICY franchise_delete_groups ON public.groups
  FOR DELETE USING (is_global_role());

-- ─── cities (write-guard) ──────────────────────────────────────────────────
-- NOTE: cities is a structure table that everyone may read but only global
-- roles may mutate. These policies use the DISTINCT `_hierarchy_` name prefix
-- and are guarded with DROP POLICY IF EXISTS so they do NOT collide with any
-- city policies that may be created in create-franchise-rls-policies.sql.

DROP POLICY IF EXISTS franchise_hierarchy_select_cities ON public.cities;
CREATE POLICY franchise_hierarchy_select_cities ON public.cities
  FOR SELECT USING (true);

DROP POLICY IF EXISTS franchise_hierarchy_insert_cities ON public.cities;
CREATE POLICY franchise_hierarchy_insert_cities ON public.cities
  FOR INSERT WITH CHECK (is_global_role());

DROP POLICY IF EXISTS franchise_hierarchy_update_cities ON public.cities;
CREATE POLICY franchise_hierarchy_update_cities ON public.cities
  FOR UPDATE USING (is_global_role());

DROP POLICY IF EXISTS franchise_hierarchy_delete_cities ON public.cities;
CREATE POLICY franchise_hierarchy_delete_cities ON public.cities
  FOR DELETE USING (is_global_role());

-- ─── franchises (write-guard) ──────────────────────────────────────────────
-- NOTE: franchises is a structure table that everyone may read but only global
-- roles may mutate. These policies use the DISTINCT `_hierarchy_` name prefix
-- and are guarded with DROP POLICY IF EXISTS so they do NOT collide with any
-- franchise policies that may be created in create-franchise-rls-policies.sql.

DROP POLICY IF EXISTS franchise_hierarchy_select_franchises ON public.franchises;
CREATE POLICY franchise_hierarchy_select_franchises ON public.franchises
  FOR SELECT USING (true);

DROP POLICY IF EXISTS franchise_hierarchy_insert_franchises ON public.franchises;
CREATE POLICY franchise_hierarchy_insert_franchises ON public.franchises
  FOR INSERT WITH CHECK (is_global_role());

DROP POLICY IF EXISTS franchise_hierarchy_update_franchises ON public.franchises;
CREATE POLICY franchise_hierarchy_update_franchises ON public.franchises
  FOR UPDATE USING (is_global_role());

DROP POLICY IF EXISTS franchise_hierarchy_delete_franchises ON public.franchises;
CREATE POLICY franchise_hierarchy_delete_franchises ON public.franchises
  FOR DELETE USING (is_global_role());


-- ============================================================================
-- DONE. All policies above are created IDLE. RLS is NOT enabled by this script.
-- Enable RLS per-table later via the separate enable-franchise-hierarchy-rls.sql
-- script. The is_global_role() / current_franchise_id() helpers are reused from
-- create-franchise-rls-policies.sql, which MUST run before this script.
-- ============================================================================
