-- ============================================================================
-- Alloy — Migration 0020: tenant isolation + student-account scoping
--
-- Before self-serve orgs, RLS was written for one trusted org: students,
-- notes, attendance, sessions, and rsvps were readable by ANY signed-in user
-- (USING (true)); hours were visible to leadership of ANY org; org-chat
-- messages had no org column at all. Now that anyone can create an org and
-- students can sign in, every one of those is a cross-tenant / minor-PII leak.
--
-- This migration:
--   1. Adds messages.organization_id (org chat was globally shared!)
--   2. Backfills NULL organization_id rows to ITB (the only pre-existing org)
--   3. Rebuilds RLS on 11 tables: everything org-scoped; student accounts see
--      ONLY their own linked roster row + its progress; writes are member+.
--
-- Run after 0001–0019. Safe to re-run.
-- ============================================================================

-- ── 0. Helper: the caller's role (SECURITY DEFINER dodges users-RLS recursion)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role::text FROM public.users WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- ── 1. Org chat gets an org ──────────────────────────────────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS messages_org_idx ON public.messages(organization_id);

-- ── 2. Backfill legacy NULL-org rows to ITB (sole org before self-serve) ────
DO $$
DECLARE v_itb uuid;
BEGIN
  SELECT id INTO v_itb FROM public.organizations WHERE access_code = 'ITB' LIMIT 1;
  IF v_itb IS NOT NULL THEN
    UPDATE public.students      SET organization_id = v_itb WHERE organization_id IS NULL;
    UPDATE public.sessions      SET organization_id = v_itb WHERE organization_id IS NULL;
    UPDATE public.hours_logs    SET organization_id = v_itb WHERE organization_id IS NULL;
    UPDATE public.announcements SET organization_id = v_itb WHERE organization_id IS NULL;
    -- messages: every row predates multi-org, and sender orgs = ITB
    UPDATE public.messages      SET organization_id = v_itb WHERE organization_id IS NULL;
  END IF;
END $$;

-- ── 3. Drop every existing policy on the tables being rebuilt ───────────────
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname, tablename FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('users','students','student_notes','student_goals','student_skills',
                        'sessions','session_rsvps','session_attendance','hours_logs',
                        'announcements','messages')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- Convenience predicates used below (inline, not functions, to keep plans simple):
--   same org        : organization_id = public.current_org_id()
--   is a member+    : public.current_user_role() <> 'student'
--   is leadership   : public.is_leadership()   (admin/president/vp/director, from 0004)

-- ── users ────────────────────────────────────────────────────────────────────
CREATE POLICY users_select ON public.users FOR SELECT TO authenticated
  USING (id = auth.uid() OR organization_id = public.current_org_id());
CREATE POLICY users_update_self ON public.users FOR UPDATE TO authenticated
  USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY users_update_leadership ON public.users FOR UPDATE TO authenticated
  USING (public.is_leadership() AND organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY users_insert_self ON public.users FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

-- ── students (minor PII — the crown jewels) ──────────────────────────────────
-- Members+ see their org's roster; a student account sees ONLY its linked row.
CREATE POLICY students_select ON public.students FOR SELECT TO authenticated
  USING (
    (organization_id = public.current_org_id() AND public.current_user_role() <> 'student')
    OR user_id = auth.uid()
  );
CREATE POLICY students_insert ON public.students FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.current_org_id() AND public.current_user_role() <> 'student');
CREATE POLICY students_update ON public.students FOR UPDATE TO authenticated
  USING (organization_id = public.current_org_id() AND public.current_user_role() <> 'student')
  WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY students_delete ON public.students FOR DELETE TO authenticated
  USING (organization_id = public.current_org_id() AND public.is_leadership());

-- ── student_notes (growth timeline) ──────────────────────────────────────────
CREATE POLICY student_notes_select ON public.student_notes FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.students s
    WHERE s.id = student_notes.student_id
      AND ((s.organization_id = public.current_org_id() AND public.current_user_role() <> 'student')
           OR s.user_id = auth.uid())
  ));
CREATE POLICY student_notes_insert ON public.student_notes FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND public.current_user_role() <> 'student'
    AND EXISTS (SELECT 1 FROM public.students s
                WHERE s.id = student_notes.student_id
                  AND s.organization_id = public.current_org_id())
  );
CREATE POLICY student_notes_update ON public.student_notes FOR UPDATE TO authenticated
  USING (author_id = auth.uid());
CREATE POLICY student_notes_delete ON public.student_notes FOR DELETE TO authenticated
  USING (author_id = auth.uid());

-- ── student_goals / student_skills ───────────────────────────────────────────
CREATE POLICY student_goals_select ON public.student_goals FOR SELECT TO authenticated
  USING (
    (organization_id = public.current_org_id() AND public.current_user_role() <> 'student')
    OR EXISTS (SELECT 1 FROM public.students s
               WHERE s.id = student_goals.student_id AND s.user_id = auth.uid())
  );
CREATE POLICY student_goals_write ON public.student_goals FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.current_user_role() <> 'student')
  WITH CHECK (organization_id = public.current_org_id() AND public.current_user_role() <> 'student');

CREATE POLICY student_skills_select ON public.student_skills FOR SELECT TO authenticated
  USING (
    (organization_id = public.current_org_id() AND public.current_user_role() <> 'student')
    OR EXISTS (SELECT 1 FROM public.students s
               WHERE s.id = student_skills.student_id AND s.user_id = auth.uid())
  );
CREATE POLICY student_skills_write ON public.student_skills FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.current_user_role() <> 'student')
  WITH CHECK (organization_id = public.current_org_id() AND public.current_user_role() <> 'student');

-- ── sessions ─────────────────────────────────────────────────────────────────
CREATE POLICY sessions_select ON public.sessions FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());
CREATE POLICY sessions_write ON public.sessions FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.is_leadership())
  WITH CHECK (organization_id = public.current_org_id() AND public.is_leadership());

-- ── session_rsvps (own row, sessions in own org) ────────────────────────────
CREATE POLICY rsvps_select ON public.session_rsvps FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sessions se
                 WHERE se.id = session_rsvps.session_id
                   AND se.organization_id = public.current_org_id()));
CREATE POLICY rsvps_insert ON public.session_rsvps FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.sessions se
                WHERE se.id = session_rsvps.session_id
                  AND se.organization_id = public.current_org_id()));
CREATE POLICY rsvps_update ON public.session_rsvps FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY rsvps_delete ON public.session_rsvps FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ── session_attendance (pairings — members+ of the session's org) ────────────
CREATE POLICY attendance_select ON public.session_attendance FOR SELECT TO authenticated
  USING (
    public.current_user_role() <> 'student'
    AND EXISTS (SELECT 1 FROM public.sessions se
                WHERE se.id = session_attendance.session_id
                  AND se.organization_id = public.current_org_id())
  );
CREATE POLICY attendance_write ON public.session_attendance FOR ALL TO authenticated
  USING (
    public.current_user_role() <> 'student'
    AND EXISTS (SELECT 1 FROM public.sessions se
                WHERE se.id = session_attendance.session_id
                  AND se.organization_id = public.current_org_id())
  )
  WITH CHECK (
    public.current_user_role() <> 'student'
    AND EXISTS (SELECT 1 FROM public.sessions se
                WHERE se.id = session_attendance.session_id
                  AND se.organization_id = public.current_org_id())
  );

-- ── hours_logs (own rows; leadership of the SAME org reviews) ────────────────
CREATE POLICY hours_select ON public.hours_logs FOR SELECT TO authenticated
  USING (mentor_id = auth.uid()
         OR (public.is_leadership() AND organization_id = public.current_org_id()));
CREATE POLICY hours_insert ON public.hours_logs FOR INSERT TO authenticated
  WITH CHECK (
    (mentor_id = auth.uid() OR (public.is_leadership() AND organization_id = public.current_org_id()))
    AND public.current_user_role() <> 'student'
  );
CREATE POLICY hours_update ON public.hours_logs FOR UPDATE TO authenticated
  USING (public.is_leadership() AND organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());
CREATE POLICY hours_delete ON public.hours_logs FOR DELETE TO authenticated
  USING (public.is_leadership() AND organization_id = public.current_org_id());

-- ── announcements ─────────────────────────────────────────────────────────────
CREATE POLICY ann_select ON public.announcements FOR SELECT TO authenticated
  USING (organization_id = public.current_org_id());
CREATE POLICY ann_write ON public.announcements FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.is_leadership())
  WITH CHECK (organization_id = public.current_org_id() AND public.is_leadership());

-- ── messages ──────────────────────────────────────────────────────────────────
-- DM: the two parties. Org chat: same org. Group: members of the group.
CREATE POLICY messages_select ON public.messages FOR SELECT TO authenticated
  USING (
    (receiver_id IS NOT NULL AND (sender_id = auth.uid() OR receiver_id = auth.uid()))
    OR (receiver_id IS NULL AND group_chat_id IS NULL
        AND organization_id = public.current_org_id())
    OR (group_chat_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.group_chat_members g
          WHERE g.group_chat_id = messages.group_chat_id AND g.user_id = auth.uid()))
  );
CREATE POLICY messages_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      -- org broadcast must carry the sender's org
      (receiver_id IS NULL AND group_chat_id IS NULL AND organization_id = public.current_org_id())
      -- DM stays inside the org
      OR (receiver_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.id = messages.receiver_id AND u.organization_id = public.current_org_id()))
      -- group message requires membership
      OR (group_chat_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.group_chat_members g
            WHERE g.group_chat_id = messages.group_chat_id AND g.user_id = auth.uid()))
    )
  );
-- sender edits/unsends own; receiver may mark a DM read
CREATE POLICY messages_update ON public.messages FOR UPDATE TO authenticated
  USING (sender_id = auth.uid() OR receiver_id = auth.uid())
  WITH CHECK (sender_id = auth.uid() OR receiver_id = auth.uid());
