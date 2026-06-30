-- Inventory Product Soft-Delete
-- Adds a nullable deleted_at column to inventory_products for soft-delete semantics.
-- Products with a non-null deleted_at are excluded from catalog reads while their
-- lot history and ledger entries are preserved.

ALTER TABLE inventory_products
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Partial index to keep catalog reads (active products only) fast.
CREATE INDEX IF NOT EXISTS idx_inventory_products_active
  ON inventory_products (id)
  WHERE deleted_at IS NULL;
