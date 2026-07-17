import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Modal, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font, radius } from '@/lib/theme';
import { useUser } from '@/contexts/UserContext';
import { listStudents, type Student } from '@/lib/checkin';

function ageFrom(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let a = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) a--;
  return a;
}

function Avatar({ s, size = 48 }: { s: Student; size?: number }) {
  const initials = s.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  if (s.photo_url) {
    return <Image source={{ uri: s.photo_url }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  }
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarTxt, { fontSize: size * 0.36 }]}>{initials || '?'}</Text>
    </View>
  );
}

export default function StudentRoster() {
  const router = useRouter();
  const { profile } = useUser();

  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setStudents(await listStudents(profile?.organization_id ?? null));
    setLoading(false);
  }, [profile?.organization_id]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return students.filter((s) => s.full_name.toLowerCase().includes(q) || (s.school || '').toLowerCase().includes(q));
  }, [students, query]);

  return (
    <SafeAreaView style={styles.container}>
      <AuroraBackground />

      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Students</Text>
          <Text style={styles.subtitle}>{students.length} in the program</Text>
        </View>
        <TouchableOpacity onPress={() => router.push('/add-student')} style={styles.addBtn}>
          <Ionicons name="person-add-outline" size={18} color={colors.base} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color="#22271F" />
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textFaint} />
        <TextInput style={styles.search} placeholder="Search students…" placeholderTextColor={colors.textGhost} value={query} onChangeText={setQuery} />
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={colors.platinum} size="large" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          ListEmptyComponent={<Text style={styles.empty}>No students yet. Tap the + to add one.</Text>}
          renderItem={({ item }) => {
            return (
              <TouchableOpacity style={styles.row} onPress={() => router.push(`/student/${item.id}`)} activeOpacity={0.85}>
                <Avatar s={item} />
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={styles.rowName}>{item.full_name}</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {[item.grade, item.school].filter(Boolean).join(' · ') || 'Student'}
                  </Text>
                  <View style={styles.tagRow}>
                    {item.language ? <View style={styles.tag}><Text style={styles.tagTxt}>{item.language}</Text></View> : null}
                    {(item.subjects_help || []).slice(0, 2).map((s) => (
                      <View key={s} style={styles.tag}><Text style={styles.tagTxt}>{s}</Text></View>
                    ))}
                    {item.allergies && item.allergies.toLowerCase() !== 'none' ? (
                      <View style={[styles.tag, styles.allergyTag]}>
                        <Ionicons name="alert-circle" size={11} color={colors.rose} />
                        <Text style={[styles.tagTxt, { color: colors.rose }]}>Allergy</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.textGhost} />
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 12 },
  title: { fontFamily: font.black, fontSize: 30, color: colors.text, letterSpacing: -0.8 },
  subtitle: { fontFamily: font.medium, fontSize: 13, color: colors.textFaint, marginTop: 2 },
  addBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.platinum, alignItems: 'center', justifyContent: 'center' },
  closeBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginBottom: 14, paddingHorizontal: 14, height: 48, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline },
  search: { flex: 1, fontFamily: font.regular, fontSize: 15, color: colors.text },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface, marginBottom: 10 },
  avatar: { backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.bold, color: colors.titanium },
  rowName: { fontFamily: font.semibold, fontSize: 16, color: colors.text },
  rowSub: { fontFamily: font.regular, fontSize: 13, color: colors.textFaint, marginTop: 2 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairline },
  allergyTag: { backgroundColor: 'rgba(177,90,78,0.12)', borderColor: 'rgba(177,90,78,0.3)' },
  tagTxt: { fontFamily: font.medium, fontSize: 11, color: colors.textDim },
  empty: { fontFamily: font.regular, fontSize: 14, color: colors.textFaint, textAlign: 'center', marginTop: 50 },

  sheet: { marginTop: 'auto', maxHeight: '86%', backgroundColor: colors.baseElevated, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: colors.hairlineStrong, padding: 20, paddingTop: 12 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.hairlineStrong, alignSelf: 'center', marginBottom: 16 },
  detailHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  detailName: { fontFamily: font.bold, fontSize: 20, color: colors.text, letterSpacing: -0.3 },
  detailSub: { fontFamily: font.regular, fontSize: 13, color: colors.textFaint, marginTop: 3 },

  safetyBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(177,90,78,0.10)', borderWidth: 1, borderColor: 'rgba(177,90,78,0.3)', borderRadius: radius.md, padding: 12, marginBottom: 14 },
  safetyTxt: { flex: 1, fontFamily: font.semibold, fontSize: 14, color: colors.rose },

  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 9 },
  infoIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  infoLabel: { fontFamily: font.medium, fontSize: 11, color: colors.textFaint, textTransform: 'uppercase', letterSpacing: 0.6 },
  infoValue: { fontFamily: font.medium, fontSize: 15, color: colors.text, marginTop: 2 },
  sensitiveLabel: { fontFamily: font.semibold, fontSize: 11, color: colors.steel, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 16, marginBottom: 4 },

  notesHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22, marginBottom: 12, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.hairline },
  notesTitle: { fontFamily: font.bold, fontSize: 17, color: colors.text, letterSpacing: -0.3 },
  noteComposer: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, padding: 12, marginBottom: 14 },
  noteInput: { fontFamily: font.regular, fontSize: 15, color: colors.text, minHeight: 60, textAlignVertical: 'top' },
  noteAddBtn: { alignSelf: 'flex-end', backgroundColor: colors.platinum, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 18, marginTop: 8 },
  noteAddTxt: { fontFamily: font.bold, fontSize: 13, color: colors.base },
  notesEmpty: { fontFamily: font.regular, fontSize: 13, color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  noteCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, padding: 14, marginBottom: 10 },
  noteMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  noteAuthor: { fontFamily: font.semibold, fontSize: 13, color: colors.titanium },
  noteDate: { fontFamily: font.regular, fontSize: 12, color: colors.textFaint },
  noteBody: { fontFamily: font.regular, fontSize: 15, color: colors.text, lineHeight: 21 },
});

