-- ============================================================================
-- Alloy — Migration 0019: self-serve organizations + feature modules
-- The platform pivot: anyone (Bob) can create an org in-app, get join codes,
-- and toggle the feature modules his program needs. Orgs also name BOTH sides
-- (member noun AND student noun — Tutor/Student, Coach/Athlete, Mentor/Mentee).
-- Student accounts can be linked to roster rows so a student (Sarah) sees her
-- own progress. Run after 0001–0018. Safe to re-run.
-- ============================================================================

-- ── Org shape: type, student vocabulary, feature toggles ────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS org_type            text NOT NULL DEFAULT 'volunteer',
  ADD COLUMN IF NOT EXISTS student_noun        text NOT NULL DEFAULT 'Student',
  ADD COLUMN IF NOT EXISTS student_noun_plural text NOT NULL DEFAULT 'Students',
  ADD COLUMN IF NOT EXISTS features            jsonb,
  ADD COLUMN IF NOT EXISTS created_by          uuid REFERENCES public.users(id);

-- Existing orgs (ITB) keep everything they already use: all modules on.
UPDATE public.organizations
   SET features = '{"hours":true,"checkin":true,"progress":true,"session_notes":true,"guardian_digests":true,"gamification":true}'::jsonb
 WHERE features IS NULL;

-- ── Link a student ACCOUNT (users row, role=student) to a roster row ────────
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS students_user_idx ON public.students(user_id);

-- ── Admins can update their own org (toggles, nouns, codes) ─────────────────
DROP POLICY IF EXISTS organizations_update_admin ON public.organizations;
CREATE POLICY organizations_update_admin ON public.organizations
  FOR UPDATE TO authenticated
  USING (
    id = public.current_org_id()
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.role IN ('admin', 'president', 'vp')
    )
  )
  WITH CHECK (id = public.current_org_id());

-- ── create_organization(): the self-serve entry point ───────────────────────
-- Called by a freshly signed-up, signed-in user. Creates the org with unique
-- join codes, makes the caller its admin, and returns the codes to share.
CREATE OR REPLACE FUNCTION public.create_organization(
  p_name                text,
  p_org_type            text DEFAULT 'volunteer',
  p_member_noun         text DEFAULT 'Tutor',
  p_member_noun_plural  text DEFAULT 'Tutors',
  p_student_noun        text DEFAULT 'Student',
  p_student_noun_plural text DEFAULT 'Students',
  p_features            jsonb DEFAULT NULL,
  p_admin_name          text DEFAULT NULL
)
RETURNS TABLE (org_id uuid, member_code text, student_code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_email  text;
  v_prefix text;
  v_mcode  text;
  v_scode  text;
  v_org    uuid;
  v_try    int := 0;
  -- no 0/O/1/I/L — codes get read aloud and typed on phones
  v_alpha  constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in before creating an organization'; END IF;
  IF length(trim(p_name)) < 2 OR length(trim(p_name)) > 60 THEN
    RAISE EXCEPTION 'Organization name must be 2-60 characters';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  -- Code prefix from the org name letters (APPLE → APP), padded if short.
  v_prefix := upper(regexp_replace(trim(p_name), '[^a-zA-Z0-9]', '', 'g'));
  v_prefix := rpad(substr(v_prefix, 1, 3), 3, 'X');

  -- Generate unique member/student codes: APP-M7K2 / APP-S4QN
  LOOP
    v_try := v_try + 1;
    v_mcode := v_prefix || '-M' ||
      substr(v_alpha, 1 + floor(random() * 31)::int, 1) ||
      substr(v_alpha, 1 + floor(random() * 31)::int, 1) ||
      substr(v_alpha, 1 + floor(random() * 31)::int, 1);
    v_scode := v_prefix || '-S' ||
      substr(v_alpha, 1 + floor(random() * 31)::int, 1) ||
      substr(v_alpha, 1 + floor(random() * 31)::int, 1) ||
      substr(v_alpha, 1 + floor(random() * 31)::int, 1);
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE upper(o.member_code) IN (v_mcode, v_scode)
         OR upper(o.student_code) IN (v_mcode, v_scode)
         OR upper(o.access_code)  IN (v_mcode, v_scode)
    );
    IF v_try > 25 THEN RAISE EXCEPTION 'Could not generate unique join codes — try again'; END IF;
  END LOOP;

  INSERT INTO public.organizations
    (name, access_code, org_type, member_code, student_code,
     member_noun, member_noun_plural, student_noun, student_noun_plural,
     features, created_by)
  VALUES
    (trim(p_name), v_mcode, p_org_type, v_mcode, v_scode,
     coalesce(nullif(trim(p_member_noun), ''), 'Tutor'),
     coalesce(nullif(trim(p_member_noun_plural), ''), 'Tutors'),
     coalesce(nullif(trim(p_student_noun), ''), 'Student'),
     coalesce(nullif(trim(p_student_noun_plural), ''), 'Students'),
     coalesce(p_features, '{"hours":true,"checkin":true,"progress":true,"session_notes":true,"guardian_digests":true,"gamification":true}'::jsonb),
     v_uid)
  RETURNING id INTO v_org;

  -- The creator becomes the org's admin (user row may or may not exist yet).
  INSERT INTO public.users (id, email, full_name, role, organization_id)
  VALUES (v_uid, coalesce(v_email, ''), coalesce(nullif(trim(p_admin_name), ''), 'Admin'), 'admin', v_org)
  ON CONFLICT (id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        role = 'admin',
        full_name = CASE WHEN nullif(trim(p_admin_name), '') IS NOT NULL
                         THEN trim(p_admin_name) ELSE public.users.full_name END;

  RETURN QUERY SELECT v_org, v_mcode, v_scode;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_organization(text, text, text, text, text, text, jsonb, text) TO authenticated;
