-- ============================================================================
-- Franchise Pincode Requests
-- ----------------------------------------------------------------------------
-- Franchise admins can REQUEST new service-area pincodes. Requests stay in
-- 'pending' until an ADMIN / MASTER_ADMIN approves them. Only on approval is
-- the pincode written into franchise_pincodes (the live service-area table),
-- so routing / assignment logic is never affected by un-approved requests.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.franchise_pincode_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id  uuid NOT NULL REFERENCES public.franchises(id) ON DELETE CASCADE,
  pincode       varchar NOT NULL CHECK (pincode ~ '^[0-9]{6}$'),
  status        varchar NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'rejected')),
  requested_by  uuid REFERENCES public.users(id),
  reviewed_by   uuid REFERENCES public.users(id),
  review_notes  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz
);

-- A franchise cannot have two open (pending) requests for the same pincode.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pending_franchise_pincode_request
  ON public.franchise_pincode_requests (franchise_id, pincode)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_fpr_franchise ON public.franchise_pincode_requests (franchise_id);
CREATE INDEX IF NOT EXISTS idx_fpr_status    ON public.franchise_pincode_requests (status);

-- Enable RLS. All access is performed through the service-role (admin) client
-- in server actions, which bypasses RLS — so we intentionally add no policies,
-- keeping the table inaccessible to anon / authenticated roles directly.
ALTER TABLE public.franchise_pincode_requests ENABLE ROW LEVEL SECURITY;
