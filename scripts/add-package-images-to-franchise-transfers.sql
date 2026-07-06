-- ============================================================================
-- ADD package_image_paths COLUMN TO franchise_stock_transfers
-- ============================================================================
-- Stores the Supabase storage paths of package images uploaded by the
-- warehouse admin when dispatching products to a franchise.
--
-- Images are optional (nullable) and stored as an array of text paths.
-- A maximum of 10 images per batch dispatch is enforced at the application level.
--
-- Images are auto-deleted 10 days after the franchise confirms receipt
-- (received_at + 10 days) via a scheduled cron job.
--
-- STORAGE BUCKET TO CREATE IN SUPABASE:
--   Name: franchise-dispatch-images
--   Type: PRIVATE (signed URLs used for access, auto-expiry after 10 days)
--
-- Safety: additive only — adds a nullable column, no data loss.
-- Idempotent (re-runnable).
--
-- ORDERING: Run AFTER create-franchise-stock-transfers-tables.sql
-- ============================================================================

ALTER TABLE public.franchise_stock_transfers
  ADD COLUMN IF NOT EXISTS package_image_paths TEXT[] DEFAULT NULL;

COMMENT ON COLUMN public.franchise_stock_transfers.package_image_paths IS
  'Array of Supabase storage paths for package verification images. Nullable. Max 10 images per transfer batch. Auto-deleted 10 days after received_at.';

-- ============================================================================
-- DONE.
-- After running this migration, create the storage bucket in Supabase Dashboard:
--   Bucket name: franchise-dispatch-images
--   Public: NO (private)
--   File size limit: 5MB
--   Allowed MIME types: image/jpeg, image/png, image/webp
-- ============================================================================
