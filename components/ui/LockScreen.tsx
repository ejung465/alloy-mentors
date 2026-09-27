import React, { useState } from 'react';
import { Alert, View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font } from '@/lib/theme';
import { authenticateAsync, setAppLockEnabled } from '@/lib/appLock';
import { supabase } from '@/lib/supabase';

const PINE = '#165B74';
const INK = '#22271F';

interface LockScreenProps {
  onUnlock: () => void;
}

/**
 * Full-screen cream/pine lock overlay. Rendered by AppLockGate whenever the
 * user has app-lock enabled and the app hasn't been unlocked this session.
 */
export function LockScreen({ onUnlock }: LockScreenProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const handleUnlock = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const ok = await authenticateAsync();
      if (ok) {
        onUnlock();
      } else {
        setError('Authentication was not completed. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  // Escape hatch: if Face ID/Touch ID is stuck failing (removed biometrics,
  // hardware issue, etc.), a user must never be permanently locked out with
  // no way forward. Signing out and disabling the lock lets them get back in
  // through a normal email/social login, then re-enable the lock later.
  const handleCantUnlock = () => {
    Alert.alert(
      "Can't unlock?",
      'Signing out will turn off the app lock and take you back to sign-in. You can turn it on again anytime from Settings.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await setAppLockEnabled(false);
            await supabase.auth.signOut();
            onUnlock();
          },
        },
      ]
    );
  };

  return (
    <View style={styles.overlay}>
      <AuroraBackground variant="iris" />
      <SafeAreaView style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="lock-closed" size={30} color={PINE} />
        </View>
        <Text style={styles.title}>Unlock Alloy Mentors</Text>
        <Text style={styles.subtitle}>Use Face ID or Touch ID to continue.</Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        <TouchableOpacity onPress={handleUnlock} disabled={busy} style={[styles.unlockBtn, busy && { opacity: 0.6 }]} activeOpacity={0.85}>
          <Ionicons name="finger-print-outline" size={18} color={colors.base} style={{ marginRight: 8 }} />
          <Text style={styles.unlockBtnText}>{busy ? 'Checking…' : 'Unlock'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleCantUnlock} disabled={busy} style={styles.escapeBtn} activeOpacity={0.7}>
          <Text style={styles.escapeBtnText}>Can't unlock? Sign out</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.base, zIndex: 999, elevation: 999 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  iconWrap: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(22,91,116,0.1)',
    borderWidth: 1.5, borderColor: 'rgba(22,91,116,0.28)', alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  title: { fontFamily: font.black, fontSize: 24, color: INK, letterSpacing: -0.5, marginBottom: 8, textAlign: 'center' },
  subtitle: { fontFamily: font.regular, fontSize: 14.5, color: colors.textDim, textAlign: 'center', marginBottom: 28 },
  errorText: { fontFamily: font.medium, fontSize: 13, color: colors.rose, textAlign: 'center', marginBottom: 16 },
  unlockBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.platinum, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 36,
  },
  unlockBtnText: { fontFamily: font.bold, fontSize: 15, color: colors.base },
  escapeBtn: { marginTop: 18, paddingVertical: 8, paddingHorizontal: 12 },
  escapeBtnText: { fontFamily: font.medium, fontSize: 13, color: colors.textFaint, textDecorationLine: 'underline' },
});
