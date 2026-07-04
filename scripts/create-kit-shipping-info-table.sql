-- ============================================================================
-- KIT SUBSCRIPTION MANAGEMENT — kit_shipping_info table (SAFE: Additive only)
-- ============================================================================
-- Spec: kit-subscription-management — Task 1.2 — Requirements 6.1, 6.2, 6.3, 6.4, 9.4
--
-- Introduces the shipping information table for KIT subscription orders. Each
-- KIT subscription tracks courier partner, tracking number, and optional tracking
-- URL for package delivery management. This table is completely isolated from
-- meal subscription delivery logic (rider assignments, delivery batches).
--
-- Key Features:
--   - Courier partner enum with CHECK constraint (Req 6.2)
--   - Conditional tracking URL requirement for 'OTHER' courier (Req 6.3, 6.4)
--   - Links to both customer_profile and subscription for data integrity (Req 9.4)
--   - Indexed lookups by customer and subscription (Req 9.4)
--
-- Creates:
--   1. kit_shipping_info table (new) — shipping data for KIT orders
--   2. updated_at trigger (follows existing project pattern)
--
-- ORDERING: This script MUST run AFTER customer_profiles and subscriptions tables
-- exist, as it references both via foreign keys.
--
-- Safety: Brand new table; nothing existing is dropped or altered.
-- Idempotent (re-runnable) via IF NOT EXISTS guards.
--
-- Rollback:
--   DROP TRIGGER IF EXISTS trg_kit_shipping_info_updated_at ON public.kit_shipping_info;
--   DROP FUNCTION IF EXISTS public.update_kit_shipping_info_updated_at();
--   DROP TABLE IF EXISTS public.kit_shipping_info;
-- ============================================================================

-- ============================================================================
-- 1. KIT_SHIPPING_INFO (new) — courier tracking for KIT subscriptions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kit_shipping_info (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id UUID NOT NULL REFERENCES public.customer_profiles(id) ON DELETE CASCADE,
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  courier_partner TEXT NOT NULL 
    CHECK (courier_partner IN ('OTHER', 'APSRTC', 'TGSRTC', 'DTDC')),  -- Req 6.2
  tracking_number TEXT NOT NULL,
  tracking_url TEXT,  -- Required only when courier_partner = 'OTHER' (Req 6.3, 6.4)
  shipped_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Enforce tracking_url requirement for 'OTHER' courier (Req 6.3, 6.4)
  CONSTRAINT chk_tracking_url_for_other CHECK (
    (courier_partner != 'OTHER') OR 
    (courier_partner = 'OTHER' AND tracking_url IS NOT NULL AND tracking_url != '')
  )
);

-- ============================================================================
-- 2. INDEXES — fast lookups by customer and subscription (Req 9.4)
-- ============================================================================

-- Index for customer lookups (admin shipping dashboard, customer portal)
CREATE INDEX IF NOT EXISTS idx_kit_shipping_customer 
  ON public.kit_shipping_info(customer_profile_id);

-- Index for subscription lookups (linking shipping to specific KIT orders)
CREATE INDEX IF NOT EXISTS idx_kit_shipping_subscription 
  ON public.kit_shipping_info(subscription_id);

-- ============================================================================
-- 3. updated_at TRIGGER (project standard pattern)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_kit_shipping_info_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_kit_shipping_info_updated_at ON public.kit_shipping_info;
CREATE TRIGGER trg_kit_shipping_info_updated_at
  BEFORE UPDATE ON public.kit_shipping_info
  FOR EACH ROW
  EXECUTE FUNCTION public.update_kit_shipping_info_updated_at();

-- ============================================================================
-- DONE. The table is additive and isolated. Run only AFTER customer_profiles
-- and subscriptions tables exist.
-- ============================================================================
