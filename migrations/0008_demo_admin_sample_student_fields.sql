-- ============================================================================
-- Alloy — Migration 0008: Demo admin, sample session, richer student profiles
-- Run in Supabase → SQL Editor after 0001–0007. Safe to re-run.
-- ============================================================================

-- 1) Promote the demo account to full admin (all-access) ---------------------
UPDATE public.users
SET role = 'admin'
WHERE email = 'jpx465.co+demo@gmail.com';

-- 2) Seed a sample session for Saturday, June 20 2026 ------------------------
INSERT INTO public.sessions (organization_id, title, description, location, start_time, end_time)
SELECT
  o.id,
  'Saturday Tutoring — Riverside Park',
  'Weekly refugee student tutoring. Volunteers check in by QR at the pavilion; students by name. Bring your subject materials.',
  'Riverside Park Pavilion, Main St',
  '2026-06-20T10:00:00-04:00',
  '2026-06-20T12:30:00-04:00'
FROM public.organizations o
WHERE o.access_code = 'ITB'
  AND NOT EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.title = 'Saturday Tutoring — Riverside Park'
      AND s.start_time = '2026-06-20T10:00:00-04:00'
  );

-- 3) Richer student profile columns -----------------------------------------
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS school          text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS birthday        date;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS photo_url       text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS gender          text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS language        text;   -- home / preferred language
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS guardian_name   text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS guardian_phone  text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS notes           text;   -- allergies, accommodations, etc.

-- 4) Public storage bucket for student photos -------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('student-photos', 'student-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies (authenticated users in the org can upload; anyone can read
-- since the bucket is public and these are roster photos inside the app).
DROP POLICY IF EXISTS "student_photos_insert" ON storage.objects;
CREATE POLICY "student_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'student-photos');

DROP POLICY IF EXISTS "student_photos_update" ON storage.objects;
CREATE POLICY "student_photos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'student-photos');

DROP POLICY IF EXISTS "student_photos_read" ON storage.objects;
CREATE POLICY "student_photos_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'student-photos');
