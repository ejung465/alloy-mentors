-- SUPABASE SCHEMA: Chat, Blocking & Moderation

-- 1. Messages Table
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  receiver_id UUID REFERENCES public.users(id) ON DELETE CASCADE, -- NULL = group message
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent', -- 'sent' | 'read'
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_receiver ON public.messages (receiver_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages (created_at);

-- 2. Blocks Table
CREATE TABLE IF NOT EXISTS public.blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT blocks_unique UNIQUE (blocker_id, blocked_id)
);

CREATE INDEX IF NOT EXISTS idx_blocks_blocker ON public.blocks (blocker_id);

-- 3. Message Reports Table
CREATE TABLE IF NOT EXISTS public.message_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Enable RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reports ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies: Messages
-- Users can read messages they sent or received, plus all group messages
CREATE POLICY "Users can read their messages"
ON public.messages FOR SELECT
TO authenticated
USING (
  sender_id = auth.uid() OR
  receiver_id = auth.uid() OR
  receiver_id IS NULL
);

-- Users can only insert messages as themselves
CREATE POLICY "Users can send messages"
ON public.messages FOR INSERT
TO authenticated
WITH CHECK (sender_id = auth.uid());

-- Users can only update messages sent to them (mark as read)
CREATE POLICY "Users can mark messages as read"
ON public.messages FOR UPDATE
TO authenticated
USING (receiver_id = auth.uid());

-- 6. RLS Policies: Blocks
CREATE POLICY "Users can view their own blocks"
ON public.blocks FOR SELECT
TO authenticated
USING (blocker_id = auth.uid());

CREATE POLICY "Users can block others"
ON public.blocks FOR INSERT
TO authenticated
WITH CHECK (blocker_id = auth.uid());

CREATE POLICY "Users can unblock others"
ON public.blocks FOR DELETE
TO authenticated
USING (blocker_id = auth.uid());

-- 7. RLS Policies: Message Reports
CREATE POLICY "Users can submit reports"
ON public.message_reports FOR INSERT
TO authenticated
WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "Admins can view reports"
ON public.message_reports FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.users
    WHERE users.id = auth.uid()
    AND users.role = 'admin'
  )
);

-- 8. Enable Realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
