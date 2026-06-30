-- ============================================================================
-- FRANCHISE INVENTORY RLS POLICIES
-- ============================================================================
--
-- Enables RLS and creates policies for the franchise inventory tables:
--   - franchise_inventories
--   - franchise_inventory_lots
--   - franchise_stock_transfers (RLS column: dest_franchise_id)
--   - franchise_stock_transfer_lines
--   - franchise_inventory_ledger
--
-- Policy Logic:
--   ADMIN / MASTER_ADMIN (global role) → see ALL rows
--   FRANCHISE_ADMIN → see only rows matching their franchise_id
--
-- These tables are franchise-only (no NULL franchise_id rows), so the
-- "franchise_id IS NULL AND current_franchise_id() IS NULL" fallback
-- used by shared tables is not needed here.
--
-- Depends on: is_global_role() and current_franchise_id() helper functions
-- from create-franchise-rls-policies.sql
--
-- Requirements validated: 2.6, 11.3, 11.6, 13.5
-- ============================================================================

-- ─── franchise_inventories ─────────────────────────────────────────────────

ALTER TABLE public.franchise_inventories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS franchise_select_franchise_inventories ON public.franchise_inventories;
CREATE POLICY franchise_select_franchise_inventories ON public.franchise_inventories
  FOR SELECT USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_insert_franchise_inventories ON public.franchise_inventories;
CREATE POLICY franchise_insert_franchise_inventories ON public.franchise_inventories
  FOR INSERT WITH CHECK (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_update_franchise_inventories ON public.franchise_inventories;
CREATE POLICY franchise_update_franchise_inventories ON public.franchise_inventories
  FOR UPDATE USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_delete_franchise_inventories ON public.franchise_inventories;
CREATE POLICY franchise_delete_franchise_inventories ON public.franchise_inventories
  FOR DELETE USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

-- ─── franchise_inventory_lots ──────────────────────────────────────────────

ALTER TABLE public.franchise_inventory_lots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS franchise_select_franchise_inventory_lots ON public.franchise_inventory_lots;
CREATE POLICY franchise_select_franchise_inventory_lots ON public.franchise_inventory_lots
  FOR SELECT USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_insert_franchise_inventory_lots ON public.franchise_inventory_lots;
CREATE POLICY franchise_insert_franchise_inventory_lots ON public.franchise_inventory_lots
  FOR INSERT WITH CHECK (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_update_franchise_inventory_lots ON public.franchise_inventory_lots;
CREATE POLICY franchise_update_franchise_inventory_lots ON public.franchise_inventory_lots
  FOR UPDATE USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_delete_franchise_inventory_lots ON public.franchise_inventory_lots;
CREATE POLICY franchise_delete_franchise_inventory_lots ON public.franchise_inventory_lots
  FOR DELETE USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

-- ─── franchise_stock_transfers (RLS column: dest_franchise_id) ──────────────

ALTER TABLE public.franchise_stock_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS franchise_select_franchise_stock_transfers ON public.franchise_stock_transfers;
CREATE POLICY franchise_select_franchise_stock_transfers ON public.franchise_stock_transfers
  FOR SELECT USING (
    is_global_role()
    OR dest_franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_insert_franchise_stock_transfers ON public.franchise_stock_transfers;
CREATE POLICY franchise_insert_franchise_stock_transfers ON public.franchise_stock_transfers
  FOR INSERT WITH CHECK (
    is_global_role()
    OR dest_franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_update_franchise_stock_transfers ON public.franchise_stock_transfers;
CREATE POLICY franchise_update_franchise_stock_transfers ON public.franchise_stock_transfers
  FOR UPDATE USING (
    is_global_role()
    OR dest_franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_delete_franchise_stock_transfers ON public.franchise_stock_transfers;
CREATE POLICY franchise_delete_franchise_stock_transfers ON public.franchise_stock_transfers
  FOR DELETE USING (
    is_global_role()
    OR dest_franchise_id = current_franchise_id()
  );

-- ─── franchise_stock_transfer_lines ────────────────────────────────────────

ALTER TABLE public.franchise_stock_transfer_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS franchise_select_franchise_stock_transfer_lines ON public.franchise_stock_transfer_lines;
CREATE POLICY franchise_select_franchise_stock_transfer_lines ON public.franchise_stock_transfer_lines
  FOR SELECT USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_insert_franchise_stock_transfer_lines ON public.franchise_stock_transfer_lines;
CREATE POLICY franchise_insert_franchise_stock_transfer_lines ON public.franchise_stock_transfer_lines
  FOR INSERT WITH CHECK (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_update_franchise_stock_transfer_lines ON public.franchise_stock_transfer_lines;
CREATE POLICY franchise_update_franchise_stock_transfer_lines ON public.franchise_stock_transfer_lines
  FOR UPDATE USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_delete_franchise_stock_transfer_lines ON public.franchise_stock_transfer_lines;
CREATE POLICY franchise_delete_franchise_stock_transfer_lines ON public.franchise_stock_transfer_lines
  FOR DELETE USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

-- ─── franchise_inventory_ledger ────────────────────────────────────────────

ALTER TABLE public.franchise_inventory_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS franchise_select_franchise_inventory_ledger ON public.franchise_inventory_ledger;
CREATE POLICY franchise_select_franchise_inventory_ledger ON public.franchise_inventory_ledger
  FOR SELECT USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_insert_franchise_inventory_ledger ON public.franchise_inventory_ledger;
CREATE POLICY franchise_insert_franchise_inventory_ledger ON public.franchise_inventory_ledger
  FOR INSERT WITH CHECK (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_update_franchise_inventory_ledger ON public.franchise_inventory_ledger;
CREATE POLICY franchise_update_franchise_inventory_ledger ON public.franchise_inventory_ledger
  FOR UPDATE USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

DROP POLICY IF EXISTS franchise_delete_franchise_inventory_ledger ON public.franchise_inventory_ledger;
CREATE POLICY franchise_delete_franchise_inventory_ledger ON public.franchise_inventory_ledger
  FOR DELETE USING (
    is_global_role()
    OR franchise_id = current_franchise_id()
  );

-- ============================================================================
-- POST-ENABLEMENT SMOKE TEST:
--
-- As admin (service role):
--   SELECT set_franchise_context('ADMIN', '');
--   SELECT count(*) FROM franchise_inventories;          -- Should see ALL
--   SELECT count(*) FROM franchise_inventory_lots;       -- Should see ALL
--   SELECT count(*) FROM franchise_stock_transfers;      -- Should see ALL
--   SELECT count(*) FROM franchise_stock_transfer_lines; -- Should see ALL
--   SELECT count(*) FROM franchise_inventory_ledger;     -- Should see ALL
--
-- As franchise admin:
--   SELECT set_franchise_context('FRANCHISE_ADMIN', '<franchise-uuid>');
--   SELECT count(*) FROM franchise_inventories;          -- Should see only own
--   SELECT count(*) FROM franchise_inventory_lots;       -- Should see only own
--   SELECT count(*) FROM franchise_stock_transfers;      -- Should see only own (dest)
--   SELECT count(*) FROM franchise_stock_transfer_lines; -- Should see only own
--   SELECT count(*) FROM franchise_inventory_ledger;     -- Should see only own
-- ============================================================================
