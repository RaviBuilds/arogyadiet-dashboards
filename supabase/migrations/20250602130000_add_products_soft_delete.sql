BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

COMMENT ON COLUMN public.products.deleted_at IS
  'When set, product is archived and hidden from shop/admin catalog. Row kept for order history.';

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_sku_key;

CREATE UNIQUE INDEX IF NOT EXISTS products_sku_active_unique
  ON public.products (sku)
  WHERE deleted_at IS NULL AND sku IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_not_deleted
  ON public.products (created_at DESC)
  WHERE deleted_at IS NULL;

COMMIT;
