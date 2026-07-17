import React, { useEffect, useState } from 'react';
import { View, Text, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { BrandMark } from '@/components/ui/Brand';
import { colors, font } from '@/lib/theme';
import Constants from 'expo-constants';
import { resolveOrgCode, setLastOrg, getLastOrg } from '@/lib/org';

export default function OnboardingScreen() {
  const router = useRouter();
  const [accessCode, setAccessCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(true);

  // If the user has already joined an org, skip straight to that org's sign-in.
  useEffect(() => {
    (async () => {
      const last = await getLastOrg();
      if (last) {
        router.replace({ pathname: '/(auth)/login', params: { role: last.role, code: last.code, orgName: last.orgName, orgId: last.orgId, memberNoun: last.memberNoun, memberNounPlural: last.memberNounPlural } });
      } else {
        setChecking(false);
      }
    })();
  }, [router]);

  const handleVerifyCode = async () => {
    if (!accessCode.trim()) { setError('Please enter your organization code.'); return; }
    setLoading(true); setError('');
    const resolved = await resolveOrgCode(accessCode);
    setLoading(false);
    if (resolved) {
      await setLastOrg(resolved);
      router.replace({ pathname: '/(auth)/login', params: { role: resolved.role, code: resolved.code, orgName: resolved.orgName, orgId: resolved.orgId, memberNoun: resolved.memberNoun, memberNounPlural: resolved.memberNounPlural } });
    } else {
      setError("That code didn't match any organization. Check with your program lead.");
    }
  };

  if (checking) {
    return (
      <View style={styles.screen}>
        <AuroraBackground />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <AuroraBackground />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <BrandMark size={68} />

          <Text style={styles.title}>Alloy Mentors</Text>
          <Text style={styles.subtitle}>
            The hub for mentoring, logistics, and impact — for the people who show up.
          </Text>

          <View style={{ gap: 16, marginTop: 40 }}>
            <View>
              <Text style={styles.codeLabel}>ORGANIZATION CODE</Text>
              <TextInput
                style={styles.codeInput}
                placeholder="ABC-M123"
                placeholderTextColor="rgba(34,39,31,0.22)"
                value={accessCode}
                onChangeText={(t) => setAccessCode(t.toUpperCase())}
                autoCapitalize="characters"
                autoCorrect={false}
                autoComplete="off"
                returnKeyType="go"
                onSubmitEditing={handleVerifyCode}
              />
            </View>

            {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

            <GlassButton title={loading ? 'Verifying…' : 'Enter Portal'} onPress={handleVerifyCode} disabled={loading} />

            <View style={styles.dividerRow}>
              <View style={styles.line} />
              <Text style={styles.orText}>or</Text>
              <View style={styles.line} />
            </View>

            {/* Self-serve: Bob starts his own org and shares its codes */}
            <TouchableOpacity onPress={() => router.push('/(auth)/create-org')} style={styles.createOrgBtn} activeOpacity={0.85}>
              <Ionicons name="add-circle-outline" size={18} color="#2C7C96" />
              <Text style={styles.createOrgTxt}>Start a new organization</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.footnote}>Alloy Mentors · v{Constants.expoConfig?.version ?? '1.1.0'}</Text>
          <TouchableOpacity onPress={() => router.push('/credits')} style={{ marginTop: 6 }}>
            <Text style={styles.creditsTxt}>an app by JPX.co</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 2 },
  line: { flex: 1, height: 1, backgroundColor: colors.hairline },
  orText: { fontFamily: font.medium, fontSize: 13, color: colors.textGhost, marginHorizontal: 14 },
  createOrgBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.18)', borderRadius: 16, paddingVertical: 15 },
  createOrgTxt: { fontFamily: font.semibold, fontSize: 14.5, color: '#2C7C96' },
  scrollContent: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 60, justifyContent: 'center', paddingTop: 80 },
  title: { fontFamily: font.black, fontSize: 30, color: '#165B74', letterSpacing: -0.8, marginTop: 26, marginBottom: 12 },
  subtitle: { fontFamily: font.regular, fontSize: 15.5, color: colors.textDim, lineHeight: 24 },
  errorBox: { backgroundColor: 'rgba(176,138,62,0.12)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(176,138,62,0.3)' },
  errorText: { fontFamily: font.medium, fontSize: 13, color: colors.gold, textAlign: 'center' },
  codeLabel: { fontFamily: font.semibold, fontSize: 11, color: colors.silver, letterSpacing: 1.5, marginBottom: 8, textAlign: 'center' },
  codeInput: { fontFamily: font.bold, fontSize: 22, color: colors.text, textAlign: 'center', letterSpacing: 5, backgroundColor: colors.surfaceStrong, borderWidth: 1.5, borderColor: 'rgba(22,91,116,0.3)', borderRadius: 16, paddingVertical: 17, paddingHorizontal: 16 },
  footnote: { fontFamily: font.medium, fontSize: 12, color: colors.textGhost, textAlign: 'center', marginTop: 36, letterSpacing: 0.5 },
  creditsTxt: { fontFamily: font.regular, fontSize: 11, color: colors.textGhost, textAlign: 'center', opacity: 0.6 },
});
