import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { AlloyQR } from '@/components/ui/AlloyQR';
import { colors, font } from '@/lib/theme';
import { useUser } from '@/contexts/UserContext';
import { roleLabel } from '@/lib/roles';
import { makeCheckinPayload, secondsUntilRotation, QR_ROTATION_SECONDS } from '@/lib/qr';

export default function MyQRScreen() {
  const { profile, org } = useUser();
  const [payload, setPayload] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(QR_ROTATION_SECONDS);
  const pulse = useRef(new Animated.Value(1)).current;

  // Regenerate the signed payload on every rotation boundary; tick the countdown.
  useEffect(() => {
    if (!profile?.id) return;
    let cancelled = false;
    const regen = async () => {
      const p = await makeCheckinPayload(profile.id);
      if (!cancelled) setPayload(p);
    };
    regen();
    const tick = setInterval(() => {
      const left = secondsUntilRotation();
      setCountdown(left);
      if (left === QR_ROTATION_SECONDS) regen(); // just rolled over
    }, 1000);
    return () => { cancelled = true; clearInterval(tick); };
  }, [profile?.id]);

  // Soft "live" pulse on the status dot.
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <SafeAreaView style={styles.container}>
      <AuroraBackground />

      <View style={styles.header}>
        <Text style={styles.title}>My Check-In QR</Text>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color="#22271F" />
        </TouchableOpacity>
      </View>

      {!profile?.id || !payload ? (
        <View style={styles.body}>
          <Ionicons name="hourglass-outline" size={40} color={colors.textFaint} />
          <Text style={[styles.hint, { textAlign: 'center', maxWidth: 260 }]}>
            Preparing your check-in code…
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.qrCard}>
            {org?.name ? <Text style={styles.orgEyebrow}>{org.name.toUpperCase()}</Text> : null}
            <AlloyQR value={payload} size={248} />
            {/* rotation countdown */}
            <View style={styles.liveRow}>
              <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
              <Text style={styles.liveTxt}>Refreshes in {countdown}s</Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.trackFill, { width: `${(countdown / QR_ROTATION_SECONDS) * 100}%` }]} />
            </View>
            <Text style={styles.name}>{profile?.full_name ?? 'Tutor'}</Text>
            <Text style={styles.role}>{roleLabel(profile?.role, null, org?.memberNoun)}</Text>
          </View>

          <View style={styles.hintRow}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textFaint} />
            <Text style={styles.hint}>
              Show this at the door to be marked present. The code re-signs itself every
              {' '}{QR_ROTATION_SECONDS} seconds, so screenshots go stale — only the live screen works.
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontFamily: font.black, fontSize: 26, color: colors.text, letterSpacing: -0.6 },
  closeBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 24 },
  qrCard: { alignItems: 'center', padding: 26, borderRadius: 28, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, gap: 12 },
  orgEyebrow: { fontFamily: font.bold, fontSize: 11, color: '#3E6A52', letterSpacing: 3 },

  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 2 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3E6A52' },
  liveTxt: { fontFamily: font.medium, fontSize: 12.5, color: 'rgba(34,39,31,0.55)' },
  track: { width: 200, height: 4, borderRadius: 2, backgroundColor: 'rgba(43,70,56,0.12)', overflow: 'hidden' },
  trackFill: { height: '100%', backgroundColor: '#375946', borderRadius: 2 },

  name: { fontFamily: font.bold, fontSize: 20, color: colors.text, letterSpacing: -0.3, marginTop: 4 },
  role: { fontFamily: font.medium, fontSize: 14, color: colors.titanium },

  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 8, maxWidth: 340 },
  hint: { flex: 1, fontFamily: font.regular, fontSize: 13, color: colors.textFaint, lineHeight: 19 },
});
