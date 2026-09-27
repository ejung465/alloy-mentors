// Alloy Mentors — send-email edge function (Resend).
// Sends transactional email (guardian digests, notifications) via Resend.
//
// Deploy:   npx supabase functions deploy send-email --no-verify-jwt
// Auth:     callers must send `Authorization: Bearer <service role key>`.
//           Without this check the endpoint is an open relay: anyone could
//           send any HTML from updates@alloymentors.com and burn the domain's
//           reputation. Nothing in the app calls it; it's for server-side use.
// Secret:   npx supabase secrets set RESEND_API_KEY=<your key>   (never commit it)
// Sender:   requires alloymentors.com to be a verified domain in Resend.
//
// POST { "to": "a@b.com" | ["a@b.com"], "subject": "...", "html": "<p>...</p>" }

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceKey || req.headers.get('Authorization') !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) {
    return new Response(JSON.stringify({ error: 'RESEND_API_KEY is not configured' }), { status: 500 });
  }

  let body: { to?: string | string[]; subject?: string; html?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { to, subject, html } = body;
  if (!to || !subject || !html) {
    return new Response(JSON.stringify({ error: 'to, subject, and html are required' }), { status: 400 });
  }

  const upstream = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Alloy Mentors <updates@alloymentors.com>',
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
    }),
  });

  const result = await upstream.json();
  return new Response(JSON.stringify(result), {
    status: upstream.ok ? 200 : upstream.status,
    headers: { 'Content-Type': 'application/json' },
  });
});
