-- ============================================================================
-- Update Master Admin credentials (email + password)
-- ----------------------------------------------------------------------------
-- Target user (the single MASTER_ADMIN account):
--   auth.users.id      = ed36c377-1f29-4c6e-bba8-7c65915b86fc
--   public.users.id    = 43f7f950-2227-41b9-8052-923c40600188
--   current email      = master@blogspage.com
--   new email          = info@arogyadiet.com
--
-- HOW TO RUN:
--   Run this in the Supabase Dashboard -> SQL Editor (it runs as a privileged
--   role that can write to the auth schema). It will NOT work from the app's
--   normal client because of RLS / schema permissions.
--
-- BEFORE RUNNING:
--   1. Replace 'CHANGE_ME_STRONG_PASSWORD' below with the real new password.
--   2. The email is changed everywhere the app/GoTrue reads it:
--      auth.users, auth.identities, and the public.users mirror row.
--   3. Wrapped in a transaction so it is all-or-nothing.
-- ============================================================================

BEGIN;

-- pgcrypto provides crypt()/gen_salt() used to hash the password the same way
-- Supabase Auth (GoTrue) does (bcrypt). It ships installed in Supabase under
-- the "extensions" schema.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1) auth.users: email + bcrypt password hash --------------------------------
UPDATE auth.users
SET
  email             = 'info@arogyadiet.com',
  encrypted_password = extensions.crypt('Master-13@Arogya!', extensions.gen_salt('bf')),
  email_confirmed_at = COALESCE(email_confirmed_at, now()),
  updated_at        = now()
WHERE id = 'ed36c377-1f29-4c6e-bba8-7c65915b86fc';

-- 2) auth.identities: keep the email identity in sync ------------------------
-- NOTE: auth.identities.email is a GENERATED column (derived from
-- identity_data->>'email'), so we only update identity_data. The email
-- column updates itself automatically.
UPDATE auth.identities
SET
  identity_data = jsonb_set(identity_data, '{email}', '"info@arogyadiet.com"', true),
  updated_at    = now()
WHERE user_id = 'ed36c377-1f29-4c6e-bba8-7c65915b86fc'
  AND provider = 'email';

-- 3) public.users: app-level mirror row --------------------------------------
UPDATE public.users
SET
  email      = 'info@arogyadiet.com',
  updated_at = now()
WHERE auth_user_id = 'ed36c377-1f29-4c6e-bba8-7c65915b86fc';

-- Sanity check (review the output before COMMIT) -----------------------------
SELECT au.id              AS auth_id,
       au.email           AS auth_email,
       ai.email           AS identity_email,
       pu.email           AS app_email,
       pu.full_name,
       r.code             AS role_code
FROM auth.users au
LEFT JOIN auth.identities ai ON ai.user_id = au.id AND ai.provider = 'email'
LEFT JOIN public.users pu    ON pu.auth_user_id = au.id
LEFT JOIN public.roles r     ON r.id = pu.role_id
WHERE au.id = 'ed36c377-1f29-4c6e-bba8-7c65915b86fc';

COMMIT;
-- If the SELECT above does not look right, run ROLLBACK; instead of COMMIT;
