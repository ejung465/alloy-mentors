import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator, Alert, Dimensions, FlatList, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font, radius } from '@/lib/theme';
import { useUser } from '@/contexts/UserContext';
import { canCreateEvents } from '@/lib/roles';
import {
  getActiveSession, listMyPairedStudents, listStudentNotes, addStudentNote,
  type Student, type StudentNote,
} from '@/lib/checkin';

const { width: SCREEN_W } = Dimensions.get('window');

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function Avatar({ s, size }: { s: Student; size: number }) {
  const initials = s.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  if (s.photo_url) return <Image source={{ uri: s.photo_url }} style={{ width: size, height: size, borderRadius: size / 2 }} contentFit="cover" />;
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarTxt, { fontSize: size * 0.36 }]}>{initials || '?'}</Text>
    </View>
  );
}


// ── One swipeable pairing card: notes-first, profile on tap ──────────────────
function PairingCard({ student, sessionId, elevated }: { student: Student; sessionId: string | null; elevated: boolean }) {
  const { profile } = useUser();
  const cardRouter = useRouter();
  const [notes, setNotes] = useState<StudentNote[]>([]);
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);

  const loadNotes = useCallback(() => { listStudentNotes(student.id).then(setNotes); }, [student.id]);
  useEffect(() => { loadNotes(); }, [loadNotes]);

  const add = async () => {
    if (!noteText.trim()) return;
    if (!profile?.id) { Alert.alert('Still loading', 'Your profile is still loading — try again in a moment.'); return; }
    setSaving(true);
    const { error } = await addStudentNote({
      studentId: student.id, content: noteText,
      authorId: profile.id, authorName: profile.full_name ?? 'Tutor', sessionId,
    });
    setSaving(false);
    if (!error) { setNoteText(''); loadNotes(); }
    else Alert.alert("Couldn't save note", error.message);
  };

  return (
    <View style={{ width: SCREEN_W }}>
      <ScrollView contentContainerStyle={styles.cardContent} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Tap the header → full progress profile */}
        <TouchableOpacity style={styles.studentHeader} activeOpacity={0.85} onPress={() => cardRouter.push(`/student/${student.id}`)}>
          <Avatar s={student} size={56} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.sName}>{student.full_name}</Text>
            <Text style={styles.sSub}>{[student.grade, student.language].filter(Boolean).join(' · ') || 'Student'}</Text>
          </View>
          <View style={styles.profileChip}>
            <Ionicons name="trending-up-outline" size={14} color={colors.platinum} />
            <Text style={styles.profileChipTxt}>Progress</Text>
          </View>
        </TouchableOpacity>

        {/* Allergy safety flag stays visible even in notes view */}
        {student.allergies && student.allergies.toLowerCase() !== 'none' ? (
          <View style={styles.safetyBox}>
            <Ionicons name="medkit" size={15} color={colors.rose} />
            <Text style={styles.safetyTxt}>Allergies: {student.allergies}</Text>
          </View>
        ) : null}

        {/* Notes first */}
        <Text style={styles.notesTitle}>Session Notes</Text>
        <View style={styles.composer}>
          <TextInput
            style={styles.noteInput}
            placeholder="What did you work on today? (e.g. one-digit multiplication)"
            placeholderTextColor={colors.textGhost}
            value={noteText}
            onChangeText={setNoteText}
            multiline
          />
          <TouchableOpacity onPress={add} disabled={saving || !noteText.trim()} style={[styles.addBtn, (saving || !noteText.trim()) && { opacity: 0.4 }]}>
            <Text style={styles.addBtnTxt}>{saving ? 'Saving…' : 'Add note'}</Text>
          </TouchableOpacity>
        </View>

        {notes.length === 0 ? (
          <Text style={styles.empty}>No notes yet — you're first. Log what you worked on after the session.</Text>
        ) : (
          notes.map((n) => (
            <View key={n.id} style={styles.noteCard}>
              <View style={styles.noteMeta}>
                <Text style={styles.noteAuthor}>{n.author_name || 'Tutor'}</Text>
                <Text style={styles.noteDate}>{fmtDate(n.created_at)}</Text>
              </View>
              <Text style={styles.noteBody}>{n.content}</Text>
            </View>
          ))
        )}
      </ScrollView>

    </View>
  );
}

export default function MyPairingScreen() {
  const router = useRouter();
  const { profile } = useUser();
  const elevated = canCreateEvents(profile?.role);
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  const load = useCallback(async () => {
    const { data: sess } = await getActiveSession();
    setSessionId(sess?.id ?? null);
    if (sess?.id && profile?.id) setStudents(await listMyPairedStudents(sess.id, profile.id));
    else setStudents([]);
    setLoading(false);
  }, [profile?.id]);

  useEffect(() => { load(); }, [load]);

  // Refetch when the screen regains focus, and live when a new pairing arrives.
  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => {
    if (!profile?.id) return;
    const channel = supabase
      .channel('my_pairing_live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_attendance', filter: `paired_volunteer_id=eq.${profile.id}` },
        () => { load(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [profile?.id, load]);

  // Keep the pager index valid if the paired set shrinks.
  useEffect(() => { setIndex((i) => Math.min(i, Math.max(0, students.length - 1))); }, [students.length]);

  return (
    <SafeAreaView style={styles.container}>
      <AuroraBackground />
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>My Student{students.length > 1 ? 's' : ''}</Text>
          <Text style={styles.subtitle}>
            {students.length > 1 ? `${students.length} paired · swipe to switch` : students.length === 1 ? 'Paired for this session' : 'Current session'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color="#22271F" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator color={colors.platinum} size="large" /></View>
      ) : students.length === 0 ? (
        <View style={styles.emptyWrap}>
          <Ionicons name="people-outline" size={44} color={colors.textGhost} />
          <Text style={styles.emptyTitle}>No pairing yet</Text>
          <Text style={styles.emptySub}>Once the check-in person pairs you with a student this session, they'll show up here.</Text>
        </View>
      ) : (
        <>
          {/* Pager dots */}
          {students.length > 1 && (
            <View style={styles.dots}>
              {students.map((_, i) => (
                <View key={i} style={[styles.dot, i === index && styles.dotActive]} />
              ))}
            </View>
          )}
          <FlatList
            data={students}
            keyExtractor={(s) => s.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
            renderItem={({ item }) => <PairingCard student={item} sessionId={sessionId} elevated={elevated} />}
          />
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 8 },
  title: { fontFamily: font.black, fontSize: 30, color: colors.text, letterSpacing: -0.8 },
  subtitle: { fontFamily: font.medium, fontSize: 13, color: colors.textFaint, marginTop: 2 },
  closeBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },

  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: colors.hairlineStrong },
  dotActive: { backgroundColor: colors.platinum, width: 18 },

  cardContent: { paddingHorizontal: 20, paddingBottom: 40 },
  studentHeader: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.lg, padding: 14, marginBottom: 14 },
  sName: { fontFamily: font.bold, fontSize: 19, color: colors.text, letterSpacing: -0.3 },
  sSub: { fontFamily: font.regular, fontSize: 13, color: colors.textFaint, marginTop: 3 },
  profileChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 14, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong },
  profileChipTxt: { fontFamily: font.semibold, fontSize: 12, color: colors.platinum },

  safetyBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(177,90,78,0.10)', borderWidth: 1, borderColor: 'rgba(177,90,78,0.3)', borderRadius: radius.md, padding: 12, marginBottom: 14 },
  safetyTxt: { flex: 1, fontFamily: font.semibold, fontSize: 14, color: colors.rose },

  notesTitle: { fontFamily: font.bold, fontSize: 17, color: colors.text, letterSpacing: -0.3, marginBottom: 10 },
  composer: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, padding: 12, marginBottom: 14 },
  noteInput: { fontFamily: font.regular, fontSize: 15, color: colors.text, minHeight: 64, textAlignVertical: 'top' },
  addBtn: { alignSelf: 'flex-end', backgroundColor: colors.platinum, paddingHorizontal: 18, paddingVertical: 9, borderRadius: 18, marginTop: 8 },
  addBtnTxt: { fontFamily: font.bold, fontSize: 13, color: colors.base },
  empty: { fontFamily: font.regular, fontSize: 13, color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  noteCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, padding: 14, marginBottom: 10 },
  noteMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  noteAuthor: { fontFamily: font.semibold, fontSize: 13, color: colors.titanium },
  noteDate: { fontFamily: font.regular, fontSize: 12, color: colors.textFaint },
  noteBody: { fontFamily: font.regular, fontSize: 15, color: colors.text, lineHeight: 21 },

  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 10 },
  emptyTitle: { fontFamily: font.bold, fontSize: 18, color: colors.text },
  emptySub: { fontFamily: font.regular, fontSize: 14, color: colors.textFaint, textAlign: 'center', lineHeight: 20 },

  avatar: { backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.bold, color: colors.titanium },
});
