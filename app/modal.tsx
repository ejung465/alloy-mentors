import React, { useMemo, useState } from 'react';
import {
  View, Text, KeyboardAvoidingView, Platform,
  ScrollView, TouchableOpacity, TextInput, Alert, StyleSheet
} from 'react-native';
import { useRouter } from 'expo-router';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';

const PINE = '#165B74';
const PINE_MID = '#2C7C96';
const CREAM = '#F4F6F6';
const INK = '#22271F';

const QUICK_HOURS = [0.5, 1, 1.5, 2, 2.5, 3];
const ACTIVITIES = [
  { key: 'Tutoring session', icon: 'book-outline' },
  { key: 'Session prep', icon: 'construct-outline' },
  { key: 'Event help', icon: 'balloon-outline' },
  { key: 'Other', icon: 'ellipsis-horizontal-circle-outline' },
] as const;

const toYMD = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function LogHoursModal() {
  const router = useRouter();
  const [hours, setHours] = useState(1);
  const [dateYMD, setDateYMD] = useState(toYMD(new Date()));
  const [activity, setActivity] = useState<string>('Tutoring session');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  // Last 14 days, newest first.
  const days = useMemo(() => {
    const out: { ymd: string; label: string; sub: string }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push({
        ymd: toYMD(d),
        label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'short' }),
        sub: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      });
    }
    return out;
  }, []);

  const bump = (delta: number) =>
    setHours((h) => Math.min(12, Math.max(0.25, Math.round((h + delta) * 4) / 4)));

  const dateLabel = useMemo(() => {
    const found = days.find((d) => d.ymd === dateYMD);
    return found ? (found.label === 'Today' || found.label === 'Yesterday' ? found.label : found.sub) : dateYMD;
  }, [dateYMD, days]);

  const handleSubmit = async () => {
    if (hours <= 0) { Alert.alert('Invalid hours', 'Pick how long you worked.'); return; }
    if (!description.trim()) { Alert.alert('Add a note', 'Briefly describe what you did — the director sees this when approving.'); return; }
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { Alert.alert('Error', 'Please log out and log back in.'); setLoading(false); return; }
      const user = session.user;
      const { data: profile } = await supabase.from('users').select('organization_id').eq('id', user.id).maybeSingle();

      const insertData: any = {
        mentor_id: user.id,
        hours,
        date_worked: dateYMD,
        description: `[${activity}] ${description.trim()}`,
        status: 'pending',
      };
      if (profile?.organization_id) insertData.organization_id = profile.organization_id;

      const { error } = await supabase.from('hours_logs').insert(insertData);
      if (error) { Alert.alert('Error', error.message); setLoading(false); return; }

      setSuccess(true);
      setLoading(false);
      setTimeout(() => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); }, 1400);
    } catch (err: any) {
      Alert.alert('Error', err.message);
      setLoading(false);
    }
  };

  const fmtHours = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(h * 4 % 2 === 0 ? 1 : 2));

  return (
    <View style={styles.screen}>
      <AuroraBackground />
      <View style={styles.header}>
        <View>
          <Text style={styles.pageTitle}>Log Hours</Text>
          <Text style={styles.pageSubtitle}>Every hour counts — literally.</Text>
        </View>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={22} color={INK} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {/* ── How long ── */}
          <Text style={styles.sectionLabel}>HOW LONG?</Text>
          <View style={styles.card}>
            <View style={styles.hoursRow}>
              <TouchableOpacity onPress={() => bump(-0.25)} style={styles.stepBtn} activeOpacity={0.8}>
                <Ionicons name="remove" size={22} color={PINE} />
              </TouchableOpacity>
              <View style={{ alignItems: 'center' }}>
                <Text style={styles.hoursBig}>{fmtHours(hours)}</Text>
                <Text style={styles.hoursUnit}>{hours === 1 ? 'hour' : 'hours'}</Text>
              </View>
              <TouchableOpacity onPress={() => bump(0.25)} style={styles.stepBtn} activeOpacity={0.8}>
                <Ionicons name="add" size={22} color={PINE} />
              </TouchableOpacity>
            </View>
            <View style={styles.chipRow}>
              {QUICK_HOURS.map((h) => (
                <TouchableOpacity key={h} onPress={() => setHours(h)} activeOpacity={0.85}
                  style={[styles.chip, hours === h && styles.chipOn]}>
                  <Text style={[styles.chipTxt, hours === h && styles.chipTxtOn]}>{fmtHours(h)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {/* ── When ── */}
          <Text style={styles.sectionLabel}>WHEN?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 20 }} style={{ marginBottom: 22 }}>
            {days.map((d) => {
              const on = d.ymd === dateYMD;
              return (
                <TouchableOpacity key={d.ymd} onPress={() => setDateYMD(d.ymd)} activeOpacity={0.85}
                  style={[styles.dayChip, on && styles.dayChipOn]}>
                  <Text style={[styles.dayChipLabel, on && { color: 'rgba(244,246,246,0.75)' }]}>{d.label}</Text>
                  <Text style={[styles.dayChipSub, on && { color: CREAM }]}>{d.sub}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* ── What kind ── */}
          <Text style={styles.sectionLabel}>WHAT KIND OF WORK?</Text>
          <View style={[styles.chipRow, { marginBottom: 22 }]}>
            {ACTIVITIES.map((a) => {
              const on = activity === a.key;
              return (
                <TouchableOpacity key={a.key} onPress={() => setActivity(a.key)} activeOpacity={0.85}
                  style={[styles.actChip, on && styles.chipOn]}>
                  <Ionicons name={a.icon as any} size={15} color={on ? CREAM : PINE_MID} />
                  <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{a.key}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* ── Details ── */}
          <Text style={styles.sectionLabel}>WHAT DID YOU DO?</Text>
          <View style={styles.card}>
            <TextInput
              style={styles.descInput}
              placeholder="What did you work on? Who did you help?"
              placeholderTextColor={colors.textGhost}
              value={description}
              onChangeText={(t) => t.length <= 240 && setDescription(t)}
              multiline
            />
            <Text style={styles.counter}>{description.length}/240</Text>
          </View>

          {success ? (
            <View style={styles.successBanner}>
              <View style={styles.successIcon}>
                <Ionicons name="checkmark" size={20} color={CREAM} />
              </View>
              <View style={{ marginLeft: 12, flex: 1 }}>
                <Text style={styles.successTitle}>Submitted!</Text>
                <Text style={styles.successSub}>Awaiting director approval.</Text>
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.summary}>
                {fmtHours(hours)} {hours === 1 ? 'hr' : 'hrs'} · {activity} · {dateLabel}
              </Text>
              <TouchableOpacity onPress={handleSubmit} disabled={loading} style={[styles.submitBtn, loading && { opacity: 0.6 }]} activeOpacity={0.9}>
                <Text style={styles.submitBtnText}>{loading ? 'Saving…' : 'Submit for approval'}</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 56, paddingBottom: 18 },
  pageTitle: { fontFamily: 'Inter-Black', fontSize: 30, color: INK, letterSpacing: -0.8 },
  pageSubtitle: { fontFamily: 'Inter-Regular', fontSize: 14, color: 'rgba(34,39,31,0.5)', marginTop: 3 },
  closeBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(196,196,196,0.10)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.2)', alignItems: 'center', justifyContent: 'center' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 80 },

  sectionLabel: { fontFamily: 'Inter-SemiBold', fontSize: 11.5, color: 'rgba(34,39,31,0.5)', letterSpacing: 1.2, marginBottom: 10 },
  card: { backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 20, padding: 18, marginBottom: 22 },

  hoursRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, marginBottom: 16 },
  stepBtn: { width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(196,196,196,0.08)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.2)', alignItems: 'center', justifyContent: 'center' },
  hoursBig: { fontFamily: 'Inter-Black', fontSize: 44, color: PINE, letterSpacing: -1.5, lineHeight: 48 },
  hoursUnit: { fontFamily: 'Inter-Medium', fontSize: 13, color: 'rgba(34,39,31,0.5)', marginTop: -2 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20, backgroundColor: 'rgba(196,196,196,0.06)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)' },
  actChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)' },
  chipOn: { backgroundColor: PINE, borderColor: PINE },
  chipTxt: { fontFamily: 'Inter-SemiBold', fontSize: 13.5, color: INK },
  chipTxtOn: { color: CREAM },

  dayChip: { alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', minWidth: 74 },
  dayChipOn: { backgroundColor: PINE, borderColor: PINE },
  dayChipLabel: { fontFamily: 'Inter-Medium', fontSize: 11.5, color: 'rgba(34,39,31,0.5)' },
  dayChipSub: { fontFamily: 'Inter-Bold', fontSize: 14, color: INK, marginTop: 2 },

  descInput: { fontFamily: 'Inter-Regular', fontSize: 15, color: INK, minHeight: 84, textAlignVertical: 'top' },
  counter: { fontFamily: 'Inter-Regular', fontSize: 11.5, color: 'rgba(34,39,31,0.35)', textAlign: 'right', marginTop: 6 },

  summary: { fontFamily: 'Inter-SemiBold', fontSize: 13.5, color: PINE_MID, textAlign: 'center', marginBottom: 12 },
  submitBtn: { backgroundColor: PINE, borderRadius: 16, paddingVertical: 17, alignItems: 'center' },
  submitBtnText: { fontFamily: 'Inter-Bold', fontSize: 15.5, color: CREAM },

  successBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(65,120,92,0.12)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(65,120,92,0.3)' },
  successIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: PINE_MID, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: INK },
  successSub: { fontFamily: 'Inter-Regular', fontSize: 12.5, color: PINE_MID, marginTop: 2 },
});
