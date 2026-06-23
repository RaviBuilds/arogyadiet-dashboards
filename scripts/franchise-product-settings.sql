-- ============================================================================
-- PER-FRANCHISE SHOP PRODUCT SETTINGS (overlay on the shared product catalog)
-- ============================================================================
-- Run in Supabase SQL Editor.
--
-- Model: "shared catalog + per-franchise overlay".
--   * `products` remains the single, admin-owned catalog (franchise_id stays NULL).
--   * Each franchise gets ONE overlay row per product controlling:
--       - stock_quantity  (franchise's own stock, decremented on purchase)
--       - is_visible      (show/hide on that franchise's customer shop)
--   * Franchise admins may ONLY edit stock + visibility. They cannot create,
--     edit, or delete catalog products.
--
-- Safety: brand-new table + functions. Zero impact on core operation.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.franchise_product_settings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id  UUID NOT NULL REFERENCES public.franchises(id) ON DELETE CASCADE,
  product_id    UUID NOT NULL REFERENCES public.products(id)   ON DELETE CASCADE,
  stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  is_visible    BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_franchise_product UNIQUE (franchise_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_fps_franchise ON public.franchise_product_settings(franchise_id);
CREATE INDEX IF NOT EXISTS idx_fps_product   ON public.franchise_product_settings(product_id);

-- auto-update updated_at
CREATE OR REPLACE FUNCTION update_fps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_fps_updated_at ON public.franchise_product_settings;
CREATE TRIGGER trg_fps_updated_at
  BEFORE UPDATE ON public.franchise_product_settings
  FOR EACH ROW EXECUTE FUNCTION update_fps_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: authenticated users may READ (customer shop needs this via SSR client).
-- All writes go through service-role server actions (bypass RLS).
-- ----------------------------------------------------------------------------
ALTER TABLE public.franchise_product_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fps_read_authenticated" ON public.franchise_product_settings;
CREATE POLICY "fps_read_authenticated"
  ON public.franchise_product_settings FOR SELECT
  TO authenticated
  USING (true);

-- ----------------------------------------------------------------------------
-- Atomic stock decrement for a franchise purchase.
-- Returns true when stock was sufficient and decremented; false otherwise.
-- SECURITY DEFINER so it can run from the user-scoped (SSR) client.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.decrement_franchise_product_stock(
  p_franchise_id UUID,
  p_product_id   UUID,
  p_quantity     INTEGER
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated INTEGER;
BEGIN
  UPDATE public.franchise_product_settings
     SET stock_quantity = stock_quantity - p_quantity
   WHERE franchise_id = p_franchise_id
     AND product_id   = p_product_id
     AND is_visible   = true
     AND stock_quantity >= p_quantity;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated > 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.decrement_franchise_product_stock(UUID, UUID, INTEGER) TO authenticated;
