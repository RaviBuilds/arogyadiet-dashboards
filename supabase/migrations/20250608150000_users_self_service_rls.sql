-- Self-service RLS for public.users: authenticated users may read/update only their own row.
-- Service role bypasses RLS. Column trigger blocks privilege escalation on self-update.

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_select_own" ON public.users;
CREATE POLICY "users_select_own"
  ON public.users
  FOR SELECT
  TO authenticated
  USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "users_update_own" ON public.users;
CREATE POLICY "users_update_own"
  ON public.users
  FOR UPDATE
  TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- Allow authenticated users to resolve role labels (e.g. admin layout join).
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "roles_select_authenticated" ON public.roles;
CREATE POLICY "roles_select_authenticated"
  ON public.roles
  FOR SELECT
  TO authenticated
  USING (true);

CREATE OR REPLACE FUNCTION public.protect_users_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(
    current_setting('request.jwt.claim.role', true),
    current_setting('role', true)
  ) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.auth_user_id IS DISTINCT FROM OLD.auth_user_id
     OR NEW.role_id IS DISTINCT FROM OLD.role_id
     OR NEW.email IS DISTINCT FROM OLD.email
     OR NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.force_password_change IS DISTINCT FROM OLD.force_password_change
     OR NEW.is_email_verified IS DISTINCT FROM OLD.is_email_verified
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.updated_by IS DISTINCT FROM OLD.updated_by
  THEN
    RAISE EXCEPTION 'Unauthorized field change on users table';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_users_self_update_trigger ON public.users;
CREATE TRIGGER protect_users_self_update_trigger
  BEFORE UPDATE ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_users_self_update();
