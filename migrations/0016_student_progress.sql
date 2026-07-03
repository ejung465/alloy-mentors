-- ============================================================================
-- Alloy Tutors — Migration 0016: student progress & outcomes
-- Turns the app from an hour-tracker into a tutoring-relationship OS. Each
-- student gets learning GOALS (with checkpoints), a SKILLS map, and a GROWTH
-- TIMELINE built from session notes. This is the licensing differentiator —
-- coordinators can finally answer "are the kids actually learning?".
-- Run after 0001–0015. Safe to re-run.
-- ============================================================================

-- ── Goals — what a student is working toward ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_goals (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id            uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  organization_id       uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  title                 text NOT NULL,
  subject               text,
  status                text NOT NULL DEFAULT 'active',   -- active | achieved | paused
  target_checkpoints    int  NOT NULL DEFAULT 10,
  completed_checkpoints int  NOT NULL DEFAULT 0,
  created_by            uuid REFERENCES public.users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  achieved_at           timestamptz
);
CREATE INDEX IF NOT EXISTS student_goals_student_idx ON public.student_goals(student_id);

-- ── Skills — a mastery map (0 not started → 3 mastered) ─────────────────────
CREATE TABLE IF NOT EXISTS public.student_skills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id      uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  level           int  NOT NULL DEFAULT 0,   -- 0 not started, 1 learning, 2 practicing, 3 mastered
  updated_by      uuid REFERENCES public.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, name)
);
CREATE INDEX IF NOT EXISTS student_skills_student_idx ON public.student_skills(student_id);

-- ── Growth timeline — enrich the existing session notes ─────────────────────
-- A note can now carry a headline, a progress "marker" (drives the timeline dot
-- colour), and a link to the goal it advanced. Existing notes stay valid (nulls).
ALTER TABLE public.student_notes
  ADD COLUMN IF NOT EXISTS title   text,
  ADD COLUMN IF NOT EXISTS marker  text,   -- breakthrough | progress | struggled | milestone
  ADD COLUMN IF NOT EXISTS goal_id uuid REFERENCES public.student_goals(id) ON DELETE SET NULL;

-- ── RLS — any member of the org can read + record progress for its students ──
ALTER TABLE public.student_goals  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_goals_rw ON public.student_goals;
CREATE POLICY student_goals_rw ON public.student_goals FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

DROP POLICY IF EXISTS student_skills_rw ON public.student_skills;
CREATE POLICY student_skills_rw ON public.student_skills FOR ALL TO authenticated
  USING (organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());
