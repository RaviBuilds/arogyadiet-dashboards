-- In-app notifications table (RLS policies in 20250605140000_notifications_rls.sql)

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  action_url text,
  is_read boolean NOT NULL DEFAULT false,
  type text NOT NULL DEFAULT 'SYSTEM',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_user_id_created_at_idx
  ON public.notifications (user_id, created_at DESC);
