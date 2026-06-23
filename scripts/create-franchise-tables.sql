-- ============================================================================
-- FRANCHISE TABLES — Phase 1 (SAFE: Additive only, zero production impact)
-- ============================================================================
-- Creates:
--   1. franchise_status ENUM type
--   2. franchises table (franchise registry)
--   3. franchise_pincodes table (pincode-to-franchise mapping)
--
-- Safety: These are entirely NEW tables — no existing data or queries affected.
-- Rollback: DROP TABLE franchise_pincodes; DROP TABLE franchises; DROP TYPE franchise_status;
-- ============================================================================

-- 1. Create the status enum type
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'franchise_status') THEN
    CREATE TYPE franchise_status AS ENUM ('onboarding', 'active', 'suspended');
  END IF;
END
$$;

-- 2. Create the franchises table
CREATE TABLE IF NOT EXISTS public.franchises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL UNIQUE,
  status franchise_status NOT NULL DEFAULT 'onboarding',
  kitchen_id UUID DEFAULT NULL REFERENCES public.kitchens(id) ON DELETE SET NULL,
  owner_user_id UUID DEFAULT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Create the franchise_pincodes table
CREATE TABLE IF NOT EXISTS public.franchise_pincodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id UUID NOT NULL REFERENCES public.franchises(id) ON DELETE CASCADE,
  pincode VARCHAR(6) NOT NULL CHECK (pincode ~ '^[0-9]{6}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Each pincode can only belong to one franchise (single-assignment enforcement)
  CONSTRAINT uq_franchise_pincode UNIQUE (franchise_id, pincode),
  CONSTRAINT uq_pincode_global UNIQUE (pincode)
);

-- 4. Create indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_franchises_status ON public.franchises(status);
CREATE INDEX IF NOT EXISTS idx_franchises_owner ON public.franchises(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_franchise_pincodes_franchise ON public.franchise_pincodes(franchise_id);
CREATE INDEX IF NOT EXISTS idx_franchise_pincodes_pincode ON public.franchise_pincodes(pincode);

-- 5. Add updated_at trigger (auto-update on modification)
CREATE OR REPLACE FUNCTION update_franchises_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_franchises_updated_at ON public.franchises;
CREATE TRIGGER trg_franchises_updated_at
  BEFORE UPDATE ON public.franchises
  FOR EACH ROW
  EXECUTE FUNCTION update_franchises_updated_at();
