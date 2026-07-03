-- ============================================================================
-- Alloy — Migration 0001: Roles & Organization foundation
--
-- ⚠️ RUN IN TWO STEPS. Postgres will not let a newly-added enum value be USED
--    in the same transaction it was created in ("unsafe use of new value").
--    The Supabase SQL editor runs your selection as one transaction, so:
--
--    STEP 1 → select & run ONLY the "PART 1" block. Wait for success.
--    STEP 2 → select & run the "PART 2" block.
--
--    Both parts are safe to re-run.
-- ============================================================================


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ PART 1 — add the new role values (run this alone first, let it commit)    │
-- └──────────────────────────────────────────────────────────────────────────┘
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'member';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'director';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'vp';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'president';


-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │ PART 2 — everything else (run after PART 1 has succeeded)                 │
-- └──────────────────────────────────────────────────────────────────────────┘

-- Migrate legacy volunteers ('mentor') to the new 'member' tier
UPDATE public.users SET role = 'member' WHERE role = 'mentor';

-- New profile columns
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS director_subject text; -- 'Math','Music','English' for board directors
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS title text;

-- Seed the launch organization
INSERT INTO public.organizations (name, access_code)
VALUES ('ITB', 'ITB')
ON CONFLICT (access_code) DO NOTHING;

-- Role-management helpers + RLS (idempotent): members read others in their org,
-- update their own profile; leadership (admin/president/vp) can update roles.
-- SECURITY DEFINER is REQUIRED: these are used inside the users RLS policies,
-- so their internal SELECT on users must bypass RLS or it recurses infinitely.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT organization_id FROM public.users WHERE id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION public.is_leadership()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role IN ('admin','president','vp')
  )
$$;

DROP POLICY IF EXISTS users_select_same_org ON public.users;
CREATE POLICY users_select_same_org ON public.users
  FOR SELECT USING (organization_id = public.current_org_id() OR id = auth.uid());

DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users
  FOR UPDATE USING (id = auth.uid());

DROP POLICY IF EXISTS users_update_by_leadership ON public.users;
CREATE POLICY users_update_by_leadership ON public.users
  FOR UPDATE USING (public.is_leadership() AND organization_id = public.current_org_id());
