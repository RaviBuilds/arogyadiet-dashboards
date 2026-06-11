-- Manufacturing Batches Table
-- Groups multiple manufacturing orders together for multi-raw-material processing
-- Used when multiple raw materials are combined to produce one finished product

CREATE TABLE IF NOT EXISTS manufacturing_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  mapping_id UUID REFERENCES manufacturing_product_mappings(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED')),
  total_input_weight NUMERIC NOT NULL DEFAULT 0,
  total_cost_value NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  completed_at TIMESTAMPTZ
);

-- Add optional batch_id to manufacturing_orders for grouping
ALTER TABLE manufacturing_orders 
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES manufacturing_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mfg_orders_batch_id 
  ON manufacturing_orders(batch_id) WHERE batch_id IS NOT NULL;
