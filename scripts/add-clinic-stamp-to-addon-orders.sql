-- ============================================================================
-- CLINIC-SCOPED SHOP INVENTORY — Order_Clinic_Stamp on Shop Orders
-- (SAFE: Additive only)
-- ============================================================================
-- Adds the Order_Clinic_Stamp to public.addon_orders: the Core_Clinic whose
-- Clinic_Shop_Stock fulfilled the Shop_Order, recorded at creation time and
-- immutable thereafter. The stamp is the authoritative attribution for the
-- clinic-scoped Shop_Orders_Page and for every OUT Clinic_Shop_Ledger entry.
--
-- Requirements: 10.1 (persist a nullable Order_Clinic_Stamp referencing an
-- existing Core_Clinic, recorded at creation time), 10.12 (treat the stamp as
-- immutable after creation, rejecting any request to change it), 12.6 (unstamped
-- orders form the `Unassigned` grouping).
--
-- Adds (nullable, NULL = unstamped, zero production impact):
--   - addon_orders.clinic_id — the Core_Clinic that fulfilled the order. NULL
--       for franchise orders (attributed via addon_orders.franchise_id) and for
--       every pre-existing row, which is exactly the `Unassigned` grouping
--       Requirement 12.6 describes.
--
-- Adds indexes:
--   - idx_addon_orders_clinic ON addon_orders(clinic_id, created_at DESC)
--       PARTIAL (WHERE clinic_id IS NOT NULL). Drives the newest-first,
--       per-clinic Shop_Orders_Page listing (Requirement 12). Partial keeps it
--       small: franchise and legacy rows are excluded.
--
-- NULLABILITY (Requirement 10.1): The column is NULLABLE on purpose. A missing
-- stamp must never block order creation, and the franchise sales path
-- legitimately produces no clinic stamp at all.
--
-- IMMUTABILITY (Requirement 10.12): Enforced HERE, in the database, by
-- trg_addon_orders_clinic_stamp_immutable. Any UPDATE that changes an
-- already-set clinic_id is rejected; the NULL -> value direction is still
-- permitted so a future back-stamp migration can fill unstamped rows exactly
-- once. This is deliberately stricter than delivery_orders.clinic_id, where
-- add-clinic-stamp-to-orders.sql left immutability to the application write
-- layer: the shop stamp also governs which clinic's stock was consumed, so a
-- silent re-stamp would break stock-to-ledger attribution. The trigger is the
-- load-bearing guard because every server action uses the service-role key and
-- therefore bypasses RLS.
--
-- The exception message carries the stable `CLINIC_STAMP_IMMUTABLE:` prefix so
-- the action layer can map it to Requirement 10.12's wording without
-- string-sniffing Postgres internals.
--
-- Safety: The new column is nullable and references the already-existing
-- public.clinics(id). No existing data is dropped or altered; the trigger only
-- rejects a mutation that no current code path performs. Idempotent
-- (re-runnable) via ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS /
-- CREATE OR REPLACE FUNCTION / DROP TRIGGER IF EXISTS before CREATE TRIGGER.
--
-- RLS: This script does NOT enable or alter RLS on public.addon_orders,
-- following the established additive pattern.
--
-- ORDERING: This script MUST run AFTER:
--   - public.addon_orders exists (shop order base schema)
--   - create-clinic-hierarchy-tables.sql (provides public.clinics)
-- It MUST run BEFORE:
--   - create-clinic-product-ledger-table.sql, whose OUT entries reference
--     addon_orders(id) and are written alongside this stamp
--   - extend-place-assisted-addon-order-for-clinic.sql, which writes the stamp
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_addon_orders_clinic_stamp_immutable ON public.addon_orders;
--   DROP FUNCTION IF EXISTS public.reject_addon_order_clinic_restamp();
--   DROP INDEX IF EXISTS public.idx_addon_orders_clinic;
--   ALTER TABLE public.addon_orders DROP COLUMN IF EXISTS clinic_id;
-- ============================================================================

-- ============================================================================
-- 1. ADDON_ORDERS (existing) — Order_Clinic_Stamp (Requirement 10.1)
-- ============================================================================
-- Set exactly once, at order creation, to the Core_Clinic whose stock fulfilled
-- the order: the customer's Aligned_Clinic for a customer-application purchase,
-- and the placing Admin's Clinic_Scope_Assignment (or explicitly selected
-- clinic) for an assisted or walk-in sale.

ALTER TABLE public.addon_orders
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id);

-- Newest-first per-clinic listing for the Shop_Orders_Page (Requirement 12.1,
-- 12.2). Partial index excludes franchise and pre-existing unstamped rows.
CREATE INDEX IF NOT EXISTS idx_addon_orders_clinic
  ON public.addon_orders (clinic_id, created_at DESC)
  WHERE clinic_id IS NOT NULL;

-- ============================================================================
-- 2. STAMP IMMUTABILITY (Requirement 10.12)
-- ============================================================================
-- Rejects any UPDATE that changes an already-set stamp, including a change to
-- NULL. Permits NULL -> value so an unstamped legacy row can still be stamped
-- exactly once by a back-stamp migration.
--
-- IS DISTINCT FROM (rather than <>) so a NULL target is compared correctly
-- instead of yielding NULL and silently passing the guard.

CREATE OR REPLACE FUNCTION public.reject_addon_order_clinic_restamp()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    'CLINIC_STAMP_IMMUTABLE: The clinic stamp on shop order % cannot be changed once set (stamped clinic %, attempted %).',
    OLD.id, OLD.clinic_id, COALESCE(NEW.clinic_id::text, 'NULL');
END;
$$;

DROP TRIGGER IF EXISTS trg_addon_orders_clinic_stamp_immutable ON public.addon_orders;
CREATE TRIGGER trg_addon_orders_clinic_stamp_immutable
  BEFORE UPDATE ON public.addon_orders
  FOR EACH ROW
  WHEN (OLD.clinic_id IS NOT NULL AND NEW.clinic_id IS DISTINCT FROM OLD.clinic_id)
  EXECUTE FUNCTION public.reject_addon_order_clinic_restamp();

-- ============================================================================
-- DONE. Additive and nullable; no backfill required. Every existing order stays
-- unstamped (the `Unassigned` grouping) and every UPDATE that leaves clinic_id
-- alone is unaffected — the trigger fires only on an actual re-stamp attempt.
-- ============================================================================
