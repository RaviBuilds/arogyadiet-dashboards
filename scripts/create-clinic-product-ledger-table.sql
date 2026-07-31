-- ============================================================================
-- CLINIC SHOP STOCK — clinic_product_ledger table (SAFE: Additive only)
-- ============================================================================
-- Spec: clinic-scoped-shop-inventory — Task 1.2
-- Requirements: 2.1, 2.2, 2.3, 2.4, 2.8, 2.9, 2.10, 2.11, 2.12, 9.7
--
-- The append-only audit ledger for per-clinic shop stock. Exactly one entry is
-- written for every change to clinic_product_settings.stock_quantity (Req 2.5),
-- so a clinic's current stock always equals its ledger IN total minus its
-- ledger OUT total (Req 2.7).
--
-- Modelled on scripts/create-franchise-inventory-ledger-table.sql:
--   * BIGINT IDENTITY primary key giving a monotonic insertion order, used as
--     the tie-break for newest-first ordering (Req 9.7)
--   * direction enum + integrity CHECK relating direction to its references
--   * occurred_at TIMESTAMPTZ, read and rendered in UTC
--
-- Deliberate departures from the franchise ledger, each requirement driven:
--   * movement_source classifies WHY the stock moved (Req 2.8), and the two
--     CHECK constraints encode which references each source must carry
--     (Req 2.10, 2.11, 2.12) in the schema rather than in application code.
--   * quantity is an INTEGER bounded 1 .. 1,000,000 (Req 2.2, 2.3) rather than
--     an unbounded NUMERIC — shop items are whole units.
--   * Entries are immutable (Req 2.9), enforced twice: an append-only trigger
--     and a REVOKE of UPDATE/DELETE. The franchise ledger has neither. The
--     REVOKE alone would not stop the service-role client, so the trigger is
--     the load-bearing guard.
--
-- Creates:
--   1. clinic_ledger_direction ENUM (IN, OUT)
--   2. clinic_movement_source ENUM (WAREHOUSE_STOCK_IN, CUSTOMER_APP_SALE,
--      ASSISTED_SALE, WALKIN_SALE, MIGRATION)
--   3. clinic_product_ledger table + ck_cpl_direction_source + ck_cpl_reference
--   4. reject_clinic_ledger_mutation() + trg_cpl_append_only  (Req 2.9)
--   5. REVOKE UPDATE, DELETE FROM authenticated, anon         (Req 2.9)
--   6. idx_cpl_clinic_time / idx_cpl_clinic_product indexes    (Req 9.7)
--
-- No RLS policy and no GRANT SELECT: the clinic ledger view is an admin surface
-- served by service-role server actions, so `authenticated` needs no read path.
--
-- ORDERING: This script MUST run AFTER:
--   - create-clinic-hierarchy-tables.sql (public.clinics)
--   - products table exists (public.products)
--   - users table exists (public.users)
--   - addon_orders table exists (public.addon_orders)
--   - inventory_transactions table exists (public.inventory_transactions)
--   - create-clinic-product-settings-table.sql (companion overlay table)
--
-- Safety: Brand new table, types, function, and trigger. Nothing existing is
-- read for writing, dropped, or altered.
-- Idempotent (re-runnable) via DO $$ pg_type guards / IF NOT EXISTS /
-- CREATE OR REPLACE / DROP TRIGGER IF EXISTS.
--
-- Rollback:
--   DROP TRIGGER  IF EXISTS trg_cpl_append_only ON public.clinic_product_ledger;
--   DROP INDEX    IF EXISTS public.idx_cpl_clinic_product;
--   DROP INDEX    IF EXISTS public.idx_cpl_clinic_time;
--   DROP TABLE    IF EXISTS public.clinic_product_ledger;
--   DROP FUNCTION IF EXISTS public.reject_clinic_ledger_mutation();
--   DROP TYPE     IF EXISTS clinic_movement_source;
--   DROP TYPE     IF EXISTS clinic_ledger_direction;
-- ============================================================================

-- ============================================================================
-- 1. CLINIC_LEDGER_DIRECTION ENUM — IN raises stock, OUT lowers it (Req 2.1)
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'clinic_ledger_direction') THEN
    CREATE TYPE clinic_ledger_direction AS ENUM ('IN','OUT');
  END IF;
END
$$;

-- ============================================================================
-- 2. CLINIC_MOVEMENT_SOURCE ENUM — why the stock moved (Req 2.8)
-- ============================================================================
--   WAREHOUSE_STOCK_IN  warehouse Stock In into a clinic          (IN)
--   CUSTOMER_APP_SALE   customer-application shop purchase        (OUT)
--   ASSISTED_SALE       admin assisted order for a customer       (OUT)
--   WALKIN_SALE         walk-in counter sale                      (OUT)
--   MIGRATION           one-off migration of shared shop stock    (IN)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'clinic_movement_source') THEN
    CREATE TYPE clinic_movement_source AS ENUM (
      'WAREHOUSE_STOCK_IN',
      'CUSTOMER_APP_SALE',
      'ASSISTED_SALE',
      'WALKIN_SALE',
      'MIGRATION'
    );
  END IF;
END
$$;

-- ============================================================================
-- 3. CLINIC_PRODUCT_LEDGER (new) — append-only movement history (Req 2.1)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.clinic_product_ledger (
  -- Monotonic insertion order, the tie-break for newest-first ordering (Req 9.7)
  id                       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  -- Scope: every entry belongs to exactly one Core Clinic (Req 2.1, 2.4).
  -- No ON DELETE CASCADE anywhere in this table: the audit record outlives the
  -- rows it references, including a soft-deleted product (Req 1.14).
  clinic_id                UUID NOT NULL REFERENCES public.clinics(id),
  product_id               UUID NOT NULL REFERENCES public.products(id),

  direction                clinic_ledger_direction NOT NULL,

  -- Always positive, never above Stock_Quantity_Maximum (Req 2.2, 2.3).
  -- INTEGER also rejects a non-whole quantity outright (Req 2.3).
  quantity                 INTEGER NOT NULL CHECK (quantity > 0 AND quantity <= 1000000),

  movement_source          clinic_movement_source NOT NULL,

  -- Who caused the movement (Req 2.1, 2.4)
  actor_user_id            UUID NOT NULL REFERENCES public.users(id),

  -- Sale movements carry their order (Req 2.10); stock-ins carry the warehouse
  -- transaction that recorded the matching decrement (Req 2.11); a migration
  -- entry carries neither (Req 2.12). See ck_cpl_reference below.
  addon_order_id           UUID REFERENCES public.addon_orders(id),
  inventory_transaction_id UUID REFERENCES public.inventory_transactions(id),

  -- UTC occurrence timestamp (Req 2.1)
  occurred_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Direction/source integrity: stock only enters a clinic through a Stock In
  -- or the migration, and only a sale takes it out (Req 2.8)
  CONSTRAINT ck_cpl_direction_source CHECK (
    (direction = 'IN'  AND movement_source IN ('WAREHOUSE_STOCK_IN','MIGRATION')) OR
    (direction = 'OUT' AND movement_source IN ('CUSTOMER_APP_SALE','ASSISTED_SALE','WALKIN_SALE'))
  ),

  -- Reference integrity per source (Req 2.10, 2.11, 2.12)
  CONSTRAINT ck_cpl_reference CHECK (
    (movement_source = 'WAREHOUSE_STOCK_IN' AND inventory_transaction_id IS NOT NULL AND addon_order_id IS NULL) OR
    (movement_source = 'MIGRATION'          AND inventory_transaction_id IS NULL     AND addon_order_id IS NULL) OR
    (movement_source IN ('CUSTOMER_APP_SALE','ASSISTED_SALE','WALKIN_SALE')
       AND addon_order_id IS NOT NULL AND inventory_transaction_id IS NULL)
  )
);

-- ============================================================================
-- 4. APPEND-ONLY GUARD (Req 2.9)
-- ============================================================================
-- This is the audit record of truth: an entry may be inserted and then only
-- ever read. Any UPDATE or DELETE aborts, whichever role attempts it —
-- including the service-role client that RLS and GRANTs do not constrain.

CREATE OR REPLACE FUNCTION public.reject_clinic_ledger_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION
    'CLINIC_STOCK_LEDGER_IMMUTABLE: clinic shop ledger entries are immutable; % on entry % was rejected',
    lower(TG_OP), OLD.id;
END;
$$;

DROP TRIGGER IF EXISTS trg_cpl_append_only ON public.clinic_product_ledger;
CREATE TRIGGER trg_cpl_append_only
  BEFORE UPDATE OR DELETE ON public.clinic_product_ledger
  FOR EACH ROW EXECUTE FUNCTION public.reject_clinic_ledger_mutation();

-- ============================================================================
-- 5. PRIVILEGES — second layer of the immutability guarantee (Req 2.9)
-- ============================================================================
-- Belt and braces alongside the trigger. Inserts and reads happen through
-- service-role server actions and the SECURITY DEFINER RPCs, so neither
-- client role needs any write privilege here.

REVOKE UPDATE, DELETE ON public.clinic_product_ledger FROM authenticated;
REVOKE UPDATE, DELETE ON public.clinic_product_ledger FROM anon;

-- ============================================================================
-- 6. INDEXES (Req 9.7)
-- ============================================================================

-- Newest-first per clinic, with the identity column as tie-break
CREATE INDEX IF NOT EXISTS idx_cpl_clinic_time
  ON public.clinic_product_ledger(clinic_id, occurred_at DESC, id DESC);

-- Per-clinic, per-product history and the stock/ledger parity check
CREATE INDEX IF NOT EXISTS idx_cpl_clinic_product
  ON public.clinic_product_ledger(clinic_id, product_id);

-- ============================================================================
-- DONE. The table is additive and isolated.
-- Run AFTER clinics, products, users, addon_orders, and inventory_transactions
-- exist, and alongside scripts/create-clinic-product-settings-table.sql.
-- Next in this spec: scripts/add-inventory-product-link-to-products.sql
-- ============================================================================
