-- Prerequisites for get_best_mentor + kiosk.ts (run once in Supabase SQL editor)

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS location TEXT;

CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  check_in_time TIMESTAMPTZ,
  assigned_mentor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT attendance_event_user_unique UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_event_id ON public.attendance (event_id);
CREATE INDEX IF NOT EXISTS idx_attendance_event_status ON public.attendance (event_id, status);

-- Load-balanced mentor selection for Check-In Kiosk
CREATE OR REPLACE FUNCTION public.get_best_mentor(p_event_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  WITH checked_in_mentors AS (
    SELECT
      a.user_id AS mentor_id,
      a.check_in_time
    FROM public.attendance AS a
    INNER JOIN public.users AS u
      ON u.id = a.user_id
     AND u.role = 'mentor'
    WHERE a.event_id = p_event_id
      AND a.status = 'checked_in'
  ),
  load AS (
    SELECT
      c.mentor_id,
      c.check_in_time,
      (
        SELECT COUNT(*)::BIGINT
        FROM public.assignments AS asn
        WHERE asn.mentor_id = c.mentor_id
      ) AS student_count
    FROM checked_in_mentors AS c
  )
  SELECT mentor_id
  FROM load
  ORDER BY student_count ASC, check_in_time ASC NULLS LAST
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_best_mentor(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_best_mentor(UUID) TO service_role;
