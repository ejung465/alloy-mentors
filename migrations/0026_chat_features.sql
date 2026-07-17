-- ============================================================================
-- Alloy — Migration 0026: chat feature wave
--   1. Images in chat        → chat-images storage bucket + messages.image_url
--   2. Pinned messages       → messages.pinned_at + set_message_pin() RPC
--   3. Targeted announcements → send_targeted_announcement() RPC (SECURITY DEFINER)
--   4. Child-safety redesign  → file_chat_incident_report() / cancel / resolve
--                               RPCs + users.suspended_at
--
-- The chat_incident_reports / notifications tables and the
-- messages_select_leadership policy already exist (migration 0025). This
-- migration only adds the columns, the storage bucket, and the SECURITY
-- DEFINER RPCs the client calls. Run after 0001–0025. Safe to re-run.
-- ============================================================================

-- ── 1. Message columns: image attachment + pin marker ───────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS pinned_at timestamptz;

-- ── 1b. Suspension marker on user accounts (set by admin on confirmed report) ─
-- Enforcement of what a suspended account cannot do is a follow-up; this
-- migration only records the timestamp.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

-- ── 1c. Public storage bucket for chat images ───────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('chat-images', 'chat-images', true)
ON CONFLICT (id) DO NOTHING;

-- Uploads must live under the caller's own org-id folder: `{org_id}/{file}`.
-- Public read since the bucket is public and images render inline in-app.
DROP POLICY IF EXISTS "chat_images_insert" ON storage.objects;
CREATE POLICY "chat_images_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-images'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
  );

DROP POLICY IF EXISTS "chat_images_update" ON storage.objects;
CREATE POLICY "chat_images_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-images'
    AND (storage.foldername(name))[1] = public.current_org_id()::text
  );

DROP POLICY IF EXISTS "chat_images_read" ON storage.objects;
CREATE POLICY "chat_images_read" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'chat-images');

-- ── 2. Pin / unpin a message (elevated-role only) ───────────────────────────
-- Org-broadcast messages have no receiver_id, so the messages_update RLS policy
-- (sender OR receiver) would block a leader from pinning a message they didn't
-- send. This SECURITY DEFINER RPC does the pin under a leadership + org check.
CREATE OR REPLACE FUNCTION public.set_message_pin(p_message_id uuid, p_pinned boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_leadership() THEN
    RAISE EXCEPTION 'Only leadership can pin messages';
  END IF;

  UPDATE public.messages
     SET pinned_at = CASE WHEN p_pinned THEN now() ELSE NULL END
   WHERE id = p_message_id
     AND organization_id = public.current_org_id();
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_message_pin(uuid, boolean) TO authenticated;

-- ── 3. Targeted announcement ────────────────────────────────────────────────
-- Inserts the org-broadcast message (everyone in the org still SEES it in the
-- org channel, unchanged) and then inserts a notifications row ONLY for the
-- matched audience — that targeting is purely about who gets NOTIFIED.
--   p_audience: 'everyone' | 'mentors' | 'students' | 'not_rsvp' | 'attended'
--   p_session_id: required for 'not_rsvp' / 'attended', ignored otherwise.
CREATE OR REPLACE FUNCTION public.send_targeted_announcement(
  p_content    text,
  p_audience   text,
  p_session_id uuid  DEFAULT NULL,
  p_image_url  text  DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org   uuid := public.current_org_id();
  v_me    uuid := auth.uid();
  v_msg   uuid;
BEGIN
  IF NOT public.is_leadership() THEN
    RAISE EXCEPTION 'Only leadership can send announcements';
  END IF;
  IF p_audience NOT IN ('everyone','mentors','students','not_rsvp','attended') THEN
    RAISE EXCEPTION 'Unknown audience: %', p_audience;
  END IF;
  IF p_audience IN ('not_rsvp','attended') AND p_session_id IS NULL THEN
    RAISE EXCEPTION 'A session must be selected for this audience';
  END IF;

  -- 1) The org-broadcast message itself (visible to the whole org, as before).
  INSERT INTO public.messages (content, sender_id, receiver_id, group_chat_id, organization_id, image_url)
  VALUES (COALESCE(NULLIF(btrim(p_content), ''), '📣 Announcement'), v_me, NULL, NULL, v_org, p_image_url)
  RETURNING id INTO v_msg;

  -- 2) A notification row per matched recipient (never the sender).
  INSERT INTO public.notifications (user_id, organization_id, type, title, body, data)
  SELECT u.id, v_org, 'announcement', 'New announcement', p_content,
         jsonb_build_object('message_id', v_msg, 'audience', p_audience, 'session_id', p_session_id)
  FROM public.users u
  WHERE u.organization_id = v_org
    AND u.id <> v_me
    AND (
      p_audience = 'everyone'
      OR (p_audience = 'mentors'  AND u.role <> 'student')
      OR (p_audience = 'students' AND u.role  = 'student')
      OR (p_audience = 'not_rsvp' AND u.role <> 'student' AND NOT EXISTS (
            SELECT 1 FROM public.session_rsvps r
            WHERE r.session_id = p_session_id AND r.user_id = u.id AND r.status = 'going'))
      OR (p_audience = 'attended' AND EXISTS (
            SELECT 1 FROM public.session_attendance a
            WHERE a.session_id = p_session_id
              AND (
                a.volunteer_id = u.id
                OR EXISTS (SELECT 1 FROM public.students st WHERE st.id = a.student_id AND st.user_id = u.id)
              )))
    );

  RETURN v_msg;
END;
$$;
GRANT EXECUTE ON FUNCTION public.send_targeted_announcement(text, text, uuid, text) TO authenticated;

-- ── 4a. File a chat incident report (the safety-critical path) ──────────────
-- One atomic call: writes the report + snapshot, auto-blocks the reported user
-- for the reporter, and notifies EVERY leadership member of the org. Needs
-- SECURITY DEFINER because notifications has no authenticated INSERT grant.
CREATE OR REPLACE FUNCTION public.file_chat_incident_report(
  p_reported_user_id uuid,
  p_reason           text,
  p_snapshot         jsonb,
  p_message_id       uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_me  uuid := auth.uid();
  v_report uuid;
BEGIN
  IF p_reported_user_id = v_me THEN
    RAISE EXCEPTION 'You cannot report yourself';
  END IF;

  -- 1) Report + evidence snapshot (immutable copy of the recent thread).
  INSERT INTO public.chat_incident_reports
    (organization_id, reporter_id, reported_user_id, message_id, chat_snapshot, reason, status)
  VALUES
    (v_org, v_me, p_reported_user_id, p_message_id, COALESCE(p_snapshot, '[]'::jsonb), p_reason, 'pending')
  RETURNING id INTO v_report;

  -- 2) Auto-block (reporter blocks reported). Idempotent.
  INSERT INTO public.blocks (blocker_id, blocked_id)
  VALUES (v_me, p_reported_user_id)
  ON CONFLICT DO NOTHING;

  -- 3) High-priority alert to every leader in the org.
  INSERT INTO public.notifications (user_id, organization_id, type, title, body, data)
  SELECT u.id, v_org, 'incident_report',
         '🚨 High priority: chat incident reported',
         'A member reported a chat message. Review it in the admin chat viewer.',
         jsonb_build_object('report_id', v_report, 'reported_user_id', p_reported_user_id)
  FROM public.users u
  WHERE u.organization_id = v_org
    AND u.role IN ('admin','president','vp');

  RETURN v_report;
END;
$$;
GRANT EXECUTE ON FUNCTION public.file_chat_incident_report(uuid, text, jsonb, uuid) TO authenticated;

-- ── 4b. Reporter cancels their own pending report (un-blocks, keeps on file) ─
CREATE OR REPLACE FUNCTION public.cancel_chat_incident_report(p_report_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me      uuid := auth.uid();
  v_reported uuid;
BEGIN
  -- Only the reporter, and only while still pending.
  UPDATE public.chat_incident_reports
     SET status = 'cancelled'
   WHERE id = p_report_id
     AND reporter_id = v_me
     AND status = 'pending'
  RETURNING reported_user_id INTO v_reported;

  IF v_reported IS NULL THEN
    RAISE EXCEPTION 'Report not found, not yours, or already resolved';
  END IF;

  -- Remove the auto-block.
  DELETE FROM public.blocks WHERE blocker_id = v_me AND blocked_id = v_reported;
END;
$$;
GRANT EXECUTE ON FUNCTION public.cancel_chat_incident_report(uuid) TO authenticated;

-- ── 4c. Admin resolves a report ─────────────────────────────────────────────
--   p_action: 'suspend'  → confirm + set users.suspended_at, keep block
--             'warning'  → confirm + action_taken='warning', keep block
--             'dismiss'  → dismissed (unfounded) + remove the auto-block
CREATE OR REPLACE FUNCTION public.resolve_chat_incident_report(p_report_id uuid, p_action text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.current_org_id();
  v_me  uuid := auth.uid();
  v_rep record;
BEGIN
  IF NOT public.is_leadership() THEN
    RAISE EXCEPTION 'Only leadership can resolve reports';
  END IF;
  IF p_action NOT IN ('suspend','warning','dismiss') THEN
    RAISE EXCEPTION 'Unknown action: %', p_action;
  END IF;

  SELECT * INTO v_rep FROM public.chat_incident_reports
   WHERE id = p_report_id AND organization_id = v_org AND status = 'pending';
  IF v_rep.id IS NULL THEN
    RAISE EXCEPTION 'Report not found in your org or already resolved';
  END IF;

  IF p_action = 'suspend' THEN
    UPDATE public.chat_incident_reports
       SET status='confirmed', action_taken='suspended', resolved_by=v_me, resolved_at=now()
     WHERE id = p_report_id;
    UPDATE public.users SET suspended_at = now() WHERE id = v_rep.reported_user_id;
    -- block stays in place

  ELSIF p_action = 'warning' THEN
    UPDATE public.chat_incident_reports
       SET status='confirmed', action_taken='warning', resolved_by=v_me, resolved_at=now()
     WHERE id = p_report_id;
    -- block stays in place

  ELSE -- dismiss (found unfounded): drop the auto-block
    UPDATE public.chat_incident_reports
       SET status='dismissed', action_taken='dismissed', resolved_by=v_me, resolved_at=now()
     WHERE id = p_report_id;
    DELETE FROM public.blocks
     WHERE blocker_id = v_rep.reporter_id AND blocked_id = v_rep.reported_user_id;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.resolve_chat_incident_report(uuid, text) TO authenticated;
