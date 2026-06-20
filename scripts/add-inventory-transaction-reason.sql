-- Inventory Transaction Reason / Destination
-- Persists the dispatch reason/destination for outgoing (OUT) stock movements so
-- the Audit Ledger can show *why* stock left inventory and allow filtering by it.
--
-- Incoming (IN) source tracking already lives on inventory_lots
-- (source_type / source_name). Outgoing reasons previously were collected in the
-- Dispatch modal but never stored — this column closes that gap.
--
-- Allowed values mirror DISPATCH_STOCK_REASONS in
-- src/lib/inventory/product-schema.ts. NULL is allowed for IN / manufacturing rows.

ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS reason TEXT
  CHECK (
    reason IS NULL
    OR reason IN (
      'Kitchen Consumption',
      'Customer Sale',
      'Spoilage / Damage',
      'Sent to Gachibowli Branch',
      'Sent to Madhapur Branch'
    )
  );

-- Speeds up the ledger's destination filter on outgoing entries.
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_reason
  ON inventory_transactions(reason) WHERE reason IS NOT NULL;
