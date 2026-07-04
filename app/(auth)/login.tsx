import React, { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { BrandMark } from '@/components/ui/Brand';
import { colors, font, radius } from '@/lib/theme';
import { clearLastOrg } from '@/lib/org';
import { supabase } from '@/lib/supabase';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import {
  signInWithApple, signInWithGoogle, signInWithLinkedIn,
  appleAuthAvailable, googleAuthConfigured, hasExistingProfile,
} from '@/lib/socialAuth';

export default function LoginScreen() {
  const router = useRouter();
  const { role, orgName, orgId, memberNoun, memberNounPlural } = useLocalSearchParams<{ role?: string, code?: string, orgName?: string, orgId?: string, memberNoun?: string, memberNounPlural?: string }>();

  const switchOrg = async () => {
    await clearLastOrg();
    router.replace('/(auth)/onboarding');
  };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!email || !password) { setError('All fields are required.'); return; }
    setLoading(true); setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) setError(authError.message);
    else router.replace('/(tabs)');
  };

  const [socialBusy, setSocialBusy] = useState<'apple' | 'google' | 'linkedin' | null>(null);

  // Existing member -> straight in. Brand-new person via a social button ->
  // intake, carrying the same org context this screen already resolved.
  const afterSocialAuth = async () => {
    if (await hasExistingProfile()) router.replace('/(tabs)');
    else router.replace({ pathname: '/(auth)/intake', params: { role, orgName, orgId, memberNoun, memberNounPlural } });
  };

  const runSocial = async (kind: 'apple' | 'google' | 'linkedin', fn: () => Promise<{ error: string | null }>) => {
    setSocialBusy(kind); setError('');
    const { error: authError } = await fn();
    setSocialBusy(null);
    if (authError) { setError(authError); return; }
    await afterSocialAuth();
  };

  return (
    <View style={styles.screen}>
      <AuroraBackground />
      <TouchableOpacity onPress={switchOrg} style={styles.backBtn} activeOpacity={0.8}>
        <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFillObject} />
        <Ionicons name="chevron-back" size={22} color="#22271F" />
      </TouchableOpacity>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <BrandMark size={56} style={{ marginBottom: 18 }} />
          {orgName ? (
            <View style={styles.orgChip}>
              <Ionicons name="business-outline" size={13} color="#C5642D" />
              <Text style={styles.orgChipTxt}>{orgName}</Text>
            </View>
          ) : null}
          <Text style={styles.title}>Welcome{'\n'}back</Text>
          <Text style={styles.subtitle}>
            Signing in to {orgName || 'your organization'} as a {role || 'member'}.
          </Text>

          {/* Log in / Create account — equally visible from the start */}
          <View style={styles.modeRow}>
            <View style={[styles.modeBtn, styles.modeBtnOn]}>
              <Text style={styles.modeTxtOn}>Log In</Text>
            </View>
            <TouchableOpacity
              style={styles.modeBtn}
              activeOpacity={0.85}
              onPress={() => router.push({ pathname: '/(auth)/intake', params: { role, orgName, orgId, memberNoun, memberNounPlural } })}
            >
              <Text style={styles.modeTxt}>Create Account</Text>
            </TouchableOpacity>
          </View>

          <View style={{ gap: 16, marginTop: 20 }}>
            <GlassInput label="Email address" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            <GlassInput label="Password" placeholder="Your secure password" value={password} onChangeText={setPassword} secureTextEntry />

            <TouchableOpacity onPress={() => router.push('/(auth)/forgot-password')} style={{ alignSelf: 'flex-end' }}>
              <Text style={styles.forgotTxt}>Forgot password?</Text>
            </TouchableOpacity>

            {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

            <GlassButton title={loading ? 'Signing in…' : 'Log In'} onPress={handleLogin} disabled={loading} />

            <View style={styles.dividerRow}>
              <View style={styles.line} />
              <Text style={styles.orText}>or continue with</Text>
              <View style={styles.line} />
            </View>

            <View style={styles.socialCol}>
              {appleAuthAvailable && (
                <TouchableOpacity
                  style={styles.socialRow}
                  activeOpacity={0.85}
                  disabled={!!socialBusy}
                  onPress={() => runSocial('apple', signInWithApple)}
                >
                  <Ionicons name="logo-apple" size={19} color="#22271F" />
                  <Text style={styles.socialTxt}>{socialBusy === 'apple' ? 'Signing in…' : 'Continue with Apple'}</Text>
                </TouchableOpacity>
              )}
              {googleAuthConfigured && (
                <TouchableOpacity
                  style={styles.socialRow}
                  activeOpacity={0.85}
                  disabled={!!socialBusy}
                  onPress={() => runSocial('google', signInWithGoogle)}
                >
                  <Ionicons name="logo-google" size={18} color="#22271F" />
                  <Text style={styles.socialTxt}>{socialBusy === 'google' ? 'Signing in…' : 'Continue with Google'}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={styles.socialRow}
                activeOpacity={0.85}
                disabled={!!socialBusy}
                onPress={() => runSocial('linkedin', signInWithLinkedIn)}
              >
                <Ionicons name="logo-linkedin" size={19} color="#0A66C2" />
                <Text style={styles.socialTxt}>{socialBusy === 'linkedin' ? 'Signing in…' : 'Continue with LinkedIn'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={switchOrg} style={{ alignItems: 'center', marginTop: 12 }}>
              <Text style={styles.switchOrgTxt}>Join a different organization</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  backBtn: {
    position: 'absolute', top: 56, left: 20, zIndex: 20,
    width: 40, height: 40, borderRadius: 20,
    overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.45)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.65)',
    alignItems: 'center', justifyContent: 'center',
  },
  scrollContent: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 60, justifyContent: 'center', paddingTop: 120 },
  title: { fontFamily: font.black, fontSize: 42, color: colors.text, letterSpacing: -1.5, lineHeight: 44, marginBottom: 12 },
  subtitle: { fontFamily: font.regular, fontSize: 15, color: colors.textDim, lineHeight: 22 },
  errorBox: { backgroundColor: 'rgba(176,138,62,0.12)', borderRadius: radius.sm, padding: 14, borderWidth: 1, borderColor: 'rgba(176,138,62,0.3)' },
  errorText: { fontFamily: font.medium, fontSize: 13, color: colors.gold, textAlign: 'center' },
  modeRow: { flexDirection: 'row', backgroundColor: 'rgba(196,196,196,0.22)', borderRadius: 14, padding: 4, marginTop: 24 },
  modeBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 11 },
  modeBtnOn: { backgroundColor: '#165B74' },
  modeTxtOn: { fontFamily: font.bold, fontSize: 14, color: '#F4F6F6' },
  modeTxt: { fontFamily: font.semibold, fontSize: 14, color: 'rgba(34,39,31,0.6)' },
  switchOrgTxt: { fontFamily: font.medium, fontSize: 13, color: colors.textFaint, textDecorationLine: 'underline' },
  forgotTxt: { fontFamily: font.semibold, fontSize: 13, color: colors.silver },
  orgChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: 'rgba(197,100,45,0.10)', borderWidth: 1, borderColor: 'rgba(197,100,45,0.30)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 14 },
  orgChipTxt: { fontFamily: font.semibold, fontSize: 12, color: '#C5642D', letterSpacing: 1 },
  socialCol: { gap: 10 },
  socialTxt: { fontFamily: font.medium, fontSize: 15, color: '#22271F' },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 6 },
  line: { flex: 1, height: 1, backgroundColor: colors.hairline },
  orText: { fontFamily: font.medium, fontSize: 13, color: colors.textGhost, marginHorizontal: 16, textTransform: 'lowercase' },
  socialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, borderRadius: 14, paddingVertical: 14 },
});
