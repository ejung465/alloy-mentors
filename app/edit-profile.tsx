import React, { useEffect, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { SUBJECTS, DAYS, TIMES, TSHIRTS } from '@/lib/intake';

const PINE = '#375946';
const PINE_MID = '#3E6A52';
const CREAM = '#F5EFE3';
const INK = '#22271F';

function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[styles.chip, on && styles.chipOn]}>
      <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Field({ label, ...props }: any) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.textGhost} {...props} />
    </View>
  );
}

export default function EditProfileScreen() {
  const router = useRouter();
  const { user } = useUser();

  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [phone, setPhone] = useState('');
  const [school, setSchool] = useState('');
  const [location, setLocation] = useState('');
  const [gradeOcc, setGradeOcc] = useState('');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [languages, setLanguages] = useState('');
  const [days, setDays] = useState<string[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [tshirt, setTshirt] = useState<string | null>(null);
  const [emName, setEmName] = useState('');
  const [emPhone, setEmPhone] = useState('');

  useEffect(() => {
    (async () => {
      if (!user?.id) return;
      const { data } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle();
      if (data) {
        setFullName(data.full_name ?? '');
        setPreferredName(data.preferred_name ?? '');
        setPhone(data.phone ?? '');
        setSchool(data.school ?? '');
        setLocation(data.location ?? '');
        setGradeOcc(data.grade_or_occupation ?? '');
        setSubjects(data.subjects ?? []);
        setLanguages((data.languages ?? []).join(', '));
        setDays(data.available_days ?? []);
        setTimes(data.available_times ?? []);
        setTshirt(data.tshirt_size ?? null);
        setEmName(data.emergency_contact_name ?? '');
        setEmPhone(data.emergency_contact_phone ?? '');
      }
      setLoaded(true);
    })();
  }, [user?.id]);

  const mark = <T,>(setter: (v: T) => void) => (v: T) => { setDirty(true); setter(v); };
  const toggle = (list: string[], set: (v: string[]) => void, item: string) => {
    setDirty(true);
    set(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  };

  const close = () => {
    if (!dirty) { router.back(); return; }
    Alert.alert('Discard changes?', 'You have unsaved edits.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => router.back() },
    ]);
  };

  const save = async () => {
    const name = fullName.trim();
    if (name.length < 2 || name.length > 60 || /[<>{}@#$^*_=+~`|\\]/.test(name)) {
      Alert.alert('Invalid name', 'Use 2–60 characters, letters and basic punctuation only.'); return;
    }
    if (school.trim().length > 80 || /[<>{}]/.test(school)) {
      Alert.alert('Invalid institution', "That doesn't look like a valid institution name."); return;
    }
    for (const [label, p] of [['Phone', phone], ['Emergency phone', emPhone]] as const) {
      if (p.trim() && !/^[+()\d\s-]{7,20}$/.test(p.trim())) {
        Alert.alert(`Invalid ${label.toLowerCase()}`, 'Use 7–20 characters: digits, spaces, and + ( ) - only.'); return;
      }
    }
    if (!user?.id) return;
    setSaving(true);
    const { error } = await supabase.from('users').update({
      full_name: name,
      preferred_name: preferredName.trim() || null,
      phone: phone.trim() || null,
      school: school.trim() || null,
      location: location.trim() || null,
      grade_or_occupation: gradeOcc.trim() || null,
      subjects,
      languages: languages.split(',').map((s) => s.trim()).filter(Boolean),
      available_days: days,
      available_times: times,
      tshirt_size: tshirt,
      emergency_contact_name: emName.trim() || null,
      emergency_contact_phone: emPhone.trim() || null,
    }).eq('id', user.id);
    setSaving(false);
    if (error) { Alert.alert("Couldn't save", error.message); return; }
    router.back();
  };

  return (
    <SafeAreaView style={styles.screen}>
      <AuroraBackground />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Edit Profile</Text>
          <Text style={styles.subtitle}>Keep your details current for your coordinators.</Text>
        </View>
        <TouchableOpacity onPress={close} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color={INK} />
        </TouchableOpacity>
      </View>

      {loaded && (
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            <Text style={styles.section}>IDENTITY</Text>
            <Field label="FULL NAME" value={fullName} onChangeText={mark(setFullName)} placeholder="Your name" />
            <Field label="PREFERRED NAME" value={preferredName} onChangeText={mark(setPreferredName)} placeholder="What should we call you?" />

            <Text style={styles.section}>CONTACT</Text>
            <Field label="PHONE" value={phone} onChangeText={mark(setPhone)} placeholder="(555) 123-4567" keyboardType="phone-pad" />
            <Field label="LOCATION" value={location} onChangeText={mark(setLocation)} placeholder="City / neighborhood" />

            <Text style={styles.section}>INSTITUTION</Text>
            <Field label="SCHOOL / INSTITUTION" value={school} onChangeText={mark(setSchool)} placeholder="e.g. Lincoln High School" />
            <Field label="GRADE / OCCUPATION" value={gradeOcc} onChangeText={mark(setGradeOcc)} placeholder="e.g. 11th grade, Engineer" />

            <Text style={styles.section}>TUTORING</Text>
            <Text style={styles.fieldLabel}>SUBJECTS YOU CAN HELP WITH</Text>
            <View style={styles.chipWrap}>
              {SUBJECTS.map((s) => <Chip key={s} label={s} on={subjects.includes(s)} onPress={() => toggle(subjects, setSubjects, s)} />)}
            </View>
            <Field label="LANGUAGES (COMMA-SEPARATED)" value={languages} onChangeText={mark(setLanguages)} placeholder="English, Spanish…" />
            <Text style={styles.fieldLabel}>AVAILABLE DAYS</Text>
            <View style={styles.chipWrap}>
              {DAYS.map((d) => <Chip key={d} label={d} on={days.includes(d)} onPress={() => toggle(days, setDays, d)} />)}
            </View>
            <Text style={styles.fieldLabel}>AVAILABLE TIMES</Text>
            <View style={styles.chipWrap}>
              {TIMES.map((t) => <Chip key={t} label={t} on={times.includes(t)} onPress={() => toggle(times, setTimes, t)} />)}
            </View>
            <Text style={styles.fieldLabel}>T-SHIRT SIZE</Text>
            <View style={styles.chipWrap}>
              {TSHIRTS.map((t) => <Chip key={t} label={t} on={tshirt === t} onPress={() => { setDirty(true); setTshirt(tshirt === t ? null : t); }} />)}
            </View>

            <Text style={styles.section}>EMERGENCY CONTACT</Text>
            <Field label="NAME" value={emName} onChangeText={mark(setEmName)} placeholder="Contact name" />
            <Field label="PHONE" value={emPhone} onChangeText={mark(setEmPhone)} placeholder="(555) 987-6543" keyboardType="phone-pad" />

            <TouchableOpacity onPress={save} disabled={saving} style={[styles.saveBtn, saving && { opacity: 0.6 }]} activeOpacity={0.9}>
              <Text style={styles.saveTxt}>{saving ? 'Saving…' : 'Save changes'}</Text>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  title: { fontFamily: font.black, fontSize: 26, color: INK, letterSpacing: -0.6 },
  subtitle: { fontFamily: font.regular, fontSize: 13, color: 'rgba(34,39,31,0.5)', marginTop: 3, maxWidth: 280 },
  closeBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingBottom: 60 },

  section: { fontFamily: font.bold, fontSize: 11.5, color: PINE_MID, letterSpacing: 2, marginTop: 22, marginBottom: 12 },
  fieldLabel: { fontFamily: font.semibold, fontSize: 11, color: colors.silver, letterSpacing: 1, marginBottom: 8 },
  input: { fontFamily: font.medium, fontSize: 15, color: INK, backgroundColor: colors.surfaceStrong, borderWidth: 1.5, borderColor: 'rgba(43,70,56,0.14)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(43,70,56,0.16)' },
  chipOn: { backgroundColor: PINE, borderColor: PINE },
  chipTxt: { fontFamily: font.medium, fontSize: 13, color: INK },
  chipTxtOn: { color: CREAM },

  saveBtn: { backgroundColor: PINE, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginTop: 26 },
  saveTxt: { fontFamily: font.bold, fontSize: 15.5, color: CREAM },
});
