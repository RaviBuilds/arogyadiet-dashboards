-- Manufacturing Product Mappings Table
-- Defines which raw materials can be converted to which finished products
-- Supports: 1-to-1, 1-to-many, many-to-1 mappings

CREATE TABLE IF NOT EXISTS manufacturing_product_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  raw_product_ids UUID[] NOT NULL,
  finished_product_ids UUID[] NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Index for efficient lookup of mappings by raw product
CREATE INDEX IF NOT EXISTS idx_mfg_mappings_raw_products 
  ON manufacturing_product_mappings USING GIN (raw_product_ids);

-- Index for efficient lookup of mappings by finished product
CREATE INDEX IF NOT EXISTS idx_mfg_mappings_finished_products 
  ON manufacturing_product_mappings USING GIN (finished_product_ids);

-- Add trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_manufacturing_mapping_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_manufacturing_mapping_updated_at
  BEFORE UPDATE ON manufacturing_product_mappings
  FOR EACH ROW
  EXECUTE FUNCTION update_manufacturing_mapping_updated_at();

-- Enable RLS
ALTER TABLE manufacturing_product_mappings ENABLE ROW LEVEL SECURITY;

-- Policy: Allow all operations for service_role (admin client)
CREATE POLICY "service_role_full_access" ON manufacturing_product_mappings
  FOR ALL USING (true) WITH CHECK (true);
