-- Extend inventory_transactions for franchise dispatch
-- Adds destination-franchise and transfer linkage columns so the central outgoing
-- ledger records which franchise received the stock and links to the per-batch
-- transfer breakdown. Also relaxes the legacy fixed-branch reason CHECK constraint
-- so dynamic "Sent to <franchise>" reasons are allowed.
--
-- This migration is purely additive — existing central records, indexes, and all
-- other columns remain untouched.
--
-- Requirements validated: 13.2, 13.4

-- 1. Add the destination franchise reference (nullable — existing rows stay NULL)
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS dest_franchise_id UUID REFERENCES public.franchises(id);

-- 2. Add the franchise transfer reference for per-batch traceability
ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS franchise_transfer_id UUID REFERENCES public.franchise_stock_transfers(id);

-- 3. Relax the legacy fixed-branch CHECK so dynamic "Sent to <franchise>" reasons
--    are allowed. The constraint was added inline in add-inventory-transaction-reason.sql
--    and PostgreSQL names it `inventory_transactions_reason_check` by convention.
ALTER TABLE public.inventory_transactions
  DROP CONSTRAINT IF EXISTS inventory_transactions_reason_check;
