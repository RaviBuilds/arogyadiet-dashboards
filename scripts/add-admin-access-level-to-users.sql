-- ============================================================================
-- ADD admin_access_level TO USERS TABLE — (SAFE: Nullable column only)
-- ============================================================================
-- Sub-classification of the ADMIN role. NULL for non-admins and for existing
-- admins (resolved as full access 'inventory_operations' at runtime).
--
-- Existing users (ADMIN, MASTER_ADMIN, RIDER, CUSTOMER, FRANCHISE_ADMIN) keep
-- NULL — no impact. Only ADMIN users assigned a level by a Master Admin will
-- carry a non-null admin_access_level.
--
-- Rollback:
--   ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_admin_access_level_check;
--   DROP INDEX IF EXISTS idx_users_admin_access_level;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS admin_access_level;
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS admin_access_level TEXT DEFAULT NULL;

-- Enforce the enum at the DB layer (idempotent: drop-then-add).
ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_admin_access_level_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_admin_access_level_check
  CHECK (
    admin_access_level IS NULL
    OR admin_access_level IN ('inventory', 'operations', 'inventory_operations')
  );

CREATE INDEX IF NOT EXISTS idx_users_admin_access_level
  ON public.users(admin_access_level);

-- Optional explicit backfill (runtime default already covers this):
-- UPDATE public.users u SET admin_access_level = 'inventory_operations'
--   FROM public.roles r
--  WHERE u.role_id = r.id AND r.code = 'ADMIN' AND u.admin_access_level IS NULL;
