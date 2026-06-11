-- Fixed (permanent) customer -> rider assignment overrides.
-- Run in Supabase SQL Editor before using the "Fixed Assignments" Operations feature.
--
-- Purpose:
--   The daily routing automation (routeEngine) assigns each delivery order to a
--   rider by matching the delivery address pincode against rider_service_areas.
--   This table lets an admin pin a specific customer to a specific rider PERMANENTLY,
--   overriding pincode-based assignment, even when the customer's pincode is NOT in
--   that rider's service area. The override is honoured by every daily routing run
--   until the admin removes the row here.

CREATE TABLE public.fixed_rider_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id uuid NOT NULL UNIQUE
    REFERENCES public.customer_profiles (id) ON DELETE CASCADE,
  rider_id uuid NOT NULL
    REFERENCES public.rider_profiles (id) ON DELETE CASCADE,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One customer can have at most one fixed rider (enforced by UNIQUE above).
CREATE INDEX idx_fixed_rider_assignments_rider
  ON public.fixed_rider_assignments (rider_id);

ALTER TABLE public.fixed_rider_assignments ENABLE ROW LEVEL SECURITY;

-- No authenticated policies: all writes/reads for this admin feature go through
-- createAdminClient (service role bypasses RLS), matching the pattern used by
-- other admin-only operational tables (e.g. holidays, rider_service_areas).
