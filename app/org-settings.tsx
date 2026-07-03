import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, Share, StyleSheet, Switch,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { canManageOrg } from '@/lib/roles';
import { FEATURES, FEATURE_KEYS, featureEnabled, type FeatureKey } from '@/lib/features';

const PINE = '#375946';
const PINE_MID = '#3E6A52';
const CREAM = '#F5EFE3';
const INK = '#22271F';

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
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    (async () => {
      if (!org?.id) return;
      const { data } = await supabase
        .from('organizations')
        .select('member_code, student_code')
        .eq('id', org.id)
        .maybeSingle();
      setCodes({ member: data?.member_code ?? null, student: data?.student_code ?? null });
      setLoading(false);
    })();
  }, [org?.id]);

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

  const shareCode = (kind: 'member' | 'student') => {
    const code = kind === 'member' ? codes.member : codes.student;
    if (!code) return;
    const who = kind === 'member' ? (org?.memberNounPlural ?? 'Members') : (org?.studentNounPlural ?? 'Students');
    Share.share({
      message: `Join ${org?.name ?? 'our organization'} on Alloy! ${who}: download Alloy Mentors and enter code ${code}`,
    }).catch(() => {});
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
      })
      .eq('id', org.id);
    setSaving(false);
    if (error) { Alert.alert("Couldn't save", error.message); return; }
    await refresh();
    setDirty(false);
    Alert.alert('Saved', 'Your organization settings are live for everyone.');
  };

  const flip = (k: FeatureKey) => { setDirty(true); setToggles((t) => ({ ...t, [k]: !t[k] })); };

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
                <View style={{ flex: 1 }}>
                  <Text style={styles.codeWho}>{who.toUpperCase()}</Text>
                  <Text style={styles.codeVal}>{code ?? '—'}</Text>
                </View>
                <TouchableOpacity onPress={() => shareCode(kind)} style={styles.shareBtn} activeOpacity={0.85}>
                  <Ionicons name="share-outline" size={16} color={CREAM} />
                  <Text style={styles.shareTxt}>Share</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

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
                trackColor={{ false: 'rgba(43,70,56,0.15)', true: PINE_MID }}
                thumbColor="#FFFDF7"
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

        <TouchableOpacity onPress={save} disabled={saving || !dirty} style={[styles.saveBtn, (saving || !dirty) && { opacity: 0.5 }]} activeOpacity={0.9}>
          <Text style={styles.saveTxt}>{saving ? 'Saving…' : 'Save changes'}</Text>
        </TouchableOpacity>
      </ScrollView>
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

  codeRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(43,70,56,0.16)', borderRadius: 18, padding: 16, marginBottom: 10 },
  codeWho: { fontFamily: font.bold, fontSize: 10.5, color: 'rgba(34,39,31,0.45)', letterSpacing: 1.5 },
  codeVal: { fontFamily: font.black, fontSize: 24, color: INK, letterSpacing: 2, marginTop: 3 },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: PINE, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10 },
  shareTxt: { fontFamily: font.semibold, fontSize: 13, color: CREAM },

  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(43,70,56,0.14)', borderRadius: 20, paddingHorizontal: 14 },
  featureRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
  featureRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(43,70,56,0.08)' },
  featureIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: 'rgba(62,106,82,0.10)', borderWidth: 1, borderColor: 'rgba(62,106,82,0.22)', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  featureLabel: { fontFamily: font.semibold, fontSize: 14.5, color: INK },
  featureDesc: { fontFamily: font.regular, fontSize: 12, color: 'rgba(34,39,31,0.5)', lineHeight: 17, marginTop: 2 },

  nounGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  nounCell: { width: '48%', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(43,70,56,0.14)', borderRadius: 14, padding: 12 },
  nounLabel: { fontFamily: font.semibold, fontSize: 9.5, color: 'rgba(34,39,31,0.45)', letterSpacing: 1 },
  nounInput: { fontFamily: font.bold, fontSize: 17, color: INK, marginTop: 4, padding: 0 },

  saveBtn: { backgroundColor: PINE, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 26 },
  saveTxt: { fontFamily: font.bold, fontSize: 15.5, color: CREAM },

  lockedTxt: { fontFamily: font.medium, fontSize: 14.5, color: colors.textDim, textAlign: 'center', marginTop: 14, lineHeight: 21 },
  lockedBack: { marginTop: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(43,70,56,0.18)', borderRadius: 14, paddingHorizontal: 22, paddingVertical: 12 },
  lockedBackTxt: { fontFamily: font.semibold, fontSize: 14, color: PINE_MID },
});
