-- ============================================================================
-- Alloy — Migration 0028: student self-view feedback + attendance read
-- Backs two feature modules already registered in lib/features.ts:
--   • student_self_view  — a student sees their own progress + attendance
--   • student_feedback    — a student reacts to a growth-timeline entry
-- Run after 0001–0025. Safe to re-run (idempotent).
-- ============================================================================

-- ── 1. Feedback: a lightweight per-note reaction from the student ───────────
-- Lives on the SAME student_notes (growth-timeline) row the reaction is about.
-- Free-form text but the app only ever writes 'got_it' | 'confused' | 'in_between'.
ALTER TABLE public.student_notes
  ADD COLUMN IF NOT EXISTS student_reaction text;

-- The linked student is NOT the note's author, so the existing
-- student_notes_update policy (author_id = auth.uid()) rightly blocks them from
-- rewriting a mentor's note. Expose ONLY the reaction column through a
-- SECURITY DEFINER function that verifies the caller is the linked student.
CREATE OR REPLACE FUNCTION public.set_student_reaction(p_note_id uuid, p_reaction text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only accept the three known reactions (or NULL to clear).
  IF p_reaction IS NOT NULL AND p_reaction NOT IN ('got_it', 'confused', 'in_between') THEN
    RAISE EXCEPTION 'invalid reaction: %', p_reaction;
  END IF;

  UPDATE public.student_notes n
     SET student_reaction = p_reaction
    FROM public.students s
   WHERE n.id = p_note_id
     AND n.student_id = s.id
     AND s.user_id = auth.uid();   -- caller must be the linked student
END;
$$;

REVOKE ALL ON FUNCTION public.set_student_reaction(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.set_student_reaction(uuid, text) TO authenticated;

-- ── 2. Self-view attendance: let a linked student read their OWN rows ───────
-- attendance_select (0020) is scoped to non-students; add a permissive policy
-- (policies are OR'd) so a student can read the attendance history for the
-- roster row linked to their account — and only that row.
DROP POLICY IF EXISTS attendance_select_self ON public.session_attendance;
CREATE POLICY attendance_select_self ON public.session_attendance
  FOR SELECT TO authenticated
  USING (
    kind = 'student'
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = session_attendance.student_id
        AND s.user_id = auth.uid()
    )
  );
