-- ============================================================================
-- Alloy — Migration 0002: Sessions + RSVP
-- Run in Supabase → SQL Editor. Safe to re-run.
-- ============================================================================

-- 1) Session columns ---------------------------------------------------------
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS location text;
ALTER TABLE public.sessions ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- 2) RSVP table --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.session_rsvps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('going','not_going')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT session_rsvps_unique UNIQUE (session_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_rsvp_session ON public.session_rsvps (session_id);

ALTER TABLE public.session_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rsvp_select_all ON public.session_rsvps;
CREATE POLICY rsvp_select_all ON public.session_rsvps
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rsvp_upsert_self ON public.session_rsvps;
CREATE POLICY rsvp_upsert_self ON public.session_rsvps
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS rsvp_update_self ON public.session_rsvps;
CREATE POLICY rsvp_update_self ON public.session_rsvps
  FOR UPDATE TO authenticated USING (user_id = auth.uid());

-- 3) Let leadership / directors create & edit sessions -----------------------
-- (reuses is_leadership() from migration 0001; here we allow directors too)
CREATE OR REPLACE FUNCTION public.can_create_events()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin','president','vp','director')
  )
$$;

DROP POLICY IF EXISTS sessions_select_all ON public.sessions;
CREATE POLICY sessions_select_all ON public.sessions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS sessions_insert_elevated ON public.sessions;
CREATE POLICY sessions_insert_elevated ON public.sessions
  FOR INSERT TO authenticated WITH CHECK (public.can_create_events());

DROP POLICY IF EXISTS sessions_update_elevated ON public.sessions;
CREATE POLICY sessions_update_elevated ON public.sessions
  FOR UPDATE TO authenticated USING (public.can_create_events());

DROP POLICY IF EXISTS sessions_delete_elevated ON public.sessions;
CREATE POLICY sessions_delete_elevated ON public.sessions
  FOR DELETE TO authenticated USING (public.can_create_events());
