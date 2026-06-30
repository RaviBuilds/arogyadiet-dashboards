-- ============================================================================
-- CORE CLINIC ARCHITECTURE — Order/Batch Clinic Stamp (SAFE: Additive only)
-- ============================================================================
-- Adds the immutable per-order / per-batch Clinic stamp that is the
-- authoritative basis for per-clinic workload snapshots, routing attribution,
-- delivery history, and the Conflict_Clinic_List (Requirements 19, 22.7).
--
-- Standalone additive migration — run SEPARATELY from
-- scripts/create-clinic-hierarchy-tables.sql (Task 1.1), which creates the
-- public.clinics(id) table referenced below.
--
-- Adds (nullable, NULL = unresolved at creation, zero production impact):
--   - delivery_orders.clinic_id   — the customer's resolved DELIVERY-address
--                                   clinic at order-creation time (Req 19.2, 22.3).
--   - delivery_batches.clinic_id  — the routing rider's linked clinic at
--                                   routing (batch-creation) time (Req 19.3).
--
-- Adds indexes:
--   - idx_delivery_orders_clinic_date   ON delivery_orders(clinic_id, delivery_date)
--       drives per-clinic workload aggregation + history off the stamp (Req 19.6, 12).
--   - idx_delivery_orders_date          ON delivery_orders(delivery_date)
--       supports the Conflict_Clinic_List per-day scan (Req 22.7).
--   - idx_delivery_batches_clinic_date  ON delivery_batches(clinic_id, delivery_date)
--
-- ADDON ORDERS: addon_orders inherit their clinic via delivery_order_id and do
-- NOT carry their own clinic_id column (no schema change here).
--
-- NULLABILITY (Req 19.8, 19.9): Both columns are NULLABLE on purpose. An
-- unresolved clinic must NEVER block order or batch creation. When the delivery
-- address resolves to no clinic, or the routing rider has no linked clinic, the
-- stamp is simply left NULL and creation proceeds normally. A NULL order stamp
-- surfaces in the Conflict_Clinic_List as a needs-attention entry (Req 22.7).
--
-- IMMUTABILITY (Req 19.4, 19.5): These stamps are set EXACTLY ONCE at creation
-- and are immutable thereafter. Immutability is enforced at the APPLICATION
-- write layer (no code path issues an UPDATE of these columns after creation;
-- the assertStampImmutable guard rejects any change to an already-set stamp).
-- It is intentionally NOT enforced by the database here, to keep this migration
-- purely additive and to leave the seed/back-stamp migration free to fill NULL
-- stamps on pre-existing rows. Pincode moves, customer moves, and customer
-- auto-reassignment scope their writes to customer_profiles / addresses only and
-- never touch these order/batch stamps — so a customer's prior orders stay
-- attributed to the clinic that served them (Req 19.6, 19.7).
--
-- Safety: All new columns are nullable and reference the already-existing
-- public.clinics(id). No existing data is dropped or altered. Idempotent
-- (re-runnable) via ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
--
-- RLS: This script does NOT enable RLS and does NOT alter any existing data,
-- following the established additive pattern (create-clinic-hierarchy-tables.sql).
--
-- Rollback:
--   DROP INDEX IF EXISTS public.idx_delivery_orders_clinic_date;
--   DROP INDEX IF EXISTS public.idx_delivery_orders_date;
--   DROP INDEX IF EXISTS public.idx_delivery_batches_clinic_date;
--   ALTER TABLE public.delivery_orders  DROP COLUMN IF EXISTS clinic_id;
--   ALTER TABLE public.delivery_batches DROP COLUMN IF EXISTS clinic_id;
-- ============================================================================

-- ============================================================================
-- 1. DELIVERY_ORDERS (existing) — creation-time clinic stamp (Req 19.2, 19.8)
-- ============================================================================
-- clinic_id = the customer's resolved DELIVERY-address clinic at the moment the
-- order is created (Req 19.2 / 22.3). NULL when unresolved (never blocks
-- creation; surfaces in the Conflict_Clinic_List). Immutable after creation
-- (enforced at the application write layer).

ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id);

-- Drives per-clinic workload aggregation and delivery history off the stamp
-- (Req 19.6, Req 12): count delivery_orders by stamped clinic_id and delivery_date.
CREATE INDEX IF NOT EXISTS idx_delivery_orders_clinic_date
  ON public.delivery_orders(clinic_id, delivery_date);

-- Supports the Conflict_Clinic_List per-day scan (Req 22.7), which filters
-- delivery_orders by delivery_date and compares the order stamp against the
-- owning customer's Primary_Address clinic.
CREATE INDEX IF NOT EXISTS idx_delivery_orders_date
  ON public.delivery_orders(delivery_date);

-- ============================================================================
-- 2. DELIVERY_BATCHES (existing) — routing-time clinic stamp (Req 19.3, 19.9)
-- ============================================================================
-- clinic_id = the routing rider's linked clinic for the batch's routing scope
-- at batch-creation time. NULL when the rider has no linked clinic (never blocks
-- routing). Immutable after creation (enforced at the application write layer).

ALTER TABLE public.delivery_batches
  ADD COLUMN IF NOT EXISTS clinic_id UUID REFERENCES public.clinics(id);

CREATE INDEX IF NOT EXISTS idx_delivery_batches_clinic_date
  ON public.delivery_batches(clinic_id, delivery_date);

-- ============================================================================
-- DONE. Both clinic_id columns are additive and nullable; immutability is
-- enforced at the application write layer (not the DB). addon_orders inherit
-- their clinic via delivery_order_id (no own column). Run the seed migration
-- (seed-madhapur-clinic.sql) separately to back-stamp existing history.
-- ============================================================================
