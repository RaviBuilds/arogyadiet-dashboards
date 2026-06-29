-- ============================================================================
-- MULTI-TENANT FRANCHISE — Franchise Agreement Documents (SAFE: Additive only)
-- ============================================================================
-- Spec: multi-tenant-franchise — Task 1.3 — Requirements 7.1, 7.2, 7.8
--
-- Stores metadata for franchise agreement documents (signed contracts, etc.).
-- The actual file bytes live in the PRIVATE Supabase Storage bucket
-- `franchise-documents`, keyed by path `{franchise_id}/...`. This table only
-- records the storage path plus validated metadata so the application can list,
-- authorize, and generate signed URLs for downloads (Req 7.1, 7.2, 7.8).
--
-- Creates:
--   1. franchise_agreement_documents (new) — one row per uploaded document
--
-- Enforces:
--   - content_type CHECK IN ('application/pdf','image/jpeg','image/png') (Req 7.2)
--   - size_bytes <= 10485760 (10 MB upload cap) (Req 7.2)
--   - franchise_id NOT NULL -> public.franchises(id)
--
-- Safety: Brand new table; no existing data is dropped or altered. Idempotent
-- (re-runnable) via CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
--
-- Rollback:
--   DROP TABLE IF EXISTS public.franchise_agreement_documents;
-- ============================================================================

-- ============================================================================
-- 1. FRANCHISE_AGREEMENT_DOCUMENTS (new) — Requirements 7.1, 7.2, 7.8
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.franchise_agreement_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  franchise_id UUID NOT NULL REFERENCES public.franchises(id),
  storage_path TEXT NOT NULL,                 -- path within the `franchise-documents` bucket: {franchise_id}/...
  file_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL
    CHECK (content_type IN ('application/pdf', 'image/jpeg', 'image/png')),  -- Req 7.2
  size_bytes BIGINT NOT NULL
    CHECK (size_bytes <= 10485760),           -- 10 MB upload cap (Req 7.2)
  uploaded_by UUID REFERENCES public.users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agreement_docs_franchise
  ON public.franchise_agreement_documents(franchise_id);

-- ============================================================================
-- STORAGE NOTE (Req 7.1, 7.8):
--   Document bytes are NOT stored in this table. They live in the PRIVATE
--   Supabase Storage bucket `franchise-documents`, under the per-franchise
--   prefix `{franchise_id}/...`. Because the bucket is private, downloads must
--   go through short-lived signed URLs generated server-side after an access
--   check; `storage_path` above is the object key used to issue those URLs.
-- ============================================================================
COMMENT ON TABLE public.franchise_agreement_documents IS
  'Metadata for franchise agreement documents. File bytes are stored in the private Supabase Storage bucket `franchise-documents` under the path `{franchise_id}/...`; storage_path is the object key used to issue signed download URLs.';

-- ============================================================================
-- DONE. New table is additive; no existing schema is altered. Idempotent.
-- ============================================================================
