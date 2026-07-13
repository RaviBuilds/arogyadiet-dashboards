-- ============================================================================
-- Add SELF_MADE to inventory_lots.source_type CHECK constraint (SAFE: Additive only)
-- ============================================================================
-- Drops the existing CHECK constraint and recreates it with the additional
-- 'SELF_MADE' value for stock that is produced in-house.
--
-- Idempotent: new constraint uses IF NOT EXISTS-style approach via DROP/ADD.
-- No data is modified; existing rows remain valid.
-- ============================================================================

ALTER TABLE public.inventory_lots
  DROP CONSTRAINT IF EXISTS inventory_lots_source_type_check;

ALTER TABLE public.inventory_lots
  ADD CONSTRAINT inventory_lots_source_type_check
  CHECK (source_type = ANY (ARRAY['FARMER'::text, 'VENDOR'::text, 'SELF_MADE'::text, 'OTHER'::text]));
