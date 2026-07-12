-- ============================================================================
-- Alloy — Migration 0025: shared foundation for the v1.3 feature wave
--
-- This is deliberately ONE migration defining every new table/column the
-- next batch of features needs (notifications, at-risk alerts, chat safety
-- redesign, badges, resources, audit log, subscriptions, org branding,
-- coming-soon feature votes). Laying it all down once, up front, means the
-- agents building the UI/logic on top of it can't collide on schema.
-- Run after 0001–0024.
-- ============================================================================

-- ── Org: at-risk threshold, hour-verification signer, branding, subscription ─
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS at_risk_weeks         integer NOT NULL DEFAULT 0,  -- 0 = disabled
  ADD COLUMN IF NOT EXISTS hours_signer_name      text,
  ADD COLUMN IF NOT EXISTS hours_signer_role      text,                       -- e.g. "President"
  ADD COLUMN IF NOT EXISTS primary_color          text,                       -- org branding override
  ADD COLUMN IF NOT EXISTS secondary_color        text,
  ADD COLUMN IF NOT EXISTS subscription_tier      text NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

-- ── Notifications: persistent, in-app, all 3 roles (Profile > Notifications tab) ─
-- Every push-sending path (chat, RSVP reminders, at-risk alerts, targeted
-- announcements, incident reports) should ALSO insert a row here, so a
-- missed/dismissed push is never the only record of it.
CREATE TABLE IF NOT EXISTS public.notifications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  type            text NOT NULL, -- 'chat_message' | 'rsvp_reminder' | 'at_risk' | 'announcement' | 'incident_report' | 'system'
  title           text NOT NULL,
  body            text,
  data            jsonb,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON public.notifications(user_id, created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
-- Inserts happen from edge functions (service role bypasses RLS) or triggers.
-- No authenticated INSERT policy — clients never write notifications directly.

-- ── Chat safety redesign (item 46): admin can view any chat on demand; ──────
-- reporting auto-blocks + alerts admin; reporter (only) can cancel, which
-- un-blocks but keeps the report on file.
CREATE TABLE IF NOT EXISTS public.chat_incident_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  reporter_id      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message_id       uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  chat_snapshot    jsonb NOT NULL, -- recent messages at time of report, for evidence even if later edited/unsent
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','dismissed','cancelled')),
  action_taken     text,           -- 'suspended' | 'paused' | 'warning' | null
  resolved_by      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_incident_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incident_reports_select ON public.chat_incident_reports;
CREATE POLICY incident_reports_select ON public.chat_incident_reports FOR SELECT TO authenticated
  USING (
    reporter_id = auth.uid()
    OR (public.is_leadership() AND organization_id = public.current_org_id())
  );
DROP POLICY IF EXISTS incident_reports_insert ON public.chat_incident_reports;
CREATE POLICY incident_reports_insert ON public.chat_incident_reports FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid() AND organization_id = public.current_org_id());
-- Reporter may only cancel (their own, pending); leadership may resolve (confirm/dismiss + action).
DROP POLICY IF EXISTS incident_reports_update_reporter ON public.chat_incident_reports;
CREATE POLICY incident_reports_update_reporter ON public.chat_incident_reports FOR UPDATE TO authenticated
  USING (reporter_id = auth.uid() AND status = 'pending')
  WITH CHECK (reporter_id = auth.uid() AND status = 'cancelled');
DROP POLICY IF EXISTS incident_reports_update_leadership ON public.chat_incident_reports;
CREATE POLICY incident_reports_update_leadership ON public.chat_incident_reports FOR UPDATE TO authenticated
  USING (public.is_leadership() AND organization_id = public.current_org_id())
  WITH CHECK (organization_id = public.current_org_id());

-- Admins/leadership can read any message in their own org (chat safety
-- oversight) — additive to the existing sender/receiver/group policies.
DROP POLICY IF EXISTS messages_select_leadership ON public.messages;
CREATE POLICY messages_select_leadership ON public.messages FOR SELECT TO authenticated
  USING (public.is_leadership() AND organization_id = public.current_org_id());

-- ── Badges & milestones — extensible library, seeded with a starter set ─────
CREATE TABLE IF NOT EXISTS public.badge_definitions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text UNIQUE NOT NULL,
  label          text NOT NULL,
  description    text NOT NULL,
  icon           text NOT NULL,               -- Ionicons name
  color          text NOT NULL DEFAULT '#165B74',
  criteria_type  text NOT NULL,                -- 'session_count' | 'streak_weeks' | 'hours_total' | 'goal_completed' | 'manual'
  criteria_value integer,                       -- threshold; null for manual-only badges
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.user_badges (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  badge_key   text NOT NULL REFERENCES public.badge_definitions(key) ON DELETE CASCADE,
  awarded_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, badge_key)
);
ALTER TABLE public.badge_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS badge_defs_select ON public.badge_definitions;
CREATE POLICY badge_defs_select ON public.badge_definitions FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS user_badges_select ON public.user_badges;
CREATE POLICY user_badges_select ON public.user_badges FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = user_badges.user_id
      AND u.organization_id = public.current_org_id()
  ));

INSERT INTO public.badge_definitions (key, label, description, icon, color, criteria_type, criteria_value) VALUES
  ('first_session',     'First Session',       'Attended your first session',              'footsteps-outline',      '#2C7C96', 'session_count', 1),
  ('five_sessions',     'Getting Started',      'Attended 5 sessions',                       'walk-outline',           '#2C7C96', 'session_count', 5),
  ('twentyfive_sessions','Regular',             'Attended 25 sessions',                      'trending-up-outline',    '#165B74', 'session_count', 25),
  ('fifty_sessions',    'Veteran',              'Attended 50 sessions',                      'star-outline',           '#165B74', 'session_count', 50),
  ('hundred_sessions',  'Century',               'Attended 100 sessions',                     'trophy-outline',         '#C5642D', 'session_count', 100),
  ('streak_4wk',        'Building',              '4-week attendance streak',                  'flame-outline',          '#C5642D', 'streak_weeks',  4),
  ('streak_12wk',       'Unstoppable',           '12-week attendance streak',                 'flame',                  '#C5642D', 'streak_weeks',  12),
  ('hours_10',          '10 Hours',              'Logged 10 approved hours',                  'time-outline',           '#2C7C96', 'hours_total',   10),
  ('hours_50',          '50 Hours',              'Logged 50 approved hours',                  'time-outline',           '#165B74', 'hours_total',   50),
  ('hours_200',         '200 Hours',             'Logged 200 approved hours',                 'medal-outline',          '#C5642D', 'hours_total',   200),
  ('first_goal',        'Goal Setter',           'Achieved your first goal',                  'flag-outline',           '#2C7C96', 'goal_completed', 1),
  ('five_goals',        'Goal Crusher',          'Achieved 5 goals',                          'checkmark-done-outline', '#165B74', 'goal_completed', 5),
  ('founding_member',   'Founding Member',       'Joined during the organization''s first month', 'ribbon-outline',    '#C5642D', 'manual', NULL),
  ('mvp',               'MVP',                   'Recognized by leadership for outstanding contribution', 'star',       '#C5642D', 'manual', NULL)
ON CONFLICT (key) DO NOTHING;

-- ── Resource sharing (lesson materials) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.resources (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title              text NOT NULL,
  description        text,
  file_url           text NOT NULL,
  shared_by          uuid REFERENCES public.users(id) ON DELETE SET NULL,
  audience           text NOT NULL DEFAULT 'all' CHECK (audience IN ('all','students','mentors','specific')),
  audience_user_ids  uuid[] NOT NULL DEFAULT '{}',
  created_at         timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resources_select ON public.resources;
CREATE POLICY resources_select ON public.resources FOR SELECT TO authenticated
  USING (
    organization_id = public.current_org_id()
    AND (
      audience = 'all'
      OR (audience = 'students' AND public.current_user_role() = 'student')
      OR (audience = 'mentors' AND public.current_user_role() <> 'student')
      OR (audience = 'specific' AND auth.uid() = ANY(audience_user_ids))
      OR shared_by = auth.uid()
    )
  );
DROP POLICY IF EXISTS resources_write ON public.resources;
CREATE POLICY resources_write ON public.resources FOR ALL TO authenticated
  USING (organization_id = public.current_org_id() AND public.current_user_role() <> 'student')
  WITH CHECK (organization_id = public.current_org_id() AND public.current_user_role() <> 'student');

-- ── Audit log (admin-exportable) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action          text NOT NULL,   -- e.g. 'student.viewed', 'hours.approved', 'role.changed'
  target_type     text,
  target_id       uuid,
  details         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_org_idx ON public.audit_log(organization_id, created_at DESC);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
CREATE POLICY audit_log_select ON public.audit_log FOR SELECT TO authenticated
  USING (public.is_leadership() AND organization_id = public.current_org_id());
DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;
CREATE POLICY audit_log_insert ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid() AND organization_id = public.current_org_id());

-- ── Coming-soon feature upvote/downvote ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.feature_votes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  feature_key text NOT NULL, -- 'web_dashboard' | 'language' | 'background_screening'
  vote        smallint NOT NULL CHECK (vote IN (-1, 1)),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, feature_key)
);
ALTER TABLE public.feature_votes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS feature_votes_select ON public.feature_votes;
CREATE POLICY feature_votes_select ON public.feature_votes FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS feature_votes_upsert ON public.feature_votes;
CREATE POLICY feature_votes_upsert ON public.feature_votes FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
