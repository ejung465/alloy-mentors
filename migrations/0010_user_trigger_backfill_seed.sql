-- ============================================================================
-- Alloy — Migration 0010: Fix missing profile rows + seed example data
--
-- Root cause of "students_created_by_fkey violation" + name-not-loading + the
-- 0008 admin promotion doing nothing: there was NO trigger creating a
-- public.users row when an auth user signs up, so existing accounts have no
-- profile row. This adds the trigger, backfills existing users, and seeds
-- example students / sessions / an announcement.
--
-- Run after 0001–0009. Safe to re-run.
-- ============================================================================

-- 1) Auto-create a public.users row for every new auth user ------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data->>'full_name', ''), split_part(NEW.email, '@', 1)),
    COALESCE(
      (CASE WHEN NEW.raw_user_meta_data->>'role' IN
            ('admin','president','vp','director','member','mentor','student')
        THEN (NEW.raw_user_meta_data->>'role')::user_role END),
      'member'
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2) Backfill profile rows for existing auth users that have none ------------
INSERT INTO public.users (id, email, full_name, role)
SELECT u.id, u.email,
       COALESCE(NULLIF(u.raw_user_meta_data->>'full_name', ''), split_part(u.email, '@', 1)),
       COALESCE(
         (CASE WHEN u.raw_user_meta_data->>'role' IN
               ('admin','president','vp','director','member','mentor','student')
           THEN (u.raw_user_meta_data->>'role')::user_role END),
         'member'
       )
FROM auth.users u
LEFT JOIN public.users p ON p.id = u.id
WHERE p.id IS NULL
ON CONFLICT (id) DO NOTHING;

-- 3) Make the demo account a full admin in ITB (now that the row exists) -----
UPDATE public.users
SET role = 'admin',
    organization_id = (SELECT id FROM public.organizations WHERE access_code = 'ITB' LIMIT 1),
    full_name = COALESCE(NULLIF(full_name, ''), 'ITB Admin')
WHERE email = 'jpx465.co+demo@gmail.com';

-- 4) Seed example students (created_by left NULL so no user dependency) ------
INSERT INTO public.students
  (organization_id, full_name, grade, school, language, subjects_help, english_level,
   interpreter_needed, allergies, emergency_contact_name, emergency_contact_phone,
   guardian_name, guardian_relationship, guardian_phone, active)
SELECT o.id, v.full_name, v.grade, v.school, v.language, v.subjects, v.english_level,
       v.interpreter, v.allergies, v.em_name, v.em_phone, v.g_name, v.g_rel, v.g_phone, true
FROM public.organizations o
CROSS JOIN (VALUES
  ('Amir Hassan',   '5th Grade', 'Lincoln Elementary', 'Dari',     ARRAY['Math','English / Reading'], 'Beginner',     true,  'Peanuts',  'Fatima Hassan',  '(555) 200-1001', 'Fatima Hassan',  'Mother', '(555) 200-1001'),
  ('Lina Okafor',   '8th Grade', 'Jefferson Middle',    'Swahili',  ARRAY['Science','Math'],            'Intermediate', false, 'None',     'Joseph Okafor',  '(555) 200-1002', 'Joseph Okafor',  'Uncle',  '(555) 200-1002'),
  ('Yusuf Ali',     '3rd Grade', 'Lincoln Elementary',  'Arabic',   ARRAY['English / Reading','ESL'],   'Newcomer',     true,  'Tree nuts','Mariam Ali',     '(555) 200-1003', 'Mariam Ali',     'Mother', '(555) 200-1003'),
  ('Sara Petrov',   '10th Grade','Central High',        'Ukrainian',ARRAY['Math','Test Prep'],          'Advanced',     false, 'None',     'Olena Petrov',   '(555) 200-1004', 'Olena Petrov',   'Mother', '(555) 200-1004')
) AS v(full_name, grade, school, language, subjects, english_level, interpreter, allergies, em_name, em_phone, g_name, g_rel, g_phone)
WHERE o.access_code = 'ITB'
  AND NOT EXISTS (SELECT 1 FROM public.students s WHERE s.full_name = v.full_name AND s.organization_id = o.id);

-- 5) Seed example upcoming sessions ------------------------------------------
INSERT INTO public.sessions (organization_id, title, description, location, start_time, end_time)
SELECT o.id, v.title, v.descr, v.loc, v.starts::timestamptz, v.ends::timestamptz
FROM public.organizations o
CROSS JOIN (VALUES
  ('Wednesday Evening Tutoring', 'Mid-week homework help and ESL practice.', 'Community Library, Room 2', '2026-06-24T17:30:00-04:00', '2026-06-24T19:30:00-04:00'),
  ('Saturday Tutoring — Riverside Park', 'Weekly refugee student tutoring at the pavilion.', 'Riverside Park Pavilion, Main St', '2026-06-27T10:00:00-04:00', '2026-06-27T12:30:00-04:00')
) AS v(title, descr, loc, starts, ends)
WHERE o.access_code = 'ITB'
  AND NOT EXISTS (SELECT 1 FROM public.sessions s WHERE s.title = v.title AND s.start_time = v.starts::timestamptz);

-- 6) Seed a welcome announcement (created_by must be a real auth user) -------
INSERT INTO public.announcements (title, message, urgency, created_by)
SELECT 'Welcome to Alloy', 'Our new volunteer hub is live — RSVP for this Saturday''s session at Riverside Park, and update your profile when you get a chance.', 'info', u.id
FROM auth.users u
WHERE u.email = 'jpx465.co+demo@gmail.com'
  AND NOT EXISTS (SELECT 1 FROM public.announcements a WHERE a.title = 'Welcome to Alloy');
