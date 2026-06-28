-- ============================================================================
-- ADD admin_operations_access TO USERS TABLE — (SAFE: additive, idempotent)
-- ============================================================================
-- Feature: admin-access-control (Tasks 2.1, 2.2)
--
-- Per-group operations permissions layered on top of the `operations` access
-- level. Stored as JSONB on public.users. Shape (operations level only):
--
--   { "customers":     "manage" | "view",
--     "subscriptions": "manage" | "view",
--     "riders":        "manage" | "view",
--     "operations":    "manage" | "view",
--     "franchises":    "manage" | "view",
--     "shop_products": "manage" | "view" }
--
--   - Only the selected groups are present; each maps to exactly one permission.
--   - NULL for the `inventory` / `inventory_operations` levels and for every
--     non-admin user (MASTER_ADMIN, RIDER, CUSTOMER, FRANCHISE_ADMIN, ...).
--
-- JSON-shape validation is intentionally enforced in the server action /
-- resolver layer (resolveAccessConfiguration tolerates malformed data), so no
-- CHECK constraint is added on the JSONB column.
--
-- This migration also discards the prior flat access model by setting EVERY
-- existing ADMIN to full access ('inventory_operations') with no per-group
-- config, so no admin loses access during rollout. A Master Admin can then
-- reassign 'inventory' or 'operations' (with a per-group config) per admin.
--
-- Idempotent: re-running yields the same column + the same admin state.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_users_admin_operations_access;
--   ALTER TABLE public.users DROP COLUMN IF EXISTS admin_operations_access;
-- ============================================================================

-- 1) Additive column (Task 2.1) -------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS admin_operations_access JSONB DEFAULT NULL;

-- Optional supporting index for membership/containment queries on the config.
CREATE INDEX IF NOT EXISTS idx_users_admin_operations_access
  ON public.users USING GIN (admin_operations_access);

-- 2) Discard old model: set every existing ADMIN to full access (Task 2.2) -----
-- Idempotent: running again re-applies the same values.
UPDATE public.users u
   SET admin_access_level     = 'inventory_operations',
       admin_operations_access = NULL,
       updated_at             = NOW()
  FROM public.roles r
 WHERE u.role_id = r.id
   AND r.code = 'ADMIN';
