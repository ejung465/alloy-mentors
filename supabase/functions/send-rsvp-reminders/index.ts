// Supabase Edge Function — invoked on a schedule (pg_cron, every 15 min; see
// migrations/0022_reliability_loop.sql) rather than by a table webhook.
//
// Finds sessions starting in the next ~90-150 minutes that haven't been
// reminded yet, and pushes a nudge to every non-student org member who
// hasn't RSVP'd (neither "going" nor "not_going"). Marks the session as
// reminded so it never double-sends.
//
// Deploy: npx supabase functions deploy send-rsvp-reminders --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const WINDOW_MIN_START = 90;  // remind sessions starting 90–150 min from now
const WINDOW_MIN_END = 150;

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = new Date();
  const windowStart = new Date(now.getTime() + WINDOW_MIN_START * 60 * 1000).toISOString();
  const windowEnd = new Date(now.getTime() + WINDOW_MIN_END * 60 * 1000).toISOString();

  const { data: sessions } = await supabase
    .from('sessions')
    .select('id, title, start_time, organization_id')
    .gte('start_time', windowStart)
    .lte('start_time', windowEnd)
    .is('reminder_sent_at', null)
    .not('organization_id', 'is', null);

  if (!sessions || sessions.length === 0) return new Response('no sessions due', { status: 200 });

  let totalNotified = 0;

  for (const session of sessions) {
    const [{ data: members }, { data: rsvps }] = await Promise.all([
      supabase.from('users').select('id, expo_push_token')
        .eq('organization_id', session.organization_id).neq('role', 'student'),
      supabase.from('session_rsvps').select('user_id').eq('session_id', session.id),
    ]);

    const responded = new Set((rsvps ?? []).map((r: any) => r.user_id));
    const tokens = (members ?? [])
      .filter((m: any) => !responded.has(m.id) && m.expo_push_token)
      .map((m: any) => m.expo_push_token);

    if (tokens.length > 0) {
      const messages = tokens.map((token: string) => ({
        to: token,
        title: 'Session starting soon',
        body: `"${session.title}" starts in about ${Math.round((new Date(session.start_time).getTime() - now.getTime()) / 60000)} min — RSVP?`,
        data: { sessionId: session.id },
        sound: 'default',
      }));
      await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(messages),
      });
      totalNotified += tokens.length;
    }

    await supabase.from('sessions').update({ reminder_sent_at: now.toISOString() }).eq('id', session.id);
  }

  return new Response(JSON.stringify({ sessionsProcessed: sessions.length, notified: totalNotified }), { status: 200 });
});
