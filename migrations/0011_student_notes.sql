-- ============================================================================
-- Alloy — Migration 0011: Student session notes (progress log)
-- A running log per student: volunteers add an end-of-session note; any member
-- can read the history with author + date. Run after 0001–0010. Safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.student_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id  uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  session_id  uuid REFERENCES public.sessions(id) ON DELETE SET NULL,
  author_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  author_name text,                       -- denormalized for display
  content     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_student_notes_student ON public.student_notes (student_id, created_at DESC);

ALTER TABLE public.student_notes ENABLE ROW LEVEL SECURITY;

-- Any authenticated member can read the log (same openness as the roster).
DROP POLICY IF EXISTS student_notes_select ON public.student_notes;
CREATE POLICY student_notes_select ON public.student_notes
  FOR SELECT TO authenticated USING (true);

-- Members can add notes as themselves.
DROP POLICY IF EXISTS student_notes_insert ON public.student_notes;
CREATE POLICY student_notes_insert ON public.student_notes
  FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());

-- Authors can edit / delete their own notes.
DROP POLICY IF EXISTS student_notes_update ON public.student_notes;
CREATE POLICY student_notes_update ON public.student_notes
  FOR UPDATE TO authenticated USING (author_id = auth.uid());

DROP POLICY IF EXISTS student_notes_delete ON public.student_notes;
CREATE POLICY student_notes_delete ON public.student_notes
  FOR DELETE TO authenticated USING (author_id = auth.uid());

ALTER PUBLICATION supabase_realtime ADD TABLE public.student_notes;
