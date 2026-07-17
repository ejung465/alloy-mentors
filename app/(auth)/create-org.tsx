import React, { useRef, useState } from 'react';
import {
  Alert, Image, KeyboardAvoidingView, Platform, ScrollView, Share, StyleSheet,
  Switch, Text, TouchableOpacity, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { BrandMark } from '@/components/ui/Brand';
import { OtpInput } from '@/components/ui/OtpInput';
import { colors, font, radius } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { sendEmailOtp, verifyEmailOtp } from '@/lib/intake';
import { ORG_PRESETS, FEATURES, FEATURE_KEYS, type OrgType, type FeatureKey } from '@/lib/features';
import { setLastOrg } from '@/lib/org';
import {
  signInWithApple, signInWithGoogle, signInWithLinkedIn,
  appleAuthAvailable, googleAuthConfigured,
} from '@/lib/socialAuth';

const PINE = '#165B74';
const PINE_MID = '#2C7C96';
const CREAM = '#F4F6F6';
const INK = '#22271F';

type Phase = 'email' | 'otp' | 'details' | 'other-features' | 'done';

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
  const [otherFeatures, setOtherFeatures] = useState<Record<FeatureKey, boolean> | null>(null);

  const [codes, setCodes] = useState<{ member: string; student: string } | null>(null);
  const [copied, setCopied] = useState<'member' | 'student' | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shareRef = useRef<View>(null);

  const [socialBusy, setSocialBusy] = useState<'apple' | 'google' | 'linkedin' | null>(null);

  const preset = ORG_PRESETS[orgType];
  // "Other" starts from that preset but the user can customize every module —
  // whatever they land on is what actually gets created.
  const activeFeatures = orgType === 'other' && otherFeatures ? otherFeatures : preset.features;

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

  // Signed in via a social button (new person, no profile row yet since this
  // is the create-org flow) — go straight to the org-details step.
  const runSocial = async (kind: 'apple' | 'google' | 'linkedin', fn: () => Promise<{ error: string | null }>) => {
    setSocialBusy(kind); setError('');
    const { error: authError } = await fn();
    setSocialBusy(null);
    if (authError) { setError(authError); return; }
    setPhase('details');
  };

  const selectOrgType = (t: OrgType) => {
    setOrgType(t);
    if (t === 'other') {
      setOtherFeatures({ ...ORG_PRESETS.other.features });
      setPhase('other-features');
    }
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
      p_features: activeFeatures,
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

  const copyCode = async (key: 'member' | 'student', value: string | undefined) => {
    if (!value) return;
    await Clipboard.setStringAsync(value);
    setCopied(key);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1500);
  };

  const shareCodes = async () => {
    try {
      const uri = await captureRef(shareRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: `Join ${orgName.trim()}` });
        return;
      }
      await Share.share({ url: uri });
    } catch {
      // Fall back to a plain-text share if image capture fails for any reason.
      Share.share({
        message:
          `Join ${orgName.trim()} on Alloy!\n\n` +
          `${preset.memberNounPlural}: download Alloy Mentors and enter code ${codes?.member}\n` +
          `${preset.studentNounPlural}: use code ${codes?.student}`,
      }).catch(() => {});
    }
  };

  return (
    <View style={styles.screen}>
      <AuroraBackground />
      {phase !== 'done' && (
        <TouchableOpacity
          onPress={() => (phase === 'other-features' ? setPhase('details') : router.back())}
          style={styles.backBtn}
          activeOpacity={0.8}
        >
          <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFillObject} />
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
              <View style={[styles.socialCol, { marginTop: 28 }]}>
                {appleAuthAvailable && (
                  <TouchableOpacity
                    style={styles.socialRow}
                    activeOpacity={0.85}
                    disabled={!!socialBusy}
                    onPress={() => runSocial('apple', signInWithApple)}
                  >
                    <Ionicons name="logo-apple" size={19} color={INK} />
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
                    <Ionicons name="logo-google" size={18} color={INK} />
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

              <View style={styles.dividerRow}>
                <View style={styles.line} />
                <Text style={styles.orText}>or continue with email</Text>
                <View style={styles.line} />
              </View>

              <View style={{ gap: 16 }}>
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
              <View style={{ gap: 16, marginTop: 28, alignItems: 'center' }}>
                <OtpInput value={code} onChange={setCode} autoFocus />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <GlassButton title={busy ? 'Verifying…' : 'Verify'} onPress={verifyCode} disabled={busy} style={{ width: '100%' }} />
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
                    <TouchableOpacity key={t} onPress={() => selectOrgType(t)} activeOpacity={0.85}
                      style={[styles.presetCard, on && styles.presetCardOn]}>
                      <View style={[styles.presetIcon, on && { backgroundColor: 'rgba(244,246,246,0.16)', borderColor: 'rgba(244,246,246,0.3)' }]}>
                        <Ionicons name={p.icon as any} size={19} color={on ? CREAM : PINE_MID} />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={[styles.presetLabel, on && { color: CREAM }]}>{p.label}</Text>
                        <Text style={[styles.presetBlurb, on && { color: 'rgba(244,246,246,0.75)' }]}>{p.blurb}</Text>
                        <Text style={[styles.presetNouns, on && { color: 'rgba(244,246,246,0.6)' }]}>
                          {p.memberNounPlural} · {p.studentNounPlural}
                        </Text>
                      </View>
                      {on && <Ionicons name="checkmark-circle" size={20} color={CREAM} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {orgType === 'other' && otherFeatures && (
                <TouchableOpacity onPress={() => setPhase('other-features')} style={{ alignSelf: 'flex-start', marginTop: 10 }}>
                  <Text style={styles.linkTxt}>Edit which features are on →</Text>
                </TouchableOpacity>
              )}

              <View style={{ gap: 16, marginTop: 20 }}>
                <GlassInput label="Organization name" placeholder="e.g. Apple Tutoring" value={orgName} onChangeText={setOrgName} maxLength={60} />
                <GlassInput label="Your name" placeholder="So your team knows who's running this" value={adminName} onChangeText={setAdminName} maxLength={60} />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <GlassButton title={busy ? 'Creating…' : 'Create organization'} onPress={createOrg} disabled={busy} />
              </View>
            </>
          )}

          {phase === 'other-features' && otherFeatures && (
            <>
              <Text style={styles.title}>Pick your{'\n'}features</Text>
              <Text style={styles.subtitle}>
                Turn on whatever your program actually uses — you can flip these again anytime in Organization Settings.
              </Text>

              <View style={styles.card}>
                {FEATURE_KEYS.map((k, i) => (
                  <View key={k} style={[styles.featureRow, i < FEATURE_KEYS.length - 1 && styles.featureRowBorder]}>
                    <View style={[styles.featureIcon, { opacity: otherFeatures[k] ? 1 : 0.45 }]}>
                      <Ionicons name={FEATURES[k].icon as any} size={18} color={PINE_MID} />
                    </View>
                    <View style={{ flex: 1, marginRight: 10 }}>
                      <Text style={[styles.featureLabel, !otherFeatures[k] && { color: 'rgba(34,39,31,0.45)' }]}>{FEATURES[k].label}</Text>
                      <Text style={styles.featureDesc}>{FEATURES[k].description}</Text>
                    </View>
                    <Switch
                      value={otherFeatures[k]}
                      onValueChange={() => setOtherFeatures((prev) => prev && { ...prev, [k]: !prev[k] })}
                      trackColor={{ false: 'rgba(196,196,196,0.15)', true: PINE_MID }}
                      thumbColor="#FFFFFF"
                    />
                  </View>
                ))}
              </View>

              <View style={{ marginTop: 20 }}>
                <GlassButton title="Continue" onPress={() => setPhase('details')} />
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
                You're the admin. Share these codes — they're also in Organization Settings whenever you need them. Tap a code to copy it.
              </Text>

              <TouchableOpacity style={styles.codeCard} activeOpacity={0.8} onPress={() => copyCode('member', codes.member)}>
                <Text style={styles.codeLabel}>{preset.memberNounPlural.toUpperCase()} JOIN WITH</Text>
                <Text style={styles.codeValue}>{codes.member}</Text>
                <Text style={[styles.copiedTxt, { opacity: copied === 'member' ? 1 : 0 }]}>Copied!</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.codeCard} activeOpacity={0.8} onPress={() => copyCode('student', codes.student)}>
                <Text style={styles.codeLabel}>{preset.studentNounPlural.toUpperCase()} JOIN WITH</Text>
                <Text style={styles.codeValue}>{codes.student}</Text>
                <Text style={[styles.copiedTxt, { opacity: copied === 'student' ? 1 : 0 }]}>Copied!</Text>
              </TouchableOpacity>

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

      {/* Offscreen capture target for the "share as image" card — never visible,
          rendered purely so react-native-view-shot has something to snapshot. */}
      {codes && (
        <View style={styles.captureWrap} pointerEvents="none">
          <View ref={shareRef} collapsable={false} style={styles.captureCard}>
            <Image source={require('@/assets/images/splash-icon.png')} style={styles.captureLogo} />
            <Text style={styles.captureOrg}>{orgName.trim()}</Text>
            <Text style={styles.captureLine}>Tutor Code: {codes.member}</Text>
            <Text style={styles.captureLine}>Student Code: {codes.student}</Text>
            <Text style={styles.captureBrand}>Alloy Mentors</Text>
            <Text style={styles.captureFooter}>JPX Software Development co.</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  backBtn: { position: 'absolute', top: 56, left: 20, zIndex: 20, width: 40, height: 40, borderRadius: 20, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.45)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.65)', alignItems: 'center', justifyContent: 'center' },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 116, paddingBottom: 60 },
  title: { fontFamily: font.black, fontSize: 38, color: colors.text, letterSpacing: -1.4, lineHeight: 42, marginBottom: 12 },
  subtitle: { fontFamily: font.regular, fontSize: 15, color: colors.textDim, lineHeight: 22 },
  error: { fontFamily: font.medium, fontSize: 13, color: '#B15A4E' },
  linkTxt: { fontFamily: font.semibold, fontSize: 14, color: PINE_MID },

  presetCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', borderRadius: 18, padding: 14 },
  presetCardOn: { backgroundColor: PINE, borderColor: PINE },
  presetIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: 'rgba(44,124,150,0.10)', borderWidth: 1, borderColor: 'rgba(44,124,150,0.25)', alignItems: 'center', justifyContent: 'center' },
  presetLabel: { fontFamily: font.semibold, fontSize: 15, color: INK },
  presetBlurb: { fontFamily: font.regular, fontSize: 12.5, color: 'rgba(34,39,31,0.55)', marginTop: 2, lineHeight: 17 },
  presetNouns: { fontFamily: font.medium, fontSize: 11.5, color: 'rgba(34,39,31,0.4)', marginTop: 4 },

  doneBadge: { width: 56, height: 56, borderRadius: 28, backgroundColor: PINE_MID, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  codeCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', borderRadius: 18, padding: 18, marginTop: 12, alignItems: 'center' },
  codeLabel: { fontFamily: font.bold, fontSize: 10.5, color: PINE_MID, letterSpacing: 2 },
  codeValue: { fontFamily: font.black, fontSize: 30, color: INK, letterSpacing: 3, marginTop: 6 },
  copiedTxt: { fontFamily: font.semibold, fontSize: 11.5, color: PINE_MID, marginTop: 8 },

  socialCol: { gap: 10 },
  socialRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, borderRadius: 14, paddingVertical: 14 },
  socialTxt: { fontFamily: font.medium, fontSize: 15, color: INK },
  dividerRow: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  line: { flex: 1, height: 1, backgroundColor: colors.hairline },
  orText: { fontFamily: font.medium, fontSize: 13, color: colors.textGhost, marginHorizontal: 16, textTransform: 'lowercase' },

  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 20, paddingHorizontal: 14, marginTop: 24 },
  featureRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  featureRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(196,196,196,0.08)' },
  featureIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(44,124,150,0.10)', borderWidth: 1, borderColor: 'rgba(44,124,150,0.22)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  featureLabel: { fontFamily: font.semibold, fontSize: 14.5, color: INK },
  featureDesc: { fontFamily: font.regular, fontSize: 12, color: 'rgba(34,39,31,0.5)', lineHeight: 17, marginTop: 2 },

  captureWrap: { position: 'absolute', top: -10000, left: 0 },
  captureCard: { width: 340, backgroundColor: '#FFFFFF', paddingVertical: 40, paddingHorizontal: 28, alignItems: 'center' },
  captureLogo: { width: 64, height: 64, borderRadius: 16, marginBottom: 16 },
  captureOrg: { fontFamily: font.black, fontSize: 22, color: INK, textAlign: 'center', marginBottom: 18 },
  captureLine: { fontFamily: font.bold, fontSize: 16, color: PINE, marginTop: 6 },
  captureBrand: { fontFamily: font.semibold, fontSize: 13, color: PINE_MID, marginTop: 22 },
  captureFooter: { fontFamily: font.regular, fontSize: 11, color: 'rgba(34,39,31,0.4)', marginTop: 4 },
});
