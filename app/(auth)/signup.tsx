import React, { useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { BrandMark } from '@/components/ui/Brand';
import { colors, font, radius } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import * as WebBrowser from 'expo-web-browser';
import { makeRedirectUri } from 'expo-auth-session';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';

export default function SignupScreen() {
  const router = useRouter();
  const { role } = useLocalSearchParams<{ role?: string }>();
  const [formData, setFormData] = useState({ fullName: '', email: '', password: '', school: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [redirectUrl, setRedirectUrl] = useState('');
  React.useEffect(() => {
    WebBrowser.maybeCompleteAuthSession();
    setRedirectUrl('exp://localhost:8081/--/auth/callback');
  }, []);

  const handleSignup = async () => {
    if (!formData.email || !formData.password || !formData.fullName) { setError('Required fields missing.'); return; }
    setLoading(true); setError('');
    const { data: authData, error: signUpError } = await supabase.auth.signUp({
      email: formData.email, 
      password: formData.password,
      options: { data: { full_name: formData.fullName, role: role || 'student', school: formData.school } }
    });
    setLoading(false);
    
    if (signUpError) {
      setError(signUpError.message);
    } else if (authData.session === null) {
      setError('Success! Check your email inbox to verify your account.');
    } else {
      router.replace('/(tabs)');
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      setLoading(true); setError('');
      const authRedirect = 'exp://localhost:8081/--/auth/callback';
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
      <AuroraBackground variant="iris" />
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color="#22271F" />
      </TouchableOpacity>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <BrandMark size={56} style={{ marginBottom: 24 }} />
          <Text style={styles.title}>Create{'\n'}account</Text>
          <Text style={styles.subtitle}>
            You are registering as a verified {role}. Ensure your email is correct.
          </Text>

          <View style={{ gap: 16, marginTop: 28 }}>
            <GlassInput label="Full Name" placeholder="Miles Morales" value={formData.fullName} onChangeText={(val) => setFormData({...formData, fullName: val})} />
            <GlassInput label="Email address" placeholder="miles@example.com" value={formData.email} onChangeText={(val) => setFormData({...formData, email: val})} keyboardType="email-address" autoCapitalize="none" />
            <GlassInput label="Password" placeholder="Secure password" value={formData.password} onChangeText={(val) => setFormData({...formData, password: val})} secureTextEntry />
            <GlassInput label="School (Optional)" placeholder="Visions Academy" value={formData.school} onChangeText={(val) => setFormData({...formData, school: val})} />

            {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

            <GlassButton title={loading ? 'Creating…' : 'Create account'} onPress={handleSignup} disabled={loading} />

            <View style={styles.dividerRow}>
              <View style={styles.line} />
              <Text style={styles.orText}>or continue with</Text>
              <View style={styles.line} />
            </View>

            <TouchableOpacity style={styles.googleBtn} onPress={handleGoogleSignIn} disabled={loading} activeOpacity={0.85}>
              <Ionicons name="logo-google" size={20} color="#22271F" />
              <Text style={styles.googleTxt}>Sign in with Google</Text>
            </TouchableOpacity>

            <View style={styles.devBox}>
              <Text style={styles.devLabel}>For Developers: add this string to your Supabase Redirect URLs</Text>
              <Text style={styles.devUrl}>{redirectUrl}</Text>
            </View>
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
    backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong,
    alignItems: 'center', justifyContent: 'center',
  },
  scrollContent: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 60, justifyContent: 'center', paddingTop: 110 },
  title: { fontFamily: font.black, fontSize: 42, color: colors.text, letterSpacing: -1.5, lineHeight: 44, marginBottom: 12 },
  subtitle: { fontFamily: font.regular, fontSize: 15, color: colors.textDim, lineHeight: 22 },
  errorBox: { backgroundColor: 'rgba(176,138,62,0.12)', borderRadius: radius.sm, padding: 14, borderWidth: 1, borderColor: 'rgba(176,138,62,0.3)' },
  errorText: { fontFamily: font.medium, fontSize: 13, color: colors.gold, textAlign: 'center' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 6 },
  line: { flex: 1, height: 1, backgroundColor: colors.hairline },
  orText: { fontFamily: font.medium, fontSize: 13, color: colors.textGhost, marginHorizontal: 16 },
  googleBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, height: 54, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  googleTxt: { fontFamily: font.medium, fontSize: 15, color: colors.text },
  devBox: { marginTop: 4, padding: 12, backgroundColor: colors.surface, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.hairline },
  devLabel: { fontFamily: font.medium, fontSize: 12, color: colors.textFaint, textAlign: 'center' },
  devUrl: { fontFamily: font.regular, fontSize: 11, color: colors.silver, textAlign: 'center', marginTop: 4 },
});
