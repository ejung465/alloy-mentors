// Alloy Mentors — delete-account edge function.
// App Store guideline 5.1.1(v): apps with account creation MUST offer
// in-app account deletion. The client can't delete its own auth user
// (requires service role), so it calls this with the user's JWT; we verify
// the token and hard-delete that user. public.users references
// auth.users ON DELETE CASCADE, so profile + owned rows cascade.
//
// Deploy: npx supabase functions deploy delete-account
// (keep JWT verification ON — do NOT pass --no-verify-jwt)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405 });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return new Response(JSON.stringify({ error: 'Missing auth token' }), { status: 401 });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Resolve the caller from THEIR token — a user can only delete themself.
  const { data: { user }, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401 });
  }

  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  return new Response(JSON.stringify({ deleted: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
