import { Platform } from 'react-native';
import type {
  Product,
  Purchase,
  PurchaseError,
} from 'react-native-iap';
import { supabase } from '@/lib/supabase';

/**
 * Alloy — StoreKit / IAP client wrapper (react-native-iap).
 *
 * This is SCAFFOLDING. The App Store Connect subscription product does not
 * exist yet, so no purchase can actually complete today. Everything here is
 * wired so that once the product is created it is a quick swap of the product
 * ID constant below (and the matching id in App Store Connect) to go live.
 *
 * Trust model: a completed StoreKit purchase is NOT enough to unlock Pro. The
 * client sends the receipt to the `verify-iap-receipt` edge function, which
 * validates it with Apple server-side and flips
 * `organizations.subscription_tier`. The client never writes the tier itself.
 *
 * Native linking: `react-native-iap` is a Nitro module — its native side has
 * not been linked into this build yet (no rebuild since the package was
 * added). Nitro throws synchronously at *import time* of
 * `react-native-nitro-modules` when the native module is missing
 * (`TurboModuleRegistry.getEnforcing('NitroModules')`), so a static
 * `import ... from 'react-native-iap'` at module scope would crash any screen
 * that imports this file. We lazy-require it instead (mirrors the
 * `getImagePicker()` pattern in app/(tabs)/chat.tsx) so screens that import
 * `lib/iap.ts` still render, with IAP calls failing gracefully until the app
 * is rebuilt with the native module linked.
 */
type IAPModule = typeof import('react-native-iap');
let _iapModule: IAPModule | null | undefined;
function getIAP(): IAPModule | null {
  if (_iapModule !== undefined) return _iapModule;
  try {
    _iapModule = require('react-native-iap') as IAPModule;
  } catch {
    _iapModule = null;
  }
  return _iapModule;
}

const NATIVE_UNAVAILABLE_ERROR =
  'In-app purchases aren’t available in this build yet. Please try again after the next app update.';

/**
 * PLACEHOLDER product ID — replace once the real App Store Connect
 * auto-renewable subscription product is created. When you do, update this
 * constant (and, if you reference it there, app.json). The reverse-DNS bundle
 * prefix should match the app's bundle identifier.
 */
export const SUBSCRIPTION_PRODUCT_ID = 'com.jpx.alloymentors.pro.annual';

export type PurchaseResult =
  | { ok: true; tier: string; expiresAt: string | null }
  | { ok: false; cancelled: boolean; error: string };

let connected = false;
let updateSub: { remove: () => void } | null = null;
let errorSub: { remove: () => void } | null = null;

/**
 * Open the billing connection and attach the global purchase listeners.
 * Safe to call multiple times — it no-ops if already connected. Call once when
 * the paywall mounts.
 */
export async function initIAP(): Promise<void> {
  if (connected) return;
  const IAP = getIAP();
  if (!IAP) throw new Error(NATIVE_UNAVAILABLE_ERROR);
  try {
    await IAP.initConnection();
    connected = true;

    // These listeners are the source of truth for purchase outcomes in the
    // OpenIAP/StoreKit 2 model. The per-purchase promise in
    // `purchaseSubscription` resolves off these via a short-lived bridge.
    updateSub = IAP.purchaseUpdatedListener((purchase: Purchase) => {
      void handlePurchaseUpdate(purchase);
    });
    errorSub = IAP.purchaseErrorListener((err: PurchaseError) => {
      handlePurchaseError(err);
    });
  } catch (e) {
    connected = false;
    throw e;
  }
}

/** Tear down the billing connection and listeners. Call on paywall unmount. */
export async function endIAP(): Promise<void> {
  try {
    updateSub?.remove();
    errorSub?.remove();
    updateSub = null;
    errorSub = null;
    if (connected) {
      const IAP = getIAP();
      if (IAP) await IAP.endConnection();
      connected = false;
    }
  } catch {
    // best-effort teardown
  }
}

/** Fetch the subscription product(s) from the store for display on the paywall. */
export async function getSubscriptionProducts(): Promise<Product[]> {
  if (!connected) await initIAP();
  const IAP = getIAP();
  if (!IAP) throw new Error(NATIVE_UNAVAILABLE_ERROR);
  // `subs` = auto-renewable subscription products.
  const products = await IAP.fetchProducts({
    skus: [SUBSCRIPTION_PRODUCT_ID],
    type: 'subs',
  });
  return (products ?? []) as Product[];
}

// ── Purchase bridge ─────────────────────────────────────────────────────────
// requestPurchase itself is event-based (results arrive on the listeners), so
// we hold the in-flight resolver here and let the listeners settle it.

type PendingResolver = {
  resolve: (r: PurchaseResult) => void;
  organizationId: string;
  settled: boolean;
};
let pending: PendingResolver | null = null;

function settle(result: PurchaseResult) {
  if (pending && !pending.settled) {
    pending.settled = true;
    const resolve = pending.resolve;
    pending = null;
    resolve(result);
  }
}

async function handlePurchaseUpdate(purchase: Purchase): Promise<void> {
  const organizationId = pending?.organizationId ?? null;
  try {
    // Verify server-side BEFORE finishing the transaction, so a failed verify
    // leaves the transaction unfinished and retryable.
    const verified = organizationId
      ? await verifyReceiptWithServer(organizationId)
      : { verified: false, tier: 'free', expiresAt: null as string | null };

    // Acknowledge/finish the transaction with StoreKit so it is not replayed.
    try {
      const IAP = getIAP();
      if (IAP) await IAP.finishTransaction({ purchase, isConsumable: false });
    } catch {
      // If it was auto-finished natively, that's fine.
    }

    if (verified.verified) {
      settle({ ok: true, tier: verified.tier, expiresAt: verified.expiresAt });
    } else {
      settle({
        ok: false,
        cancelled: false,
        error: 'We could not verify your purchase with the App Store. If you were charged, use Restore Purchases.',
      });
    }
  } catch (e) {
    settle({
      ok: false,
      cancelled: false,
      error: e instanceof Error ? e.message : 'Purchase verification failed.',
    });
  }
}

function handlePurchaseError(err: PurchaseError): void {
  const code = (err?.code ?? '').toString();
  const cancelled = code === 'E_USER_CANCELLED' || /cancel/i.test(err?.message ?? '');
  settle({
    ok: false,
    cancelled,
    error: cancelled ? 'Purchase cancelled.' : err?.message || 'The purchase could not be completed.',
  });
}

/**
 * Kick off the subscription purchase flow for the given org. Resolves once the
 * purchase has been verified server-side (Pro unlocked) or has failed/cancelled.
 */
export async function purchaseSubscription(
  productId: string,
  organizationId: string,
): Promise<PurchaseResult> {
  if (Platform.OS !== 'ios') {
    return { ok: false, cancelled: false, error: 'Subscriptions are only available on iOS right now.' };
  }
  if (!connected) await initIAP();
  const IAP = getIAP();
  if (!IAP) return { ok: false, cancelled: false, error: NATIVE_UNAVAILABLE_ERROR };

  // If a purchase is already in flight, refuse a second one.
  if (pending && !pending.settled) {
    return { ok: false, cancelled: false, error: 'A purchase is already in progress.' };
  }

  return new Promise<PurchaseResult>((resolve) => {
    pending = { resolve, organizationId, settled: false };

    // Safety timeout so the UI never hangs forever if no listener fires.
    const timeout = setTimeout(() => {
      settle({ ok: false, cancelled: false, error: 'The purchase timed out. Please try again.' });
    }, 120_000);

    // Wrap resolve so we always clear the timeout.
    const original = pending.resolve;
    pending.resolve = (r: PurchaseResult) => {
      clearTimeout(timeout);
      original(r);
    };

    IAP.requestPurchase({
      request: { apple: { sku: productId } },
      type: 'subs',
    }).catch((e: unknown) => {
      // Most failures surface via the error listener; this catches synchronous
      // request-construction errors.
      settle({
        ok: false,
        cancelled: false,
        error: e instanceof Error ? e.message : 'Could not start the purchase.',
      });
    });
  });
}

/**
 * Restore previously purchased subscriptions. After StoreKit restores, we
 * re-verify the receipt server-side so the org's tier is brought back in sync.
 */
export async function restorePurchases(organizationId?: string): Promise<void> {
  if (!connected) await initIAP();
  const IAP = getIAP();
  if (!IAP) throw new Error(NATIVE_UNAVAILABLE_ERROR);
  await IAP.restorePurchases();
  if (organizationId) {
    try {
      await verifyReceiptWithServer(organizationId);
    } catch {
      // Non-fatal — the caller re-reads org state afterward.
    }
  }
}

/**
 * Pull the on-device App Store receipt and hand it to the edge function for
 * server-side Apple validation. Returns the function's verdict.
 */
async function verifyReceiptWithServer(
  organizationId: string,
): Promise<{ verified: boolean; tier: string; expiresAt: string | null }> {
  const IAP = getIAP();
  if (!IAP) return { verified: false, tier: 'free', expiresAt: null };

  const receipt = await IAP.getReceiptDataIOS();
  if (!receipt) {
    return { verified: false, tier: 'free', expiresAt: null };
  }

  const { data, error } = await supabase.functions.invoke('verify-iap-receipt', {
    body: { receipt, organizationId },
  });
  if (error) throw error;

  const result = (data ?? {}) as { verified?: boolean; tier?: string; expiresAt?: string | null };
  return {
    verified: !!result.verified,
    tier: result.tier ?? 'free',
    expiresAt: result.expiresAt ?? null,
  };
}
