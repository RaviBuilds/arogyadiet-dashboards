-- Create holidays table for admin-managed holiday calendar.
-- Run in Supabase SQL Editor before using the Holiday Calendar admin feature.

CREATE TABLE public.holidays (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  holiday_date date NOT NULL UNIQUE,
  name text NOT NULL CHECK (char_length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_holidays_date ON public.holidays (holiday_date);

ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;

-- Customers need read-only access via SSR client
CREATE POLICY "Authenticated users can read holidays"
  ON public.holidays FOR SELECT
  TO authenticated
  USING (true);

-- No INSERT/UPDATE/DELETE policies for authenticated users;
-- admin writes go through createAdminClient (service role bypasses RLS)
