-- ============================================================================
-- Alloy — Migration 0023: security hardening
--
-- Closes holes found in an adversarial RLS review. The headline (#1) is a
-- full privilege-escalation + cross-tenant breach: the 0020 self-update
-- policy let any user rewrite their OWN role/organization_id, so a student
-- could `UPDATE users SET role='admin', organization_id='<any org uuid>'`
-- (org UUIDs are handed out by resolve_org_code) and instantly read another
-- program's minor roster PII. Run after 0001–0022. Safe to re-run.
-- ============================================================================

-- ── #1: block users from escalating their OWN role / switching org ──────────
-- Kept as a trigger because Postgres RLS can't do per-column WITH CHECK. The
-- self-update policy stays (users edit their own name/phone/etc), but this
-- trigger silently reverts role/organization_id changes to a user's own row
-- unless a trusted path opts in via the app.allow_role_change GUC.
CREATE OR REPLACE FUNCTION public.guard_user_self_escalation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() = OLD.id
     AND coalesce(current_setting('app.allow_role_change', true), '') <> 'on'
     AND (NEW.role IS DISTINCT FROM OLD.role
          OR NEW.organization_id IS DISTINCT FROM OLD.organization_id)
  THEN
    NEW.role := OLD.role;
    NEW.organization_id := OLD.organization_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_user_self_escalation ON public.users;
CREATE TRIGGER trg_guard_user_self_escalation
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.guard_user_self_escalation();

-- create_organization legitimately promotes the caller to admin — let it
-- through by setting the opt-in GUC for its transaction only.
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
  v_alpha  constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Sign in before creating an organization'; END IF;
  IF length(trim(p_name)) < 2 OR length(trim(p_name)) > 60 THEN
    RAISE EXCEPTION 'Organization name must be 2-60 characters';
  END IF;

  PERFORM set_config('app.allow_role_change', 'on', true); -- trusted role change, this txn only

  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;
  v_prefix := upper(regexp_replace(trim(p_name), '[^a-zA-Z0-9]', '', 'g'));
  v_prefix := rpad(substr(v_prefix, 1, 3), 3, 'X');

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

-- ── #3: students must not read every user's PII in the org ──────────────────
DROP POLICY IF EXISTS users_select ON public.users;
CREATE POLICY users_select ON public.users FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (organization_id = public.current_org_id() AND public.current_user_role() <> 'student')
  );

-- ── #2: a DM recipient may only touch read-receipt columns ──────────────────
-- The messages_update policy lets sender OR receiver update; this trigger
-- stops a receiver from rewriting content / faking edits / un-deleting.
CREATE OR REPLACE FUNCTION public.guard_message_receiver_edit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS DISTINCT FROM OLD.sender_id THEN
    NEW.content    := OLD.content;
    NEW.edited_at  := OLD.edited_at;
    NEW.deleted_at := OLD.deleted_at;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_guard_message_receiver_edit ON public.messages;
CREATE TRIGGER trg_guard_message_receiver_edit
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.guard_message_receiver_edit();

-- ── #4: message_reports — org-scope + leadership (was: any admin, any org) ──
ALTER TABLE public.message_reports
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
-- backfill from the reporter's org
UPDATE public.message_reports r
   SET organization_id = u.organization_id
  FROM public.users u
 WHERE u.id = r.reporter_id AND r.organization_id IS NULL;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN SELECT policyname FROM pg_policies
             WHERE schemaname='public' AND tablename='message_reports'
  LOOP EXECUTE format('DROP POLICY IF EXISTS %I ON public.message_reports', pol.policyname); END LOOP;
END $$;

CREATE POLICY reports_insert ON public.message_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid() AND organization_id = public.current_org_id());
CREATE POLICY reports_select ON public.message_reports FOR SELECT TO authenticated
  USING (public.is_leadership() AND organization_id = public.current_org_id());

-- ── #5: blocks — let the blocked party's client see the row too (symmetric hide)
DROP POLICY IF EXISTS "Users can view their own blocks" ON public.blocks;
DROP POLICY IF EXISTS blocks_select ON public.blocks;
CREATE POLICY blocks_select ON public.blocks FOR SELECT TO authenticated
  USING (blocker_id = auth.uid() OR blocked_id = auth.uid());

-- ── #8: group-chat member counts always showed 1 (couldn't see co-members) ──
CREATE OR REPLACE FUNCTION public.is_group_member(p_group uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.group_chat_members
                 WHERE group_chat_id = p_group AND user_id = p_user)
$$;
DROP POLICY IF EXISTS gcm_select ON public.group_chat_members;
CREATE POLICY gcm_select ON public.group_chat_members FOR SELECT TO authenticated
  USING (public.is_group_member(group_chat_id, auth.uid()));

-- ── #10: reactions were world-readable across tenants ───────────────────────
DROP POLICY IF EXISTS message_reactions_select ON public.message_reactions;
CREATE POLICY message_reactions_select ON public.message_reactions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_reactions.message_id));
