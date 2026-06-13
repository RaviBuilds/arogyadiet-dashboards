-- ═══════════════════════════════════════════════════════════════════════
-- Finance & Payout Command Center — Schema Upgrades
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Rider Payout Adjustments Table
-- Stores manual additions/deductions to a rider's payout without altering raw delivery logs.
-- Example use cases: bonuses, penalties, reimbursements, deductions for damages.

CREATE TABLE IF NOT EXISTS rider_payout_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES rider_profiles(id) ON DELETE CASCADE,
  summary_id UUID NOT NULL REFERENCES rider_monthly_summaries(id) ON DELETE CASCADE,
  adjustment_type TEXT NOT NULL CHECK (adjustment_type IN ('BONUS', 'PENALTY', 'REIMBURSEMENT', 'DEDUCTION', 'OTHER')),
  amount NUMERIC NOT NULL,  -- positive = addition, negative = deduction
  reason TEXT NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups by summary
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_summary ON rider_payout_adjustments(summary_id);
CREATE INDEX IF NOT EXISTS idx_payout_adjustments_rider ON rider_payout_adjustments(rider_id);

-- 2. Add adjustment_total column to rider_monthly_summaries for quick aggregation
ALTER TABLE rider_monthly_summaries
  ADD COLUMN IF NOT EXISTS adjustment_total NUMERIC NOT NULL DEFAULT 0;

-- 3. Add final_amount column (total_earnings + adjustment_total) for display
ALTER TABLE rider_monthly_summaries
  ADD COLUMN IF NOT EXISTS final_amount NUMERIC NOT NULL DEFAULT 0;

-- 4. RLS Policies
ALTER TABLE rider_payout_adjustments ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read (admins filter in application layer)
CREATE POLICY "Allow authenticated read" ON rider_payout_adjustments
  FOR SELECT TO authenticated USING (true);

-- Allow inserts from authenticated users (admin check in application layer)
CREATE POLICY "Allow authenticated insert" ON rider_payout_adjustments
  FOR INSERT TO authenticated WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════════
-- NOTES:
-- • The `rider_monthly_summaries` table already has:
--   - period_start / period_end (custom cycle dates, 26th-27th)
--   - status: 'GENERATED' | 'PAID'
--   - is_custom: boolean for custom date ranges
--   - paid_at, paid_by, paid_notes
-- • The new `adjustment_total` and `final_amount` fields are computed
--   when adjustments are applied, keeping queries simple.
-- ═══════════════════════════════════════════════════════════════════════
