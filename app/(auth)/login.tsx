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
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';

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
  
  // Redirect URI that actually works on device + standalone builds (uses the app scheme).
  const redirectUrl = makeRedirectUri({ scheme: 'alloymentors', path: 'auth/callback' });
  React.useEffect(() => { WebBrowser.maybeCompleteAuthSession(); }, []);

  const handleLogin = async () => {
    if (!email || !password) { setError('All fields are required.'); return; }
    setLoading(true); setError('');
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (authError) setError(authError.message);
    else router.replace('/(tabs)');
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true); setError('');
      const authRedirect = redirectUrl;
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: authRedirect,
          skipBrowserRedirect: true,
        }
      });
      if (error) throw error;

      if (data.url) {
        const res = await WebBrowser.openAuthSessionAsync(data.url, authRedirect);
        if (res.type !== 'success') { setError('Google sign-in was cancelled.'); return; }
        if (res.type === 'success' && res.url) {
          const hashIdx = res.url.indexOf('#');
          if (hashIdx !== -1) {
            const hash = res.url.substring(hashIdx + 1);
            const params = hash.split('&').reduce((acc, current) => {
              const [key, value] = current.split('=');
              acc[key] = decodeURIComponent(value);
              return acc;
            }, {} as Record<string, string>);
            
            if (params.access_token && params.refresh_token) {
              await supabase.auth.setSession({ 
                access_token: params.access_token, 
                refresh_token: params.refresh_token 
              });
              router.replace('/(tabs)');
            }
          }
        }
      }
    } catch (err: any) {
      setError(err.message || 'Google sign-in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.screen}>
      <AuroraBackground />
      <TouchableOpacity onPress={switchOrg} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color="#22271F" />
      </TouchableOpacity>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <BrandMark size={56} style={{ marginBottom: 18 }} />
          {orgName ? (
            <View style={styles.orgChip}>
              <Ionicons name="business-outline" size={13} color={colors.silver} />
              <Text style={styles.orgChipTxt}>{orgName}</Text>
            </View>
          ) : null}
          <Text style={styles.title}>Welcome{'\n'}back</Text>
          <Text style={styles.subtitle}>
            Signing in to {orgName || 'your organization'} as a {role || 'member'}.
          </Text>

          <View style={{ gap: 16, marginTop: 32 }}>
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

            <View style={styles.socialRow}>
              <TouchableOpacity
                style={[styles.socialBtn, { width: '100%', flexDirection: 'row', gap: 12 }]}
                onPress={handleGoogleSignIn}
                disabled={loading}
              >
                <Ionicons name="logo-google" size={20} color="#22271F" />
                <Text style={{ fontFamily: 'Inter-Medium', fontSize: 15, color: '#22271F' }}>Sign in with Google</Text>
              </TouchableOpacity>
            </View>

            {__DEV__ && (
              <View style={{ marginTop: 12, padding: 12, backgroundColor: 'rgba(196,196,196,0.12)', borderRadius: 8 }}>
                <Text style={{ fontFamily: 'Inter-Medium', fontSize: 12, color: 'rgba(34,39,31,0.4)', textAlign: 'center' }}>
                  Dev: add this to Supabase Redirect URLs
                </Text>
                <Text style={{ fontFamily: 'Inter-Regular', fontSize: 11, color: '#2C7C96', textAlign: 'center', marginTop: 4 }}>
                  {redirectUrl}
                </Text>
              </View>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 8 }}>
              <Text style={styles.footerText}>Not registered yet? </Text>
              <TouchableOpacity onPress={() => router.push({ pathname: '/(auth)/intake', params: { role, orgName, orgId, memberNoun, memberNounPlural } })}>
                <Text style={styles.footerLink}>Create account</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={switchOrg} style={{ alignItems: 'center', marginTop: 4 }}>
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
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1, borderColor: colors.hairlineStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  scrollContent: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 60, justifyContent: 'center', paddingTop: 120 },
  title: { fontFamily: font.black, fontSize: 42, color: colors.text, letterSpacing: -1.5, lineHeight: 44, marginBottom: 12 },
  subtitle: { fontFamily: font.regular, fontSize: 15, color: colors.textDim, lineHeight: 22 },
  errorBox: { backgroundColor: 'rgba(176,138,62,0.12)', borderRadius: radius.sm, padding: 14, borderWidth: 1, borderColor: 'rgba(176,138,62,0.3)' },
  errorText: { fontFamily: font.medium, fontSize: 13, color: colors.gold, textAlign: 'center' },
  footerText: { fontFamily: font.regular, fontSize: 14, color: colors.textFaint },
  footerLink: { fontFamily: font.bold, fontSize: 14, color: colors.silver },
  switchOrgTxt: { fontFamily: font.medium, fontSize: 13, color: colors.textFaint, textDecorationLine: 'underline' },
  forgotTxt: { fontFamily: font.semibold, fontSize: 13, color: colors.silver },
  orgChip: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 14 },
  orgChipTxt: { fontFamily: font.semibold, fontSize: 12, color: colors.silver, letterSpacing: 1 },

  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 6 },
  line: { flex: 1, height: 1, backgroundColor: colors.hairline },
  orText: { fontFamily: font.medium, fontSize: 13, color: colors.textGhost, marginHorizontal: 16, textTransform: 'lowercase' },
  socialRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 8 },
  socialBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center', justifyContent: 'center' },
});
