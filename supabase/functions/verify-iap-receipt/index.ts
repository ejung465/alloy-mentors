// Alloy Mentors — verify-iap-receipt edge function.
//
// Validates an App Store receipt with Apple, and on a valid, active
// subscription flips `organizations.subscription_tier = 'pro'` (+ expiry).
// The client (lib/iap.ts) calls this after a StoreKit purchase / restore —
// StoreKit success alone never unlocks Pro; only Apple's verdict, applied
// here with the service role, does.
//
// Deploy:  npx supabase functions deploy verify-iap-receipt
//          (keep JWT verification ON — do NOT pass --no-verify-jwt)
// Secret:  npx supabase secrets set APPLE_SHARED_SECRET=<from App Store Connect>
//          (App Store Connect → your app → App-Specific Shared Secret / the
//           primary shared secret for auto-renewable subscriptions)
//
// POST { "receipt": "<base64 receipt>", "organizationId": "<uuid>" }
// →    { "verified": boolean, "tier": string, "expiresAt": string | null }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const APPLE_PROD_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';

type AppleLatestReceiptInfo = {
  product_id?: string;
  expires_date_ms?: string;
  original_transaction_id?: string;
};

type AppleVerifyResponse = {
  status: number;
  environment?: string;
  latest_receipt_info?: AppleLatestReceiptInfo[];
  pending_renewal_info?: { auto_renew_status?: string; product_id?: string }[];
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Call Apple's verifyReceipt, retrying against sandbox on status 21007. */
async function verifyWithApple(
  receipt: string,
  sharedSecret: string,
): Promise<AppleVerifyResponse> {
  const payload = {
    'receipt-data': receipt,
    password: sharedSecret,
    'exclude-old-transactions': true,
  };

  const call = async (url: string): Promise<AppleVerifyResponse> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return (await res.json()) as AppleVerifyResponse;
  };

  // Always try production first (Apple's documented pattern); if the receipt
  // is from the test environment Apple returns 21007 → retry against sandbox.
  let result = await call(APPLE_PROD_URL);
  if (result.status === 21007) {
    result = await call(APPLE_SANDBOX_URL);
  }
  return result;
}

/**
 * From Apple's response, find the latest still-active subscription entry.
 * Returns its expiry ISO string, or null if none is currently active.
 */
function activeExpiry(resp: AppleVerifyResponse): string | null {
  const infos = resp.latest_receipt_info ?? [];
  let latestMs = 0;
  for (const info of infos) {
    const ms = info.expires_date_ms ? parseInt(info.expires_date_ms, 10) : 0;
    if (ms > latestMs) latestMs = ms;
  }
  if (latestMs === 0) return null;
  // Only "active" if the latest expiry is still in the future.
  if (latestMs <= Date.now()) return null;
  return new Date(latestMs).toISOString();
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'POST only' }, 405);
  }

  // Require a valid user JWT — this endpoint is deployed WITH jwt verification.
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) {
    return json({ error: 'Missing auth token' }, 401);
  }

  const sharedSecret = Deno.env.get('APPLE_SHARED_SECRET');
  if (!sharedSecret) {
    return json({ error: 'APPLE_SHARED_SECRET is not configured' }, 500);
  }

  let body: { receipt?: string; organizationId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const { receipt, organizationId } = body;
  if (!receipt || !organizationId) {
    return json({ error: 'receipt and organizationId are required' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Resolve the caller from THEIR token, then confirm they belong to the org
  // they're trying to upgrade — a user can't flip some other org's tier.
  const { data: { user }, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !user) {
    return json({ error: 'Invalid token' }, 401);
  }

  const { data: profile } = await admin
    .from('users')
    .select('organization_id, role')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile || profile.organization_id !== organizationId) {
    return json({ error: 'You do not belong to this organization' }, 403);
  }

  // Validate the receipt with Apple.
  let apple: AppleVerifyResponse;
  try {
    apple = await verifyWithApple(receipt, sharedSecret);
  } catch (e) {
    return json({ error: `Apple verification request failed: ${e instanceof Error ? e.message : 'unknown'}` }, 502);
  }

  if (apple.status !== 0) {
    // Non-zero status = receipt invalid / malformed / not verifiable.
    return json({ verified: false, tier: 'free', expiresAt: null, appleStatus: apple.status });
  }

  const expiresAt = activeExpiry(apple);
  if (!expiresAt) {
    // Receipt is valid but the subscription is expired / not active.
    return json({ verified: false, tier: 'free', expiresAt: null });
  }

  // Valid + active → upgrade the org (service role bypasses RLS, which is
  // correct: this is a trusted server-side write gated by Apple's verdict).
  const { error: updErr } = await admin
    .from('organizations')
    .update({ subscription_tier: 'pro', subscription_expires_at: expiresAt })
    .eq('id', organizationId);

  if (updErr) {
    return json({ error: `Failed to update organization: ${updErr.message}` }, 500);
  }

  return json({ verified: true, tier: 'pro', expiresAt });
});
