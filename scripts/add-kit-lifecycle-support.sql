-- ============================================================================
-- KIT LIFECYCLE MANAGEMENT — Database migration for lifecycle support
-- ============================================================================
-- Spec: kit-lifecycle-management — Task 1.1 — Requirements 11.1, 11.2, 11.3, 11.4
--
-- Introduces database structures supporting the full KIT lifecycle: multiple
-- KIT subscriptions per customer, at-most-one active/pending constraint, and
-- PDF report caching for expired KITs.
--
-- Key Features:
--   - kit_report_cache table for pre-generated PDF reports (Req 11.1)
--   - Partial unique index enforcing at-most-one PENDING/ACTIVE KIT per customer (Req 11.2)
--   - Supports recurring KIT lifecycle: purchase → ship → receive → track → expire → renew
--
-- Creates:
--   1. kit_report_cache table (new) — cached PDF reports for EXPIRED KIT subscriptions
--   2. uq_active_subscription_per_category partial unique index (if not exists)
--
-- ORDERING: This script MUST run AFTER subscriptions table exists, as it
-- references it via foreign key and index.
--
-- Safety: Brand new table + additive index; nothing existing is dropped or altered.
-- Idempotent (re-runnable) via IF NOT EXISTS guards.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.kit_report_cache;
--   DROP INDEX IF EXISTS public.uq_active_subscription_per_category;
-- ============================================================================

-- ============================================================================
-- 1. KIT_REPORT_CACHE (new) — cached PDF reports for EXPIRED KIT subscriptions
-- ============================================================================
-- Stores pre-generated PDF reports for EXPIRED KIT subscriptions to avoid
-- redundant computation. One cached report per subscription. Active KIT PDFs
-- are generated dynamically and not cached (data changes daily).

CREATE TABLE IF NOT EXISTS public.kit_report_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  pdf_data BYTEA NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_kit_report_cache_subscription UNIQUE (subscription_id)
);

COMMENT ON TABLE public.kit_report_cache IS
  'Caches generated PDF reports for EXPIRED KIT subscriptions. One report per subscription. Active KIT reports are generated dynamically and not stored here.';

COMMENT ON COLUMN public.kit_report_cache.subscription_id IS
  'References the EXPIRED KIT subscription this cached report belongs to. Unique constraint ensures one report per subscription.';

COMMENT ON COLUMN public.kit_report_cache.pdf_data IS
  'The generated PDF document stored as binary data.';

COMMENT ON COLUMN public.kit_report_cache.generated_at IS
  'Timestamp when this PDF report was generated and cached.';

-- ============================================================================
-- 2. PARTIAL UNIQUE INDEX — at-most-one PENDING/ACTIVE per customer+category
-- ============================================================================
-- Enforces the business rule (Req 11.2, 11.3, 11.4) that at most one
-- non-terminal KIT subscription exists per customer at any given time.
-- This prevents creating a new PENDING subscription when one already exists,
-- and prevents activating a new KIT when another is still ACTIVE.
--
-- The partial index only covers rows with status IN ('PENDING', 'ACTIVE'),
-- so multiple EXPIRED subscriptions per customer are allowed (Req 11.1, 11.5).

CREATE UNIQUE INDEX IF NOT EXISTS uq_active_subscription_per_category
  ON public.subscriptions (customer_profile_id, customer_category)
  WHERE status IN ('PENDING', 'ACTIVE');

-- ============================================================================
-- DONE. The database now supports:
--   - Multiple KIT subscriptions per customer (historical EXPIRED records retained)
--   - At-most-one PENDING/ACTIVE KIT subscription per customer (enforced at DB level)
--   - PDF report caching for expired KIT subscriptions
--
-- Next steps:
--   - Task 1.2: Create KIT lifecycle TypeScript types
--   - Task 1.3: Create Zod validation schemas
-- ============================================================================
