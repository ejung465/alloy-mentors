import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Image, ScrollView, StyleSheet, Switch,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { canManageOrg } from '@/lib/roles';
import { FEATURES, FEATURE_KEYS, featureEnabled, type FeatureKey } from '@/lib/features';
import { suggestHarmonies, checkAccessibility, normalizeHex, type HarmonySuggestion } from '@/lib/colorHarmony';

const PINE = '#165B74';
const PINE_MID = '#2C7C96';
const CREAM = '#F4F6F6';
const INK = '#22271F';
const GOLD = '#B08A3E';
const DEFAULT_PRIMARY = '#165B74';
const DEFAULT_SECONDARY = '#C5642D';

export default function OrgSettingsScreen() {
  const router = useRouter();
  const { profile, org, refresh } = useUser();

  const [codes, setCodes] = useState<{ member: string | null; student: string | null }>({ member: null, student: null });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [memberNoun, setMemberNoun] = useState(org?.memberNoun ?? 'Tutor');
  const [memberNounPlural, setMemberNounPlural] = useState(org?.memberNounPlural ?? 'Tutors');
  const [studentNoun, setStudentNoun] = useState(org?.studentNoun ?? 'Student');
  const [studentNounPlural, setStudentNounPlural] = useState(org?.studentNounPlural ?? 'Students');
  const [toggles, setToggles] = useState<Record<FeatureKey, boolean>>(
    Object.fromEntries(FEATURE_KEYS.map((k) => [k, featureEnabled(org, k)])) as Record<FeatureKey, boolean>
  );
  const [atRiskWeeks, setAtRiskWeeks] = useState(0);
  const [signerName, setSignerName] = useState('');
  const [signerRole, setSignerRole] = useState('');
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY);
  const [secondaryColor, setSecondaryColor] = useState(DEFAULT_SECONDARY);
  const [harmonies, setHarmonies] = useState<HarmonySuggestion[]>(() => suggestHarmonies(DEFAULT_PRIMARY));
  const [dirty, setDirty] = useState(false);

  const [copiedKind, setCopiedKind] = useState<'member' | 'student' | null>(null);
  const copyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sharingKind, setSharingKind] = useState<'member' | 'student' | null>(null);
  const shareCardRef = useRef<View>(null);

  useEffect(() => {
    (async () => {
      if (!org?.id) return;
      const { data } = await supabase
        .from('organizations')
        .select('member_code, student_code, at_risk_weeks, hours_signer_name, hours_signer_role, primary_color, secondary_color')
        .eq('id', org.id)
        .maybeSingle();
      setCodes({ member: data?.member_code ?? null, student: data?.student_code ?? null });
      setAtRiskWeeks(data?.at_risk_weeks ?? 0);
      setSignerName(data?.hours_signer_name ?? '');
      setSignerRole(data?.hours_signer_role ?? '');
      const loadedPrimary = data?.primary_color ?? DEFAULT_PRIMARY;
      const loadedSecondary = data?.secondary_color ?? DEFAULT_SECONDARY;
      setPrimaryColor(loadedPrimary);
      setSecondaryColor(loadedSecondary);
      setHarmonies(suggestHarmonies(loadedPrimary));
      setLoading(false);
    })();
  }, [org?.id]);

  useEffect(() => () => { if (copyTimeout.current) clearTimeout(copyTimeout.current); }, []);

  if (!canManageOrg(profile?.role)) {
    return (
      <SafeAreaView style={styles.screen}>
        <AuroraBackground />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.textFaint} />
          <Text style={styles.lockedTxt}>Organization Settings are for admins and leadership.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.lockedBack}>
            <Text style={styles.lockedBackTxt}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const copyCode = async (kind: 'member' | 'student') => {
    const code = kind === 'member' ? codes.member : codes.student;
    if (!code) return;
    await Clipboard.setStringAsync(code).catch(() => {});
    if (copyTimeout.current) clearTimeout(copyTimeout.current);
    setCopiedKind(kind);
    copyTimeout.current = setTimeout(() => setCopiedKind(null), 1500);
  };

  const shareCode = async (kind: 'member' | 'student') => {
    const code = kind === 'member' ? codes.member : codes.student;
    if (!code) return;
    setSharingKind(kind);
    // Wait a tick so the offscreen share card renders with the right kind before capture.
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      const uri = await captureRef(shareCardRef, { format: 'png', quality: 1 });
      const available = await Sharing.isAvailableAsync();
      if (available) {
        await Sharing.shareAsync(uri);
      }
    } catch {
      // ignore capture/share failures
    } finally {
      setSharingKind(null);
    }
  };

  const save = async () => {
    if (!org?.id) return;
    for (const [label, v] of [['member', memberNoun], ['members', memberNounPlural], ['student', studentNoun], ['students', studentNounPlural]] as const) {
      if (!v.trim() || v.trim().length > 24) { Alert.alert('Check your vocabulary', `The word for ${label} must be 1–24 characters.`); return; }
    }
    setSaving(true);
    const { error } = await supabase
      .from('organizations')
      .update({
        member_noun: memberNoun.trim(),
        member_noun_plural: memberNounPlural.trim(),
        student_noun: studentNoun.trim(),
        student_noun_plural: studentNounPlural.trim(),
        features: toggles,
        at_risk_weeks: atRiskWeeks,
        hours_signer_name: signerName.trim() || null,
        hours_signer_role: signerRole.trim() || null,
        primary_color: primaryColor,
        secondary_color: secondaryColor,
      })
      .eq('id', org.id);
    setSaving(false);
    if (error) { Alert.alert("Couldn't save", error.message); return; }
    await refresh();
    setDirty(false);
    Alert.alert('Saved', 'Your organization settings are live for everyone.');
  };

  const flip = (k: FeatureKey) => { setDirty(true); setToggles((t) => ({ ...t, [k]: !t[k] })); };

  const onPrimaryChange = (text: string) => {
    setDirty(true);
    setPrimaryColor(text);
    const norm = normalizeHex(text);
    if (norm) setHarmonies(suggestHarmonies(norm));
  };

  const applyHarmony = (h: HarmonySuggestion) => {
    setDirty(true);
    setPrimaryColor(h.primary);
    setSecondaryColor(h.secondary);
  };

  const primaryValid = normalizeHex(primaryColor);
  const secondaryValid = normalizeHex(secondaryColor);
  const a11y = checkAccessibility(primaryColor, secondaryColor);

  return (
    <SafeAreaView style={styles.screen}>
      <AuroraBackground />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.eyebrow}>ORGANIZATION SETTINGS</Text>
          <Text style={styles.title}>{org?.name ?? 'Your org'}</Text>
        </View>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color={INK} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Join codes ── */}
        <Text style={styles.section}>JOIN CODES</Text>
        <Text style={styles.sectionHelp}>Anyone with a code can join in that role. Share them wherever your people are.</Text>
        {loading ? (
          <ActivityIndicator color={PINE} style={{ marginVertical: 20 }} />
        ) : (
          <>
            {([['member', org?.memberNounPlural ?? 'Members', codes.member], ['student', org?.studentNounPlural ?? 'Students', codes.student]] as const).map(([kind, who, code]) => (
              <View key={kind} style={styles.codeRow}>
                <TouchableOpacity
                  style={{ flex: 1 }}
                  onPress={() => copyCode(kind)}
                  activeOpacity={0.7}
                  disabled={!code}
                >
                  <Text style={styles.codeWho}>{who.toUpperCase()}</Text>
                  <Text style={styles.codeVal}>{code ?? '—'}</Text>
                  {copiedKind === kind && <Text style={styles.copiedTxt}>Copied!</Text>}
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => shareCode(kind)}
                  style={styles.shareBtn}
                  activeOpacity={0.85}
                  disabled={sharingKind === kind}
                >
                  {sharingKind === kind ? (
                    <ActivityIndicator color={CREAM} size="small" />
                  ) : (
                    <>
                      <Ionicons name="share-outline" size={16} color={CREAM} />
                      <Text style={styles.shareTxt}>Share</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {/* ── Admin tools ── */}
        <Text style={[styles.section, { marginTop: 26 }]}>ADMIN TOOLS</Text>
        <Text style={styles.sectionHelp}>Oversight, imports, and reporting for leadership.</Text>
        <View style={styles.toolGrid}>
          {([
            ['shield-checkmark-outline', 'Chat oversight', 'Review reports & DMs', '/admin-chat-viewer'],
            ['bar-chart-outline', 'Analytics', 'Hours, retention & trends', '/admin-analytics'],
            ['cloud-upload-outline', 'Import roster', 'Bulk-add students via CSV', '/import-students'],
            ['list-outline', 'Audit log', 'Who changed what, when', '/audit-log'],
            ['star-outline', 'Upgrade to Pro', 'Manage your subscription', '/upgrade'],
          ] as const).map(([icon, label, sub, href]) => (
            <TouchableOpacity key={href} style={styles.toolCell} activeOpacity={0.85} onPress={() => router.push(href as any)}>
              <View style={styles.toolIcon}>
                <Ionicons name={icon as any} size={17} color={PINE_MID} />
              </View>
              <Text style={styles.toolLabel}>{label}</Text>
              <Text style={styles.toolSub}>{sub}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Features ── */}
        <Text style={[styles.section, { marginTop: 26 }]}>FEATURES</Text>
        <Text style={styles.sectionHelp}>Switch on what your program uses. Everything else stays out of everyone's way.</Text>
        <View style={styles.card}>
          {FEATURE_KEYS.map((k, i) => (
            <View key={k} style={[styles.featureRow, i < FEATURE_KEYS.length - 1 && styles.featureRowBorder]}>
              <View style={[styles.featureIcon, { opacity: toggles[k] ? 1 : 0.45 }]}>
                <Ionicons name={FEATURES[k].icon as any} size={18} color={PINE_MID} />
              </View>
              <View style={{ flex: 1, marginRight: 10 }}>
                <Text style={[styles.featureLabel, !toggles[k] && { color: 'rgba(34,39,31,0.45)' }]}>{FEATURES[k].label}</Text>
                <Text style={styles.featureDesc}>{FEATURES[k].description}</Text>
              </View>
              <Switch
                value={toggles[k]}
                onValueChange={() => flip(k)}
                trackColor={{ false: 'rgba(196,196,196,0.15)', true: PINE_MID }}
                thumbColor="#FFFFFF"
              />
            </View>
          ))}
        </View>

        {/* ── Vocabulary ── */}
        <Text style={[styles.section, { marginTop: 26 }]}>VOCABULARY</Text>
        <Text style={styles.sectionHelp}>What does your organization call its people? The whole app uses your words.</Text>
        <View style={styles.nounGrid}>
          {([
            ['One member is a…', memberNoun, setMemberNoun],
            ['Many are…', memberNounPlural, setMemberNounPlural],
            ['One student is a…', studentNoun, setStudentNoun],
            ['Many are…', studentNounPlural, setStudentNounPlural],
          ] as const).map(([label, value, setter], i) => (
            <View key={i} style={styles.nounCell}>
              <Text style={styles.nounLabel}>{label.toUpperCase()}</Text>
              <TextInput
                style={styles.nounInput}
                value={value}
                onChangeText={(t) => { setDirty(true); setter(t); }}
                maxLength={24}
              />
            </View>
          ))}
        </View>

        {/* ── At-risk alerts ── */}
        <Text style={[styles.section, { marginTop: 26 }]}>AT-RISK ALERTS</Text>
        <Text style={styles.sectionHelp}>
          Notify a student and leadership when they haven't attended in a while. 0 turns this off.
        </Text>
        <View style={styles.stepperRow}>
          <TouchableOpacity
            style={styles.stepperBtn}
            onPress={() => { setDirty(true); setAtRiskWeeks((w) => Math.max(0, w - 1)); }}
          >
            <Ionicons name="remove" size={18} color={PINE} />
          </TouchableOpacity>
          <Text style={styles.stepperVal}>
            {atRiskWeeks === 0 ? 'Off' : `${atRiskWeeks} week${atRiskWeeks === 1 ? '' : 's'}`}
          </Text>
          <TouchableOpacity
            style={styles.stepperBtn}
            onPress={() => { setDirty(true); setAtRiskWeeks((w) => Math.min(12, w + 1)); }}
          >
            <Ionicons name="add" size={18} color={PINE} />
          </TouchableOpacity>
        </View>

        {/* ── Hour verification signer ── */}
        <Text style={[styles.section, { marginTop: 26 }]}>HOUR VERIFICATION</Text>
        <Text style={styles.sectionHelp}>
          Whoever's named here signs off on every auto-generated volunteer hour certificate.
        </Text>
        <View style={styles.nounGrid}>
          <View style={styles.nounCell}>
            <Text style={styles.nounLabel}>SIGNER NAME</Text>
            <TextInput
              style={styles.nounInput}
              value={signerName}
              onChangeText={(t) => { setDirty(true); setSignerName(t); }}
              placeholder="Your name"
              maxLength={60}
            />
          </View>
          <View style={styles.nounCell}>
            <Text style={styles.nounLabel}>SIGNER ROLE</Text>
            <TextInput
              style={styles.nounInput}
              value={signerRole}
              onChangeText={(t) => { setDirty(true); setSignerRole(t); }}
              placeholder="e.g. President"
              maxLength={40}
            />
          </View>
        </View>

        {/* ── Branding ── */}
        <Text style={[styles.section, { marginTop: 26 }]}>BRANDING</Text>
        <Text style={styles.sectionHelp}>
          Your organization's colors. Type a hex value, or tap a suggested pairing to fill both at once.
        </Text>
        <View style={styles.nounGrid}>
          {([
            ['PRIMARY', primaryColor, onPrimaryChange, primaryValid],
            ['SECONDARY', secondaryColor, (t: string) => { setDirty(true); setSecondaryColor(t); }, secondaryValid],
          ] as const).map(([label, value, setter, valid], i) => (
            <View key={i} style={styles.nounCell}>
              <Text style={styles.nounLabel}>{label}</Text>
              <View style={styles.colorRow}>
                <View style={[styles.swatch, { backgroundColor: valid ?? 'transparent', borderColor: valid ? 'rgba(34,39,31,0.12)' : GOLD }]} />
                <TextInput
                  style={styles.colorInput}
                  value={value}
                  onChangeText={setter}
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="#000000"
                  maxLength={7}
                />
              </View>
            </View>
          ))}
        </View>

        <View style={styles.chipRow}>
          {harmonies.map((h) => (
            <TouchableOpacity key={h.label} style={styles.chip} onPress={() => applyHarmony(h)} activeOpacity={0.85}>
              <View style={styles.chipSwatches}>
                <View style={[styles.chipSwatch, { backgroundColor: h.primary }]} />
                <View style={[styles.chipSwatch, { backgroundColor: h.secondary, marginLeft: -6 }]} />
              </View>
              <Text style={styles.chipTxt}>{h.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {!a11y.ok && (
          <View style={styles.warnBanner}>
            <Ionicons name="alert-circle-outline" size={18} color={GOLD} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              {a11y.warnings.map((w, i) => (
                <Text key={i} style={styles.warnTxt}>{w}</Text>
              ))}
            </View>
          </View>
        )}

        {/* Contained preview — does not re-theme the rest of the app. */}
        <View style={[styles.previewCard, { backgroundColor: primaryValid ?? DEFAULT_PRIMARY }]}>
          <Text style={styles.previewEyebrow}>{(org?.name ?? 'Your org').toUpperCase()}</Text>
          <Text style={styles.previewTitle}>Preview</Text>
          <View style={[styles.previewBtn, { backgroundColor: secondaryValid ?? DEFAULT_SECONDARY }]}>
            <Text style={styles.previewBtnTxt}>Primary action</Text>
          </View>
        </View>

        <TouchableOpacity onPress={save} disabled={saving || !dirty} style={[styles.saveBtn, (saving || !dirty) && { opacity: 0.5 }]} activeOpacity={0.9}>
          <Text style={styles.saveTxt}>{saving ? 'Saving…' : 'Save changes'}</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Offscreen share card — rendered (not unmounted) so captureRef can snapshot it. */}
      <View style={styles.shareCardWrap} pointerEvents="none">
        <View ref={shareCardRef} collapsable={false} style={styles.shareCard}>
          <Image
            source={require('@/assets/images/splash-icon.png')}
            style={styles.shareCardLogo}
            resizeMode="contain"
          />
          <Text style={styles.shareCardOrg}>{org?.name ?? 'Your organization'}</Text>
          <Text style={styles.shareCardLine}>
            {(sharingKind === 'student' ? (org?.studentNoun ?? 'Student') : (org?.memberNoun ?? 'Tutor'))} Code:{' '}
            {(sharingKind === 'student' ? codes.student : codes.member) ?? '—'}
          </Text>
          <Text style={styles.shareCardBrand}>Alloy Mentors</Text>
          <Text style={styles.shareCardFooter}>JPX Software Development co.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6 },
  eyebrow: { fontFamily: font.bold, fontSize: 10.5, color: PINE_MID, letterSpacing: 2.5 },
  title: { fontFamily: font.black, fontSize: 28, color: PINE, letterSpacing: -0.9, marginTop: 4 },
  closeBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 60 },

  section: { fontFamily: font.bold, fontSize: 11.5, color: PINE_MID, letterSpacing: 2 },
  sectionHelp: { fontFamily: font.regular, fontSize: 12.5, color: 'rgba(34,39,31,0.5)', lineHeight: 18, marginTop: 6, marginBottom: 12 },

  codeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', borderRadius: 18, padding: 16, marginBottom: 10 },
  codeWho: { fontFamily: font.bold, fontSize: 10.5, color: 'rgba(34,39,31,0.45)', letterSpacing: 1.5 },
  codeVal: { fontFamily: font.black, fontSize: 24, color: INK, letterSpacing: 2, marginTop: 3 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: PINE, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, minWidth: 84, justifyContent: 'center' },
  shareTxt: { fontFamily: font.semibold, fontSize: 13, color: CREAM },
  copiedTxt: { fontFamily: font.semibold, fontSize: 11.5, color: PINE_MID, marginTop: 4 },

  shareCardWrap: { position: 'absolute', top: 0, left: 0, opacity: 0 },
  shareCard: { width: 320, alignItems: 'center', backgroundColor: '#FFFFFF', padding: 28, borderRadius: 20 },
  shareCardLogo: { width: 72, height: 72, marginBottom: 14 },
  shareCardOrg: { fontFamily: font.black, fontSize: 20, color: PINE, textAlign: 'center', marginBottom: 12 },
  shareCardLine: { fontFamily: font.semibold, fontSize: 15, color: INK, marginBottom: 6 },
  shareCardBrand: { fontFamily: font.bold, fontSize: 13, color: PINE, letterSpacing: 1, marginTop: 14 },
  shareCardFooter: { fontFamily: font.regular, fontSize: 10.5, color: 'rgba(34,39,31,0.45)', marginTop: 4 },

  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 20, paddingHorizontal: 14 },
  featureRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  featureRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(196,196,196,0.08)' },
  featureIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(44,124,150,0.10)', borderWidth: 1, borderColor: 'rgba(44,124,150,0.22)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  featureLabel: { fontFamily: font.semibold, fontSize: 14.5, color: INK },
  featureDesc: { fontFamily: font.regular, fontSize: 12, color: 'rgba(34,39,31,0.5)', lineHeight: 17, marginTop: 2 },

  toolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  toolCell: { width: '48%', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 14, padding: 12 },
  toolIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: 'rgba(44,124,150,0.10)', borderWidth: 1, borderColor: 'rgba(44,124,150,0.22)', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  toolLabel: { fontFamily: font.semibold, fontSize: 13.5, color: INK },
  toolSub: { fontFamily: font.regular, fontSize: 11, color: 'rgba(34,39,31,0.45)', marginTop: 2, lineHeight: 15 },

  nounGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  nounCell: { width: '48%', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 14, padding: 12 },
  nounLabel: { fontFamily: font.semibold, fontSize: 9.5, color: 'rgba(34,39,31,0.45)', letterSpacing: 1 },
  nounInput: { fontFamily: font.bold, fontSize: 17, color: INK, marginTop: 4, padding: 0 },

  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 18, paddingVertical: 14 },
  stepperBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(44,124,150,0.10)', borderWidth: 1, borderColor: 'rgba(44,124,150,0.25)', alignItems: 'center', justifyContent: 'center' },
  stepperVal: { fontFamily: font.bold, fontSize: 16, color: INK, minWidth: 80, textAlign: 'center' },

  colorRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 10 },
  swatch: { width: 26, height: 26, borderRadius: 8, borderWidth: 1 },
  colorInput: { flex: 1, fontFamily: font.bold, fontSize: 16, color: INK, padding: 0, letterSpacing: 0.5 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', borderRadius: 999, paddingLeft: 8, paddingRight: 14, paddingVertical: 7 },
  chipSwatches: { flexDirection: 'row', alignItems: 'center' },
  chipSwatch: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#FFFFFF' },
  chipTxt: { fontFamily: font.semibold, fontSize: 12.5, color: INK },

  warnBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, backgroundColor: 'rgba(176,138,62,0.10)', borderWidth: 1, borderColor: 'rgba(176,138,62,0.32)', borderRadius: 14, padding: 14, marginTop: 12 },
  warnTxt: { fontFamily: font.medium, fontSize: 12.5, color: GOLD, lineHeight: 18 },

  previewCard: { borderRadius: 18, padding: 18, marginTop: 14 },
  previewEyebrow: { fontFamily: font.bold, fontSize: 10, color: 'rgba(255,255,255,0.7)', letterSpacing: 2 },
  previewTitle: { fontFamily: font.black, fontSize: 22, color: '#FFFFFF', letterSpacing: -0.6, marginTop: 4 },
  previewBtn: { alignSelf: 'flex-start', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10, marginTop: 14 },
  previewBtnTxt: { fontFamily: font.bold, fontSize: 13.5, color: '#FFFFFF' },

  saveBtn: { backgroundColor: PINE, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 26 },
  saveTxt: { fontFamily: font.bold, fontSize: 15.5, color: CREAM },

  lockedTxt: { fontFamily: font.medium, fontSize: 14.5, color: colors.textDim, textAlign: 'center', marginTop: 14, lineHeight: 21 },
  lockedBack: { marginTop: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.18)', borderRadius: 14, paddingHorizontal: 22, paddingVertical: 12 },
  lockedBackTxt: { fontFamily: font.semibold, fontSize: 14, color: PINE_MID },
});
