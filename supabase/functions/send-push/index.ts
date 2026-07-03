// Supabase Edge Function — invoked by a Database Webhook on messages INSERT.
// Sends an Expo push notification to the recipient(s) of the new message.
//
// Deploy: npx supabase functions deploy send-push --no-verify-jwt
// Then in Supabase Dashboard → Database → Webhooks, create a webhook:
//   Table: messages   Event: INSERT   URL: <your edge function URL>

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

Deno.serve(async (req) => {
  const { record } = await req.json();
  if (!record) return new Response('no record', { status: 400 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const recipientIds: string[] = [];

  if (record.receiver_id) {
    // Direct message — notify the recipient
    recipientIds.push(record.receiver_id);
  } else if (record.group_chat_id) {
    // Custom group chat — notify all members except the sender
    const { data: members } = await supabase
      .from('group_chat_members')
      .select('user_id')
      .eq('group_chat_id', record.group_chat_id)
      .neq('user_id', record.sender_id);
    if (members) recipientIds.push(...members.map((m: any) => m.user_id));
  }
  // Org-wide messages (receiver_id=null, group_chat_id=null) — skip push to avoid spam

  if (recipientIds.length === 0) return new Response('no recipients', { status: 200 });

  // Fetch sender name
  const { data: sender } = await supabase
    .from('users')
    .select('full_name')
    .eq('id', record.sender_id)
    .single();
  const senderName = sender?.full_name ?? 'Someone';

  // Fetch push tokens for all recipients
  const { data: users } = await supabase
    .from('users')
    .select('expo_push_token')
    .in('id', recipientIds)
    .not('expo_push_token', 'is', null);

  const tokens = (users ?? []).map((u: any) => u.expo_push_token).filter(Boolean);
  if (tokens.length === 0) return new Response('no tokens', { status: 200 });

  const messages = tokens.map((token: string) => ({
    to: token,
    title: senderName,
    body: record.content.length > 100 ? record.content.slice(0, 97) + '…' : record.content,
    data: { messageId: record.id },
    sound: 'default',
  }));

  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(messages),
  });

  const result = await res.json();
  return new Response(JSON.stringify(result), { status: 200 });
});
