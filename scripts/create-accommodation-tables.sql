-- ============================================================================
-- ACCOMMODATION CUSTOMER FLOW — Database migration for accommodation tables
-- ============================================================================
-- Spec: accommodation-customer-flow — Task 1.1
-- Requirements: 4.5, 4.6, 9.2, 5.1, 5.2, 5.3
--
-- Introduces database structures supporting the full ACCOMMODATION customer
-- lifecycle: stay entries with status tracking, customer/admin health logs,
-- add-on service requests, and medical history fields on customer_profiles.
--
-- Key Features:
--   - stay_entries table with status lifecycle (PENDING→ACTIVE→FINISHED/EXPIRED)
--   - customer_health_logs with UNIQUE constraint on (stay_entry_id, log_date)
--   - admin_health_logs for daily health metrics entered by admin
--   - addon_service_requests for wellness service tracking
--   - Medical history columns on customer_profiles
--
-- Creates:
--   1. stay_entries table (new) — accommodation stay records
--   2. customer_health_logs table (new) — customer daily health entries
--   3. admin_health_logs table (new) — admin daily health metrics
--   4. addon_service_requests table (new) — wellness service requests
--   5. ALTER customer_profiles — add medical history columns
--   6. updated_at trigger functions and triggers for all new tables
--   7. Indexes for performance
--
-- ORDERING: This script MUST run AFTER customer_profiles table exists, as it
-- references public.customer_profiles(id) via foreign keys.
--
-- Safety: Brand new tables + additive ALTER; nothing existing is dropped.
-- Idempotent (re-runnable) via IF NOT EXISTS / OR REPLACE guards.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.addon_service_requests;
--   DROP TABLE IF EXISTS public.admin_health_logs;
--   DROP TABLE IF EXISTS public.customer_health_logs;
--   DROP TABLE IF EXISTS public.stay_entries;
--   ALTER TABLE public.customer_profiles DROP COLUMN IF EXISTS medical_history_notes;
--   ALTER TABLE public.customer_profiles DROP COLUMN IF EXISTS medical_history_confirmed;
--   ALTER TABLE public.customer_profiles DROP COLUMN IF EXISTS medical_documents;
--   DROP FUNCTION IF EXISTS public.update_stay_entries_updated_at();
--   DROP FUNCTION IF EXISTS public.update_customer_health_logs_updated_at();
--   DROP FUNCTION IF EXISTS public.update_admin_health_logs_updated_at();
--   DROP FUNCTION IF EXISTS public.update_addon_service_requests_updated_at();
-- ============================================================================

-- ============================================================================
-- 1. STAY_ENTRIES TABLE (Req 4.5, 4.6, 5.1, 5.2, 5.3)
-- ============================================================================
-- Central domain entity for accommodation stays. Decoupled from subscriptions
-- to keep meal subscription lifecycle separate from accommodation stays.
-- Status lifecycle: PENDING → ACTIVE → FINISHED, or PENDING → EXPIRED.

CREATE TABLE IF NOT EXISTS public.stay_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id UUID NOT NULL REFERENCES public.customer_profiles(id),
  start_date DATE NOT NULL,
  total_nights INTEGER NOT NULL CHECK (total_nights >= 1 AND total_nights <= 365),
  stay_type TEXT NOT NULL CHECK (stay_type IN ('AC Villa', 'Village Style Hut')),
  occupancy_type TEXT NOT NULL CHECK (occupancy_type IN ('Single', 'Double')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'FINISHED', 'EXPIRED')),
  payment_amount NUMERIC(10,2),
  base_amount NUMERIC(10,2),
  tax_amount NUMERIC(10,2),
  tax_percentage NUMERIC(4,2) DEFAULT 18.00,
  payment_host_profile_id UUID REFERENCES public.customer_profiles(id),
  meal_preference TEXT CHECK (meal_preference IN ('VEG', 'EGG', 'CHICKEN')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger for stay_entries
CREATE OR REPLACE FUNCTION public.update_stay_entries_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_stay_entries_updated_at ON public.stay_entries;
CREATE TRIGGER trg_stay_entries_updated_at
  BEFORE UPDATE ON public.stay_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.update_stay_entries_updated_at();

-- Indexes for stay_entries
CREATE INDEX IF NOT EXISTS idx_stay_entries_customer
  ON public.stay_entries(customer_profile_id);

CREATE INDEX IF NOT EXISTS idx_stay_entries_status
  ON public.stay_entries(status);

CREATE INDEX IF NOT EXISTS idx_stay_entries_dates
  ON public.stay_entries(start_date, status);

-- ============================================================================
-- 2. CUSTOMER_HEALTH_LOGS TABLE (Req 9.2)
-- ============================================================================
-- Daily health data entered by the customer (water intake, physical activity).
-- UNIQUE constraint on (stay_entry_id, log_date) enables upsert behavior:
-- one entry per day per stay, updated on conflict.

CREATE TABLE IF NOT EXISTS public.customer_health_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_entry_id UUID NOT NULL REFERENCES public.stay_entries(id),
  customer_profile_id UUID NOT NULL REFERENCES public.customer_profiles(id),
  log_date DATE NOT NULL,
  water_intake_liters NUMERIC(4,1) CHECK (water_intake_liters >= 0.1 AND water_intake_liters <= 15.0),
  activity_name VARCHAR(100),
  activity_duration_minutes INTEGER CHECK (activity_duration_minutes >= 1 AND activity_duration_minutes <= 1440),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(stay_entry_id, log_date)
);

-- updated_at trigger for customer_health_logs
CREATE OR REPLACE FUNCTION public.update_customer_health_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_customer_health_logs_updated_at ON public.customer_health_logs;
CREATE TRIGGER trg_customer_health_logs_updated_at
  BEFORE UPDATE ON public.customer_health_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_customer_health_logs_updated_at();

-- ============================================================================
-- 3. ADMIN_HEALTH_LOGS TABLE (Req 9.2)
-- ============================================================================
-- Daily health monitoring data entered by admin (weight, BP, sugar level).
-- Multiple entries per day are allowed (admin may record morning/evening).

CREATE TABLE IF NOT EXISTS public.admin_health_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stay_entry_id UUID NOT NULL REFERENCES public.stay_entries(id),
  customer_profile_id UUID NOT NULL REFERENCES public.customer_profiles(id),
  log_date DATE NOT NULL,
  weight_kg NUMERIC(5,1) CHECK (weight_kg >= 30.0 AND weight_kg <= 300.0),
  bp_systolic INTEGER CHECK (bp_systolic >= 60 AND bp_systolic <= 250),
  bp_diastolic INTEGER CHECK (bp_diastolic >= 40 AND bp_diastolic <= 150),
  sugar_level_mgdl INTEGER CHECK (sugar_level_mgdl >= 30 AND sugar_level_mgdl <= 600),
  notes VARCHAR(500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger for admin_health_logs
CREATE OR REPLACE FUNCTION public.update_admin_health_logs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_admin_health_logs_updated_at ON public.admin_health_logs;
CREATE TRIGGER trg_admin_health_logs_updated_at
  BEFORE UPDATE ON public.admin_health_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.update_admin_health_logs_updated_at();

-- Index for admin_health_logs
CREATE INDEX IF NOT EXISTS idx_admin_health_logs_stay
  ON public.admin_health_logs(stay_entry_id, log_date);

-- ============================================================================
-- 4. ADDON_SERVICE_REQUESTS TABLE (Req 5.1, 5.2, 5.3)
-- ============================================================================
-- Tracks add-on wellness service requests (therapy, massage, etc.)
-- Status lifecycle: PENDING → CONFIRMED → COMPLETED.

CREATE TABLE IF NOT EXISTS public.addon_service_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_profile_id UUID NOT NULL REFERENCES public.customer_profiles(id),
  stay_entry_id UUID NOT NULL REFERENCES public.stay_entries(id),
  service_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'COMPLETED')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- updated_at trigger for addon_service_requests
CREATE OR REPLACE FUNCTION public.update_addon_service_requests_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_addon_service_requests_updated_at ON public.addon_service_requests;
CREATE TRIGGER trg_addon_service_requests_updated_at
  BEFORE UPDATE ON public.addon_service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_addon_service_requests_updated_at();

-- Index for addon_service_requests
CREATE INDEX IF NOT EXISTS idx_addon_requests_customer
  ON public.addon_service_requests(customer_profile_id);

-- ============================================================================
-- 5. ALTER CUSTOMER_PROFILES — Medical history columns
-- ============================================================================
-- Adds medical history support for accommodation customers:
--   - medical_history_notes: free-text medical history
--   - medical_history_confirmed: checkbox "no medical history to share"
--   - medical_documents: JSONB array of uploaded document references

ALTER TABLE public.customer_profiles
  ADD COLUMN IF NOT EXISTS medical_history_notes TEXT,
  ADD COLUMN IF NOT EXISTS medical_history_confirmed BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS medical_documents JSONB DEFAULT '[]'::jsonb;

-- ============================================================================
-- DONE. The database now supports:
--   - Accommodation stay entries with full lifecycle (PENDING/ACTIVE/FINISHED/EXPIRED)
--   - Customer daily health logs with upsert on (stay_entry_id, log_date)
--   - Admin daily health monitoring logs
--   - Add-on wellness service requests
--   - Medical history on customer profiles
--
-- Next steps:
--   - Task 1.2: Create TypeScript types for accommodation domain
--   - Task 1.3: Create Zod validation schemas
-- ============================================================================
