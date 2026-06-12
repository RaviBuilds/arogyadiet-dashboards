-- Inventory Lot Source & Purchase Order Attachment
-- Adds supplier source tracking and a purchase order file reference to inventory lots.
-- Purchase order files are stored in the PRIVATE Supabase storage bucket "purchase-orders"
-- (5 MB limit; image/jpeg, image/png, image/webp, application/pdf).

ALTER TABLE inventory_lots
  ADD COLUMN IF NOT EXISTS source_type TEXT CHECK (source_type IN ('FARMER', 'VENDOR', 'OTHER')),
  ADD COLUMN IF NOT EXISTS source_name TEXT,
  ADD COLUMN IF NOT EXISTS purchase_order_path TEXT;

-- Speeds up the date-range purchase order export query.
CREATE INDEX IF NOT EXISTS idx_inventory_lots_po_created_at
  ON inventory_lots(created_at) WHERE purchase_order_path IS NOT NULL;
