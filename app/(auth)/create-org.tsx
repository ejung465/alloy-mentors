import React, { useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, ScrollView, Share, StyleSheet,
  Text, TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { BrandMark } from '@/components/ui/Brand';
import { colors, font, radius } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { sendEmailOtp, verifyEmailOtp } from '@/lib/intake';
import { ORG_PRESETS, type OrgType } from '@/lib/features';
import { setLastOrg } from '@/lib/org';

const PINE = '#375946';
const PINE_MID = '#3E6A52';
const CREAM = '#F5EFE3';
const INK = '#22271F';

type Phase = 'email' | 'otp' | 'details' | 'done';

export default function CreateOrgScreen() {
  const router = useRouter();
  const { user, refresh } = useUser();

  // Skip auth phases when already signed in (e.g. came from an expired org).
  const [phase, setPhase] = useState<Phase>(user ? 'details' : 'email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  const [orgName, setOrgName] = useState('');
  const [adminName, setAdminName] = useState('');
  const [orgType, setOrgType] = useState<OrgType>('volunteer');

  const [codes, setCodes] = useState<{ member: string; student: string } | null>(null);

  const preset = ORG_PRESETS[orgType];

  const sendCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email.'); return; }
    setBusy(true); setError('');
    const { error } = await sendEmailOtp(email);
    setBusy(false);
    if (error) { setError(error.message); return; }
    setPhase('otp');
  };

  const verifyCode = async () => {
    if (code.trim().length < 6) { setError('Enter the 6-digit code.'); return; }
    setBusy(true); setError('');
    const { error } = await verifyEmailOtp(email, code);
    setBusy(false);
    if (error) { setError(error.message); return; }
    setPhase('details');
  };

  const createOrg = async () => {
    if (orgName.trim().length < 2) { setError('Give your organization a name.'); return; }
    if (adminName.trim().length < 2) { setError('Enter your name.'); return; }
    setBusy(true); setError('');
    const { data, error } = await supabase.rpc('create_organization', {
      p_name: orgName,
      p_org_type: orgType,
      p_member_noun: preset.memberNoun,
      p_member_noun_plural: preset.memberNounPlural,
      p_student_noun: preset.studentNoun,
      p_student_noun_plural: preset.studentNounPlural,
      p_features: preset.features,
      p_admin_name: adminName,
    });
    setBusy(false);
    if (error) { setError(error.message); return; }
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.member_code) { setError('Something went wrong — try again.'); return; }
    setCodes({ member: row.member_code, student: row.student_code });
    await setLastOrg({
      orgId: row.org_id, code: row.member_code, orgName: orgName.trim(), role: 'member',
      memberNoun: preset.memberNoun, memberNounPlural: preset.memberNounPlural,
    });
    await refresh(); // pull the new profile (admin) + org into context
    setPhase('done');
  };

  const shareCodes = () => {
    Share.share({
      message:
        `Join ${orgName.trim()} on Alloy!\n\n` +
        `${preset.memberNounPlural}: download Alloy Mentors and enter code ${codes?.member}\n` +
        `${preset.studentNounPlural}: use code ${codes?.student}`,
    }).catch(() => {});
  };

  return (
    <View style={styles.screen}>
      <AuroraBackground />
      {phase !== 'done' && (
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={INK} />
        </TouchableOpacity>
      )}

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <BrandMark size={52} style={{ marginBottom: 16 }} />

          {phase === 'email' && (
            <>
              <Text style={styles.title}>Start your{'\n'}organization</Text>
              <Text style={styles.subtitle}>
                Create the workspace your program runs on — members and students join with a code you share.
              </Text>
              <View style={{ gap: 16, marginTop: 28 }}>
                <GlassInput label="Your email" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <GlassButton title={busy ? 'Sending…' : 'Send verification code'} onPress={sendCode} disabled={busy} />
              </View>
            </>
          )}

          {phase === 'otp' && (
            <>
              <Text style={styles.title}>Check your{'\n'}email</Text>
              <Text style={styles.subtitle}>We sent a 6-digit code to {email.trim()}.</Text>
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

          {phase === 'details' && (
            <>
              <Text style={styles.title}>About your{'\n'}program</Text>
              <Text style={styles.subtitle}>
                Pick the closest starting point — it sets your vocabulary and features. You can change everything later in Organization Settings.
              </Text>

              <View style={{ gap: 10, marginTop: 24 }}>
                {(Object.keys(ORG_PRESETS) as OrgType[]).map((t) => {
                  const p = ORG_PRESETS[t];
                  const on = orgType === t;
                  return (
                    <TouchableOpacity key={t} onPress={() => setOrgType(t)} activeOpacity={0.85}
                      style={[styles.presetCard, on && styles.presetCardOn]}>
                      <View style={[styles.presetIcon, on && { backgroundColor: 'rgba(245,239,227,0.16)', borderColor: 'rgba(245,239,227,0.3)' }]}>
                        <Ionicons name={p.icon as any} size={19} color={on ? CREAM : PINE_MID} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[styles.presetLabel, on && { color: CREAM }]}>{p.label}</Text>
                        <Text style={[styles.presetBlurb, on && { color: 'rgba(245,239,227,0.75)' }]}>{p.blurb}</Text>
                        <Text style={[styles.presetNouns, on && { color: 'rgba(245,239,227,0.6)' }]}>
                          {p.memberNounPlural} · {p.studentNounPlural}
                        </Text>
                      </View>
                      {on && <Ionicons name="checkmark-circle" size={20} color={CREAM} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ gap: 16, marginTop: 20 }}>
                <GlassInput label="Organization name" placeholder="e.g. Apple Tutoring" value={orgName} onChangeText={setOrgName} maxLength={60} />
                <GlassInput label="Your name" placeholder="So your team knows who's running this" value={adminName} onChangeText={setAdminName} maxLength={60} />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <GlassButton title={busy ? 'Creating…' : 'Create organization'} onPress={createOrg} disabled={busy} />
              </View>
            </>
          )}

          {phase === 'done' && codes && (
            <>
              <View style={styles.doneBadge}>
                <Ionicons name="checkmark" size={26} color={CREAM} />
              </View>
              <Text style={styles.title}>{orgName.trim()}{'\n'}is live.</Text>
              <Text style={styles.subtitle}>
                You're the admin. Share these codes — they're also in Organization Settings whenever you need them.
              </Text>

              <View style={styles.codeCard}>
                <Text style={styles.codeLabel}>{preset.memberNounPlural.toUpperCase()} JOIN WITH</Text>
                <Text style={styles.codeValue}>{codes.member}</Text>
              </View>
              <View style={styles.codeCard}>
                <Text style={styles.codeLabel}>{preset.studentNounPlural.toUpperCase()} JOIN WITH</Text>
                <Text style={styles.codeValue}>{codes.student}</Text>
              </View>

              <View style={{ gap: 12, marginTop: 20 }}>
                <GlassButton title="Share the codes" onPress={shareCodes} />
                <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={{ alignItems: 'center', paddingVertical: 10 }}>
                  <Text style={styles.linkTxt}>Go to my dashboard →</Text>
                </TouchableOpacity>
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
  linkTxt: { fontFamily: font.semibold, fontSize: 14, color: PINE_MID },

  presetCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(43,70,56,0.16)', borderRadius: 18, padding: 14 },
  presetCardOn: { backgroundColor: PINE, borderColor: PINE },
  presetIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(62,106,82,0.10)', borderWidth: 1, borderColor: 'rgba(62,106,82,0.25)', alignItems: 'center', justifyContent: 'center' },
  presetLabel: { fontFamily: font.semibold, fontSize: 15, color: INK },
  presetBlurb: { fontFamily: font.regular, fontSize: 12.5, color: 'rgba(34,39,31,0.55)', marginTop: 2, lineHeight: 17 },
  presetNouns: { fontFamily: font.medium, fontSize: 11.5, color: 'rgba(34,39,31,0.4)', marginTop: 4 },

  doneBadge: { width: 56, height: 56, borderRadius: 28, backgroundColor: PINE_MID, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  codeCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(43,70,56,0.16)', borderRadius: 18, padding: 18, marginTop: 12, alignItems: 'center' },
  codeLabel: { fontFamily: font.bold, fontSize: 10.5, color: PINE_MID, letterSpacing: 2 },
  codeValue: { fontFamily: font.black, fontSize: 30, color: INK, letterSpacing: 3, marginTop: 6 },
});
