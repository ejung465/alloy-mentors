import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { BrandMark } from '@/components/ui/Brand';
import { colors, font } from '@/lib/theme';
import { supabase } from '@/lib/supabase';

const INK = '#22271F';

type Phase = 'email' | 'code' | 'password' | 'done';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  const sendCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email.'); return; }
    setBusy(true); setError('');
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    setBusy(false);
    // Don't reveal whether the address exists — same message either way.
    if (error) { setError(error.message); return; }
    setPhase('code');
  };

  const verifyCode = async () => {
    if (code.trim().length < 6) { setError('Enter the 6-digit code.'); return; }
    setBusy(true); setError('');
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'recovery',
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setPhase('password');
  };

  const setNewPassword = async () => {
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords don’t match.'); return; }
    setBusy(true); setError('');
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { setError(error.message); return; }
    setPhase('done');
  };

  return (
    <View style={styles.screen}>
      <AuroraBackground />
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color={INK} />
      </TouchableOpacity>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <BrandMark size={52} style={{ marginBottom: 18 }} />

          {phase === 'email' && (
            <>
              <Text style={styles.title}>Reset your{'\n'}password</Text>
              <Text style={styles.subtitle}>We'll send a 6-digit code to your email.</Text>
              <View style={{ gap: 16, marginTop: 28 }}>
                <GlassInput label="Email address" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <GlassButton title={busy ? 'Sending…' : 'Send code'} onPress={sendCode} disabled={busy} />
              </View>
            </>
          )}

          {phase === 'code' && (
            <>
              <Text style={styles.title}>Check your{'\n'}email</Text>
              <Text style={styles.subtitle}>Enter the code we sent to {email.trim()}.</Text>
              <View style={{ gap: 16, marginTop: 28 }}>
                <GlassInput label="Verification code" placeholder="123456" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <GlassButton title={busy ? 'Verifying…' : 'Verify'} onPress={verifyCode} disabled={busy} />
                <TouchableOpacity onPress={sendCode} disabled={busy} style={{ alignItems: 'center' }}>
                  <Text style={styles.linkTxt}>Resend code</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {phase === 'password' && (
            <>
              <Text style={styles.title}>New{'\n'}password</Text>
              <Text style={styles.subtitle}>Choose a password with at least 8 characters.</Text>
              <View style={{ gap: 16, marginTop: 28 }}>
                <GlassInput label="New password" placeholder="At least 8 characters" value={password} onChangeText={setPassword} secureTextEntry />
                <GlassInput label="Confirm password" placeholder="Type it again" value={confirm} onChangeText={setConfirm} secureTextEntry />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <GlassButton title={busy ? 'Saving…' : 'Set new password'} onPress={setNewPassword} disabled={busy} />
              </View>
            </>
          )}

          {phase === 'done' && (
            <>
              <View style={styles.doneBadge}>
                <Ionicons name="checkmark" size={26} color="#F5EFE3" />
              </View>
              <Text style={styles.title}>Password{'\n'}updated</Text>
              <Text style={styles.subtitle}>You're signed in with your new password.</Text>
              <View style={{ marginTop: 24 }}>
                <GlassButton title="Continue" onPress={() => router.replace('/(tabs)')} />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  backBtn: { position: 'absolute', top: 56, left: 20, zIndex: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 116, paddingBottom: 60 },
  title: { fontFamily: font.black, fontSize: 38, color: colors.text, letterSpacing: -1.4, lineHeight: 42, marginBottom: 12 },
  subtitle: { fontFamily: font.regular, fontSize: 15, color: colors.textDim, lineHeight: 22 },
  error: { fontFamily: font.medium, fontSize: 13, color: '#B15A4E' },
  linkTxt: { fontFamily: font.semibold, fontSize: 14, color: '#3E6A52' },
  doneBadge: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#3E6A52', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
});
