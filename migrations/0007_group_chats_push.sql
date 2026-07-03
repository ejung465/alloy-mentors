-- ============================================================================
-- Alloy — Migration 0007: Custom Group Chats + Push Notification Token
-- Run in Supabase → SQL Editor after 0001–0006. Safe to re-run.
-- Tables are ALL created first; policies come after so there are no
-- forward-reference errors.
-- ============================================================================

-- 1) Push token column on users ----------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS expo_push_token text;

-- 2) group_chats table -------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.group_chats (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by      uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_group_chats_org ON public.group_chats (organization_id);
ALTER TABLE public.group_chats ENABLE ROW LEVEL SECURITY;

-- 3) group_chat_members table ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.group_chat_members (
  group_chat_id uuid NOT NULL REFERENCES public.group_chats(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gcm_user ON public.group_chat_members (user_id);
ALTER TABLE public.group_chat_members ENABLE ROW LEVEL SECURITY;

-- 4) group_chat_id column on messages ----------------------------------------
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS group_chat_id uuid REFERENCES public.group_chats(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_messages_group_chat ON public.messages (group_chat_id);

-- ── ALL POLICIES BELOW (both tables exist by this point) ───────────────────

-- group_chats policies -------------------------------------------------------
DROP POLICY IF EXISTS group_chats_select ON public.group_chats;
CREATE POLICY group_chats_select ON public.group_chats
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.group_chat_members
      WHERE group_chat_id = id AND user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS group_chats_insert ON public.group_chats;
CREATE POLICY group_chats_insert ON public.group_chats
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND organization_id = public.current_org_id()
  );

DROP POLICY IF EXISTS group_chats_delete ON public.group_chats;
CREATE POLICY group_chats_delete ON public.group_chats
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- group_chat_members policies ------------------------------------------------
DROP POLICY IF EXISTS gcm_select ON public.group_chat_members;
CREATE POLICY gcm_select ON public.group_chat_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS gcm_insert ON public.group_chat_members;
CREATE POLICY gcm_insert ON public.group_chat_members
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.group_chats
      WHERE id = group_chat_id
        AND (created_by = auth.uid() OR organization_id = public.current_org_id())
    )
  );

DROP POLICY IF EXISTS gcm_delete ON public.group_chat_members;
CREATE POLICY gcm_delete ON public.group_chat_members
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- messages policies (updated to scope group-chat messages to members) --------
DROP POLICY IF EXISTS "Users can read their messages" ON public.messages;
DROP POLICY IF EXISTS messages_select ON public.messages;
CREATE POLICY messages_select ON public.messages
  FOR SELECT TO authenticated
  USING (
    sender_id = auth.uid()
    OR receiver_id = auth.uid()
    OR (receiver_id IS NULL AND group_chat_id IS NULL)
    OR (
      group_chat_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.group_chat_members
        WHERE group_chat_id = messages.group_chat_id AND user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
DROP POLICY IF EXISTS messages_insert ON public.messages;
CREATE POLICY messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid());

-- 5) Realtime ----------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_chats;
ALTER PUBLICATION supabase_realtime ADD TABLE public.group_chat_members;
