import * as Crypto from 'expo-crypto';

/**
 * Rotating check-in payload shared by the member QR (app/my-qr.tsx) and the
 * kiosk scanner (app/kiosk.tsx). Format (52 chars, fits QR v6-H):
 *
 *   AT1.<uuid-hex-32>.<bucket-base36>.<sig-8-hex>
 *
 * bucket advances every 30s and sig = SHA-256(uuidHex|bucket|SALT), so a
 * screenshot of someone's code goes stale within a minute and a hand-typed
 * payload without the app can't produce a valid signature. (The salt ships in
 * the app so this is abuse-resistance, not cryptographic security — the threat
 * model is students/volunteers reusing screenshots, not nation states.)
 */

const SALT = 'alloy-tutors-checkin-v1';
const PREFIX = 'AT1';
export const QR_ROTATION_SECONDS = 30;

const bucketNow = () => Math.floor(Date.now() / (QR_ROTATION_SECONDS * 1000));

/** Seconds until the current payload rotates (for the refresh countdown). */
export function secondsUntilRotation(): number {
  const ms = QR_ROTATION_SECONDS * 1000;
  return Math.ceil((ms - (Date.now() % ms)) / 1000);
}

async function sig(uuidHex: string, bucket: number): Promise<string> {
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${uuidHex}|${bucket}|${SALT}`
  );
  return digest.slice(0, 8);
}

/** Build the rotating payload for the signed-in member's QR. */
export async function makeCheckinPayload(userId: string): Promise<string> {
  const uuidHex = userId.replace(/-/g, '').toLowerCase();
  const bucket = bucketNow();
  return `${PREFIX}.${uuidHex}.${bucket.toString(36)}.${await sig(uuidHex, bucket)}`;
}

export type CheckinVerdict = { userId: string } | { error: 'format' | 'expired' | 'invalid' };

/** Kiosk-side verification. Accepts the current bucket ±1 (~60-90s window). */
export async function verifyCheckinPayload(data: string): Promise<CheckinVerdict> {
  const parts = data.trim().split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) return { error: 'format' };
  const [, uuidHex, bucket36, gotSig] = parts;
  if (!/^[0-9a-f]{32}$/.test(uuidHex) || !/^[0-9a-f]{8}$/.test(gotSig)) return { error: 'format' };
  const claimed = parseInt(bucket36, 36);
  if (!Number.isFinite(claimed)) return { error: 'format' };

  const now = bucketNow();
  if (Math.abs(now - claimed) > 1) return { error: 'expired' };
  for (const b of [now, now - 1, now + 1]) {
    if (b === claimed && (await sig(uuidHex, b)) === gotSig) {
      const u = uuidHex;
      return {
        userId: `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`,
      };
    }
  }
  return { error: 'invalid' };
}
