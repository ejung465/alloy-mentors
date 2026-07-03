-- ============================================================================
-- Alloy Tutors — Migration 0015: multi-org licensing
-- Makes the app generic across licensed organizations (ITB is just the first).
--   • Per-org JOIN CODES (member + student) so each licensed org onboards its
--     own people — replaces the hard-coded ITB-M / ITB-S in lib/org.ts.
--   • Per-org MEMBER LABEL (noun) so each org calls its people what it wants
--     (Tutor / Volunteer / Mentor). DB role stays 'member'/'volunteer'; this is
--     display copy only.
--   • resolve_org_code() RPC: anon-callable (onboarding is pre-auth) code lookup,
--     SECURITY DEFINER so it never exposes the whole organizations table.
-- Run after 0001–0014. Safe to re-run.
-- ============================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS member_code        text,
  ADD COLUMN IF NOT EXISTS student_code       text,
  ADD COLUMN IF NOT EXISTS member_noun        text NOT NULL DEFAULT 'Tutor',
  ADD COLUMN IF NOT EXISTS member_noun_plural text NOT NULL DEFAULT 'Tutors';

-- Join codes are unique across all orgs, case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS organizations_member_code_key
  ON public.organizations (upper(member_code)) WHERE member_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS organizations_student_code_key
  ON public.organizations (upper(student_code)) WHERE student_code IS NOT NULL;

-- Backfill the example org (ITB). ITB calls its tutors "Mentors".
UPDATE public.organizations
   SET member_code        = COALESCE(member_code, 'ITB-M'),
       student_code       = COALESCE(student_code, 'ITB-S'),
       member_noun        = 'Mentor',
       member_noun_plural = 'Mentors'
 WHERE access_code = 'ITB';

-- ── Anon-callable code lookup ───────────────────────────────────────────────
-- Onboarding runs before the user authenticates, so this must be reachable by
-- the anon role. SECURITY DEFINER + a narrow return shape means anon can resolve
-- a code they already hold, but cannot enumerate the organizations table.
CREATE OR REPLACE FUNCTION public.resolve_org_code(p_code text)
RETURNS TABLE (org_id uuid, org_name text, role text, member_noun text, member_noun_plural text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id, name, 'member'::text, member_noun, member_noun_plural
    FROM public.organizations
   WHERE member_code IS NOT NULL AND upper(member_code) = upper(trim(p_code))
  UNION ALL
  SELECT id, name, 'student'::text, member_noun, member_noun_plural
    FROM public.organizations
   WHERE student_code IS NOT NULL AND upper(student_code) = upper(trim(p_code))
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_org_code(text) TO anon, authenticated;

-- ── Let a signed-in member read their OWN org (for name + label) ─────────────
-- current_org_id() is SECURITY DEFINER (migration 0006), so this does not recurse.
DROP POLICY IF EXISTS organizations_read_own ON public.organizations;
CREATE POLICY organizations_read_own ON public.organizations
  FOR SELECT TO authenticated
  USING (id = public.current_org_id());
