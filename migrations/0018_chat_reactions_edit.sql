-- ============================================================================
-- Alloy Tutors — Migration 0018: iMessage-style chat
--   • Tapback reactions (one per user per message, replaceable)
--   • Edit (edited_at) and Unsend (deleted_at soft-delete) for own messages
--   • UPDATE policy so senders can only touch their own rows
-- Run after 0001–0017. Safe to re-run.
-- ============================================================================

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS edited_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE TABLE IF NOT EXISTS public.message_reactions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  emoji      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS message_reactions_message_idx ON public.message_reactions(message_id);

ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS message_reactions_select ON public.message_reactions;
CREATE POLICY message_reactions_select ON public.message_reactions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS message_reactions_insert ON public.message_reactions;
CREATE POLICY message_reactions_insert ON public.message_reactions
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS message_reactions_update ON public.message_reactions;
CREATE POLICY message_reactions_update ON public.message_reactions
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS message_reactions_delete ON public.message_reactions;
CREATE POLICY message_reactions_delete ON public.message_reactions
  FOR DELETE TO authenticated USING (user_id = auth.uid());

-- Senders may edit/unsend ONLY their own messages.
DROP POLICY IF EXISTS messages_update_own ON public.messages;
CREATE POLICY messages_update_own ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid()) WITH CHECK (sender_id = auth.uid());

-- Realtime events for reactions (and make sure messages UPDATE events flow).
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reactions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
