-- ============================================================================
-- Alloy — Migration 0003: Students, Check-in & Matching
-- Run as ONE block in Supabase → SQL Editor (after 0001 & 0002). Safe to re-run.
-- ============================================================================

-- 1) Roster students (NOT tied to auth — many students have no device) -------
CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  grade text,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL, -- linked account, if any
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_students_org ON public.students (organization_id);

ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS students_rw ON public.students;
CREATE POLICY students_rw ON public.students
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2) Session attendance (volunteers + students, with pairing) ----------------
CREATE TABLE IF NOT EXISTS public.session_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('volunteer','student')),
  volunteer_id uuid REFERENCES public.users(id) ON DELETE CASCADE,    -- when kind='volunteer'
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,   -- when kind='student'
  paired_volunteer_id uuid REFERENCES public.users(id) ON DELETE SET NULL, -- matched volunteer for a student
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  checked_in_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- one volunteer / one student row per session
CREATE UNIQUE INDEX IF NOT EXISTS uniq_att_vol ON public.session_attendance (session_id, volunteer_id) WHERE volunteer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_att_stu ON public.session_attendance (session_id, student_id) WHERE student_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_att_session ON public.session_attendance (session_id);

ALTER TABLE public.session_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS att_rw ON public.session_attendance;
CREATE POLICY att_rw ON public.session_attendance
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 3) Matching: best volunteer for a student ----------------------------------
-- Among volunteers CHECKED IN for this session, choose:
--   1. fewest students already paired to them THIS session (load balance), then
--   2. most past pairings with THIS student (familiarity), then
--   3. earliest checked in.
CREATE OR REPLACE FUNCTION public.get_best_volunteer(p_session_id uuid, p_student_id uuid)
RETURNS uuid
LANGUAGE sql STABLE AS $$
  WITH checked_in AS (
    SELECT a.volunteer_id, a.checked_in_at
    FROM public.session_attendance a
    WHERE a.session_id = p_session_id
      AND a.kind = 'volunteer'
      AND a.volunteer_id IS NOT NULL
  ),
  scored AS (
    SELECT
      ci.volunteer_id,
      ci.checked_in_at,
      (SELECT COUNT(*) FROM public.session_attendance s
         WHERE s.session_id = p_session_id
           AND s.kind = 'student'
           AND s.paired_volunteer_id = ci.volunteer_id) AS current_load,
      (SELECT COUNT(*) FROM public.session_attendance h
         WHERE h.kind = 'student'
           AND h.student_id = p_student_id
           AND h.paired_volunteer_id = ci.volunteer_id) AS history
    FROM checked_in ci
  )
  SELECT volunteer_id
  FROM scored
  ORDER BY current_load ASC, history DESC, checked_in_at ASC
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_best_volunteer(uuid, uuid) TO authenticated;

-- 4) Auto-set organization_id on attendance from the session -----------------
CREATE OR REPLACE FUNCTION public.set_attendance_org()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT organization_id INTO NEW.organization_id FROM public.sessions WHERE id = NEW.session_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_att_org ON public.session_attendance;
CREATE TRIGGER trg_att_org BEFORE INSERT ON public.session_attendance
  FOR EACH ROW EXECUTE FUNCTION public.set_attendance_org();
