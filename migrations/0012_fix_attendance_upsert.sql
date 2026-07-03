-- ============================================================================
-- Alloy — Migration 0012: Fix check-in upsert ON CONFLICT
--
-- Symptom: scanning a volunteer at the kiosk → "there is no unique or exclusion
-- constraint matching the ON CONFLICT specification".
-- Cause: session_attendance had PARTIAL unique indexes (WHERE ..._id IS NOT NULL).
-- PostgREST's upsert sends `ON CONFLICT (session_id, volunteer_id)` with no WHERE
-- predicate, so Postgres can't match a partial index. Replace them with plain
-- (non-partial) unique indexes — NULLs are still distinct, so multiple student
-- rows (volunteer_id NULL) and multiple volunteer rows (student_id NULL) coexist.
--
-- Run after 0003. Safe to re-run.
-- ============================================================================

DROP INDEX IF EXISTS public.uniq_att_vol;
DROP INDEX IF EXISTS public.uniq_att_stu;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_att_vol
  ON public.session_attendance (session_id, volunteer_id);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_att_stu
  ON public.session_attendance (session_id, student_id);

-- Realtime on attendance so the volunteer's app can auto-surface "My Student"
-- the moment they're paired. Idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'session_attendance'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.session_attendance;
  END IF;
END $$;
