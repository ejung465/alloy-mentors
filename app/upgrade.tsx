import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassButton } from '@/components/ui/GlassButton';
import { colors, font, radius, space } from '@/lib/theme';
import { useUser } from '@/contexts/UserContext';
import { supabase } from '@/lib/supabase';
import { canManageOrg } from '@/lib/roles';
import {
  SUBSCRIPTION_PRODUCT_ID,
  initIAP,
  endIAP,
  getSubscriptionProducts,
  purchaseSubscription,
  restorePurchases,
  type PurchaseResult,
} from '@/lib/iap';
import type { Product } from 'react-native-iap';

/**
 * Paywall / upgrade screen.
 *
 * Admin-only (subscription is an org-level thing). This is scaffolding: until
 * the App Store Connect subscription product `SUBSCRIPTION_PRODUCT_ID` exists,
 * `getSubscriptionProducts()` returns nothing and the button shows a friendly
 * "not available yet" state instead of crashing.
 *
 * The Free-vs-Pro feature split below is a PLACEHOLDER — the actual split has
 * not been decided yet. Update `PRO_FEATURES` / `FREE_FEATURES` once it is.
 */

const FREE_FEATURES = [
  'Up to a starter number of students',
  'Core check-in, hours, and progress',
  'Community support',
];

const PRO_FEATURES = [
  'Unlimited students',
  'Advanced analytics & reporting',
  'Priority support',
];

// Fallback display price if the store product hasn't loaded / doesn't exist yet.
const FALLBACK_PRICE_LABEL = '$2.99–4.99 / yr';

export default function UpgradeScreen() {
  const { profile, org, refresh } = useUser();
  const canManage = canManageOrg(profile?.role);

  const [loadingProducts, setLoadingProducts] = useState(true);
  const [product, setProduct] = useState<Product | null>(null);
  const [productError, setProductError] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // The signed-in org's subscription tier isn't carried on the UserContext Org
  // object, so we read it straight from the row (and re-read after a purchase).
  const [currentTier, setCurrentTier] = useState<string>('free');
  const isPro = currentTier === 'pro';

  const refreshTier = useCallback(async () => {
    if (!org?.id) return;
    const { data } = await supabase
      .from('organizations')
      .select('subscription_tier')
      .eq('id', org.id)
      .maybeSingle();
    if (data?.subscription_tier) setCurrentTier(data.subscription_tier as string);
  }, [org?.id]);

  const loadProducts = useCallback(async () => {
    setLoadingProducts(true);
    setProductError(null);
    try {
      await initIAP();
      const products = await getSubscriptionProducts();
      setProduct(products[0] ?? null);
      if (products.length === 0) {
        // Not an error the user caused — the store product simply isn't live yet.
        setProductError('Subscriptions aren’t available on this device yet. Please try again later.');
      }
    } catch (e) {
      setProductError(
        e instanceof Error ? e.message : 'We couldn’t reach the App Store. Please try again.',
      );
    } finally {
      setLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    if (!canManage) return;
    void loadProducts();
    void refreshTier();
    return () => {
      void endIAP();
    };
  }, [canManage, loadProducts, refreshTier]);

  const priceLabel =
    (product && (product as { displayPrice?: string }).displayPrice) || FALLBACK_PRICE_LABEL;

  const handleSubscribe = async () => {
    if (!org?.id) {
      setNotice('We couldn’t find your organization. Please reopen the app and try again.');
      return;
    }
    setNotice(null);
    setPurchasing(true);
    try {
      const result: PurchaseResult = await purchaseSubscription(
        product?.id ?? SUBSCRIPTION_PRODUCT_ID,
        org.id,
      );
      if (result.ok) {
        setNotice('You’re on Pro. Thank you!');
        await refreshTier();
        await refresh();
      } else if (result.cancelled) {
        // Silent — the user backed out on purpose.
      } else {
        setNotice(result.error);
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'The purchase could not be completed.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    if (!org?.id) return;
    setNotice(null);
    setRestoring(true);
    try {
      await restorePurchases(org.id);
      await refreshTier();
      await refresh();
      setNotice('Purchases restored. If you had an active subscription, Pro is now unlocked.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'We couldn’t restore your purchases.');
    } finally {
      setRestoring(false);
    }
  };

  // ── Non-admin gate ────────────────────────────────────────────────────────
  if (!canManage) {
    return (
      <SafeAreaView style={styles.container}>
        <AuroraBackground />
        <Header />
        <View style={styles.gate}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.textFaint} />
          <Text style={styles.gateTitle}>Admins only</Text>
          <Text style={styles.gateBody}>
            Subscriptions are managed at the organization level. Ask an admin or leader in your
            org to upgrade.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <AuroraBackground />
      <Header />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Current tier */}
        <View style={styles.tierChipRow}>
          <View style={[styles.tierChip, isPro ? styles.tierChipPro : null]}>
            <Ionicons
              name={isPro ? 'star' : 'star-outline'}
              size={14}
              color={isPro ? colors.base : colors.mint}
            />
            <Text style={[styles.tierChipTxt, isPro ? { color: colors.base } : null]}>
              {isPro ? 'Pro' : 'Free'} plan
            </Text>
          </View>
          {org?.name ? <Text style={styles.orgName}>{org.name}</Text> : null}
        </View>

        <Text style={styles.headline}>
          {isPro ? 'You’re on Alloy Pro' : 'Unlock Alloy Pro'}
        </Text>
        <Text style={styles.sub}>
          {isPro
            ? 'Thanks for supporting Alloy. Manage your subscription in the App Store.'
            : 'Upgrade your whole organization to Pro.'}
        </Text>

        {/* Feature comparison */}
        <View style={styles.compareRow}>
          <PlanColumn title="Free" features={FREE_FEATURES} highlight={!isPro} muted />
          <PlanColumn title="Pro" features={PRO_FEATURES} highlight />
        </View>

        <Text style={styles.placeholderNote}>
          Feature list is a placeholder — the exact Free vs Pro split is still being finalized.
        </Text>

        {/* Notice / error banner */}
        {notice ? (
          <GlassCard style={{ marginTop: space.md }} contentStyle={{ padding: 14 }}>
            <Text style={styles.notice}>{notice}</Text>
          </GlassCard>
        ) : null}

        {/* CTA */}
        {!isPro ? (
          <View style={{ marginTop: space.lg }}>
            {loadingProducts ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.platinum} />
                <Text style={styles.loadingTxt}>Loading plans…</Text>
              </View>
            ) : productError ? (
              <GlassCard contentStyle={{ padding: 16, alignItems: 'center', gap: 12 }}>
                <Text style={styles.errTxt}>{productError}</Text>
                <TouchableOpacity onPress={loadProducts} style={styles.retryBtn}>
                  <Ionicons name="refresh" size={16} color={colors.platinum} />
                  <Text style={styles.retryTxt}>Try again</Text>
                </TouchableOpacity>
              </GlassCard>
            ) : (
              <GlassButton
                title={purchasing ? 'Processing…' : `Subscribe — ${priceLabel}`}
                onPress={handleSubscribe}
                disabled={purchasing}
              />
            )}

            <TouchableOpacity
              onPress={handleRestore}
              disabled={restoring}
              style={styles.restoreBtn}
              hitSlop={8}
            >
              <Text style={styles.restoreTxt}>
                {restoring ? 'Restoring…' : 'Restore Purchases'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.fineprint}>
              Billed through your Apple ID and shared across your whole organization. Auto-renews
              until cancelled; manage or cancel anytime in the App Store.
            </Text>
          </View>
        ) : (
          <View style={{ marginTop: space.lg }}>
            <TouchableOpacity
              onPress={handleRestore}
              disabled={restoring}
              style={styles.restoreBtn}
              hitSlop={8}
            >
              <Text style={styles.restoreTxt}>
                {restoring ? 'Restoring…' : 'Restore Purchases'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.title}>Upgrade</Text>
      <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
        <Ionicons name="close" size={20} color="#22271F" />
      </TouchableOpacity>
    </View>
  );
}

function PlanColumn({
  title,
  features,
  highlight,
  muted,
}: {
  title: string;
  features: string[];
  highlight?: boolean;
  muted?: boolean;
}) {
  return (
    <View style={[styles.col, highlight ? styles.colHighlight : null]}>
      <Text style={[styles.colTitle, highlight ? { color: colors.platinum } : null]}>{title}</Text>
      <View style={{ gap: 10, marginTop: 12 }}>
        {features.map((f, i) => (
          <View key={i} style={styles.featRow}>
            <Ionicons
              name={muted ? 'ellipse-outline' : 'checkmark-circle'}
              size={16}
              color={muted ? colors.textGhost : colors.mint}
            />
            <Text style={styles.featTxt}>{f}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { fontFamily: font.black, fontSize: 26, color: colors.text, letterSpacing: -0.6 },
  closeBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.hairlineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scroll: { paddingHorizontal: 20, paddingBottom: 48 },

  tierChipRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 },
  tierChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.hairline,
  },
  tierChipPro: { backgroundColor: colors.platinum, borderColor: colors.platinum },
  tierChipTxt: { fontFamily: font.bold, fontSize: 12, color: colors.mint, letterSpacing: 0.3 },
  orgName: { fontFamily: font.medium, fontSize: 13, color: colors.textFaint },

  headline: {
    fontFamily: font.black,
    fontSize: 28,
    color: colors.text,
    letterSpacing: -0.7,
    marginTop: 16,
  },
  sub: { fontFamily: font.regular, fontSize: 15, color: colors.textDim, marginTop: 6, lineHeight: 21 },

  compareRow: { flexDirection: 'row', gap: 12, marginTop: 22 },
  col: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.hairline,
    backgroundColor: colors.surface,
    padding: 16,
  },
  colHighlight: { borderColor: colors.platinum, backgroundColor: colors.surfaceStrong },
  colTitle: { fontFamily: font.bold, fontSize: 16, color: colors.text },
  featRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  featTxt: { flex: 1, fontFamily: font.regular, fontSize: 13, color: colors.textDim, lineHeight: 18 },

  placeholderNote: {
    fontFamily: font.regular,
    fontSize: 12,
    color: colors.textGhost,
    marginTop: 12,
    fontStyle: 'italic',
  },

  notice: { fontFamily: font.medium, fontSize: 13.5, color: colors.text, lineHeight: 19 },

  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  loadingTxt: { fontFamily: font.medium, fontSize: 14, color: colors.textDim },

  errTxt: { fontFamily: font.regular, fontSize: 14, color: colors.textDim, textAlign: 'center', lineHeight: 20 },
  retryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12 },
  retryTxt: { fontFamily: font.semibold, fontSize: 14, color: colors.platinum },

  restoreBtn: { alignItems: 'center', justifyContent: 'center', paddingVertical: 16 },
  restoreTxt: { fontFamily: font.semibold, fontSize: 14.5, color: colors.platinum },

  fineprint: {
    fontFamily: font.regular,
    fontSize: 11.5,
    color: colors.textGhost,
    textAlign: 'center',
    lineHeight: 17,
    marginTop: 4,
  },

  gate: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  gateTitle: { fontFamily: font.bold, fontSize: 20, color: colors.text },
  gateBody: { fontFamily: font.regular, fontSize: 14.5, color: colors.textDim, textAlign: 'center', lineHeight: 21 },
});
