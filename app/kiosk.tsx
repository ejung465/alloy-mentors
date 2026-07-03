import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput,
  TouchableOpacity, View, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font, radius } from '@/lib/theme';
import { useUser } from '@/contexts/UserContext';
import { canCreateEvents } from '@/lib/roles';
import { verifyCheckinPayload } from '@/lib/qr';
import { featureEnabled } from '@/lib/features';
import {
  getActiveSession, listStudents, listVolunteers, listSessionAttendance,
  checkInVolunteer, checkInStudentAndPair, undoAttendance,
  type Student, type Volunteer, type AttendanceRow,
} from '@/lib/checkin';

type Mode = 'students' | 'volunteers';

export default function CheckInKiosk() {
  const router = useRouter();
  const { user, profile, org } = useUser();
  const memberNoun = org?.memberNoun || 'Tutor';
  const membersLabel = org?.memberNounPlural || 'Tutors';
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [volunteers, setVolunteers] = useState<Volunteer[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [mode, setMode] = useState<Mode>('students');
  const [query, setQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();

  const volName = useMemo(() => {
    const m: Record<string, string> = {};
    volunteers.forEach((v) => { m[v.id] = v.full_name; });
    return m;
  }, [volunteers]);

  const load = useCallback(async () => {
    const orgId = profile?.organization_id ?? null;
    const { data: sess } = await getActiveSession();
    setSession(sess);
    const [st, vol] = await Promise.all([listStudents(orgId), listVolunteers(orgId)]);
    setStudents(st);
    setVolunteers(vol);
    if (sess?.id) setAttendance(await listSessionAttendance(sess.id));
    setLoading(false);
  }, [profile?.organization_id]);

  useEffect(() => { load(); }, [load]);

  const refreshAttendance = async () => {
    if (session?.id) setAttendance(await listSessionAttendance(session.id));
  };

  const volIn = useMemo(
    () => new Set(attendance.filter((a) => a.kind === 'volunteer').map((a) => a.volunteer_id)),
    [attendance]
  );
  const studentAtt = useMemo(() => {
    const m: Record<string, AttendanceRow> = {};
    attendance.filter((a) => a.kind === 'student').forEach((a) => { if (a.student_id) m[a.student_id] = a; });
    return m;
  }, [attendance]);

  const handleCheckInVolunteer = async (v: Volunteer) => {
    if (!session?.id) { Alert.alert('No active session', 'There is no session to check into right now.'); return; }
    setBusyId(v.id);
    const { error } = await checkInVolunteer(session.id, v.id, user?.id);
    setBusyId(null);
    if (error) { Alert.alert('Error', error.message); return; }
    await refreshAttendance();
  };

  const handleCheckInStudent = async (s: Student) => {
    if (!session?.id) { Alert.alert('No active session', 'There is no session to check into right now.'); return; }
    setBusyId(s.id);
    const { pairedVolunteerId, matchReason, error } = await checkInStudentAndPair(session.id, s.id, user?.id);
    setBusyId(null);
    if (error) { Alert.alert('Error', error.message); return; }
    await refreshAttendance();
    if (!pairedVolunteerId) {
      Alert.alert('Checked in — not paired', 'No volunteers are checked in yet. Check in volunteers first, then re-pair this student.');
    } else {
      const volName2 = volName[pairedVolunteerId] || 'a volunteer';
      Alert.alert('Paired', `${s.full_name} → ${volName2}${matchReason ? `\n${matchReason}` : ''}`);
    }
  };

  const handleUndo = async (attId: string) => {
    await undoAttendance(attId);
    await refreshAttendance();
  };

  const openScanner = async () => {
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        Alert.alert('Camera required', 'Allow camera access to scan volunteer QR codes.');
        return;
      }
    }
    setScanned(false);
    setScanOpen(true);
  };

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (scanned) return;
    setScanned(true);

    const verdict = await verifyCheckinPayload(data);
    if ('error' in verdict) {
      const msg =
        verdict.error === 'expired'
          ? 'That code expired — ask them to pull it up again. It refreshes every 30 seconds.'
          : 'Not a valid Alloy check-in code.';
      Alert.alert(verdict.error === 'expired' ? 'Code expired' : 'Invalid QR', msg, [
        { text: 'Scan again', onPress: () => setScanned(false) },
        { text: 'Close', onPress: () => setScanOpen(false) },
      ]);
      return;
    }

    const volunteerId = verdict.userId;
    const volunteer = volunteers.find((v) => v.id === volunteerId);
    if (!volunteer) {
      Alert.alert('Not found', `${memberNoun} not in this org.`, [
        { text: 'Try again', onPress: () => setScanned(false) },
        { text: 'Close', onPress: () => setScanOpen(false) },
      ]);
      return;
    }

    if (!session?.id) {
      Alert.alert('No session', 'No active session right now.');
      setScanOpen(false);
      return;
    }

    setBusyId(volunteerId);
    const { error } = await checkInVolunteer(session.id, volunteerId, user?.id);
    setBusyId(null);

    if (error) {
      Alert.alert('Error', error.message, [
        { text: 'Try again', onPress: () => setScanned(false) },
      ]);
    } else {
      await refreshAttendance();
      Alert.alert('Checked in!', `${volunteer.full_name} is now in.`, [
        { text: 'Scan next', onPress: () => setScanned(false) },
        { text: 'Done', onPress: () => setScanOpen(false) },
      ]);
    }
  };

  const filteredStudents = students.filter((s) => s.full_name.toLowerCase().includes(query.toLowerCase()));
  const filteredVolunteers = volunteers.filter((v) => v.full_name.toLowerCase().includes(query.toLowerCase()));

  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <AuroraBackground />
        <ActivityIndicator size="large" color={colors.platinum} />
      </SafeAreaView>
    );
  }

  // Module gate: the org may simply not use QR check-in.
  if (!featureEnabled(org, 'checkin')) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
        <AuroraBackground />
        <Ionicons name="qr-code-outline" size={40} color={colors.textFaint} />
        <Text style={[styles.title, { textAlign: 'center', marginTop: 12 }]}>Check-in is off</Text>
        <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 6 }]}>QR check-in isn't enabled for {org?.name || 'this organization'}. Admins can switch it on in Organization Settings.</Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.scanBtn, { marginTop: 20 }]}>
          <Text style={styles.scanTxt}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  // Real authorization — not just hiding the launcher. Check-in is leadership/director only.
  if (profile && !canCreateEvents(profile.role)) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
        <AuroraBackground />
        <Ionicons name="lock-closed-outline" size={40} color={colors.textFaint} />
        <Text style={[styles.title, { textAlign: 'center', marginTop: 12 }]}>Check-In restricted</Text>
        <Text style={[styles.subtitle, { textAlign: 'center', marginTop: 6 }]}>Only directors and leadership can run door check-in.</Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.scanBtn, { marginTop: 20 }]}>
          <Text style={styles.scanTxt}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const goingVolunteers = attendance.filter((a) => a.kind === 'volunteer').length;
  const pairedStudents = attendance.filter((a) => a.kind === 'student').length;

  return (
    <SafeAreaView style={styles.container}>
      <AuroraBackground />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Check-In</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {session ? session.title : 'No active session'}
          </Text>
        </View>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color="#22271F" />
        </TouchableOpacity>
      </View>

      {/* Summary */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryNum}>{goingVolunteers}</Text>
          <Text style={styles.summaryLbl}>{membersLabel} in</Text>
        </View>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryNum}>{pairedStudents}</Text>
          <Text style={styles.summaryLbl}>Students paired</Text>
        </View>
      </View>

      {/* Mode toggle */}
      <View style={styles.segment}>
        {(['students', 'volunteers'] as Mode[]).map((m) => (
          <TouchableOpacity
            key={m}
            onPress={() => { setMode(m); setQuery(''); }}
            style={[styles.segmentBtn, mode === m && styles.segmentBtnActive]}
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentTxt, mode === m && styles.segmentTxtActive]}>
              {m === 'students' ? 'Students' : membersLabel}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Scan QR button — only shown in volunteers mode */}
      {mode === 'volunteers' && (
        <TouchableOpacity onPress={openScanner} style={styles.scanBtn} activeOpacity={0.85}>
          <Ionicons name="qr-code-outline" size={18} color={colors.base} />
          <Text style={styles.scanTxt}>Scan {memberNoun} QR</Text>
        </TouchableOpacity>
      )}

      {/* Search */}
      <View style={styles.searchWrap}>
        <Ionicons name="search" size={16} color={colors.textFaint} />
        <TextInput
          style={styles.searchInput}
          placeholder={`Search ${mode}…`}
          placeholderTextColor={colors.textGhost}
          value={query}
          onChangeText={setQuery}
        />
      </View>

      {mode === 'students' ? (
        <FlatList
          data={filteredStudents}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          ListEmptyComponent={<Text style={styles.empty}>No students on the roster yet. Use “Add Student”.</Text>}
          renderItem={({ item }) => {
            const att = studentAtt[item.id];
            const paired = att?.paired_volunteer_id ? volName[att.paired_volunteer_id] : null;
            return (
              <View style={[styles.row, att && styles.rowDone]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{item.full_name}</Text>
                  {att ? (
                    <Text style={styles.rowPaired}>
                      {paired ? `Paired with ${paired}` : 'Checked in · awaiting volunteer'}
                    </Text>
                  ) : (
                    <Text style={styles.rowSub}>{item.grade || 'Student'}</Text>
                  )}
                </View>
                {att ? (
                  <TouchableOpacity onPress={() => handleUndo(att.id)} style={styles.undoBtn}>
                    <Text style={styles.undoTxt}>Remove</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => handleCheckInStudent(item)} style={styles.checkBtn} disabled={busyId === item.id}>
                    <Text style={styles.checkTxt}>{busyId === item.id ? '…' : 'Check In'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      ) : (
        <FlatList
          data={filteredVolunteers}
          keyExtractor={(v) => v.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
          ListEmptyComponent={<Text style={styles.empty}>No volunteers found.</Text>}
          renderItem={({ item }) => {
            const inHere = volIn.has(item.id);
            const att = attendance.find((a) => a.kind === 'volunteer' && a.volunteer_id === item.id);
            return (
              <View style={[styles.row, inHere && styles.rowDone]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowName}>{item.full_name}</Text>
                  <Text style={[styles.rowSub, inHere && { color: colors.mint }]}>{inHere ? 'Checked in' : item.school || memberNoun}</Text>
                </View>
                {inHere && att ? (
                  <TouchableOpacity onPress={() => handleUndo(att.id)} style={styles.undoBtn}>
                    <Text style={styles.undoTxt}>Remove</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => handleCheckInVolunteer(item)} style={styles.checkBtn} disabled={busyId === item.id}>
                    <Text style={styles.checkTxt}>{busyId === item.id ? '…' : 'Check In'}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          }}
        />
      )}
      {/* QR Camera Modal */}
      <Modal visible={scanOpen} animationType="slide" presentationStyle="fullScreen">
        <View style={styles.cameraContainer}>
          <CameraView
            style={StyleSheet.absoluteFillObject}
            facing="back"
            onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          />
          {/* Overlay UI */}
          <View style={styles.cameraOverlay}>
            <TouchableOpacity onPress={() => setScanOpen(false)} style={styles.cameraClose}>
              <Ionicons name="close" size={22} color="#22271F" />
            </TouchableOpacity>
            <Text style={styles.cameraTitle}>Scan {memberNoun} QR</Text>
            <View style={styles.cameraFrame} />
            <View style={{ alignItems: 'center', gap: 14 }}>
              <Text style={styles.cameraHint}>Ask the volunteer to open their profile → "Check-In QR"</Text>
              {/* Manual fallback — forgot phone, dead battery, etc. */}
              <TouchableOpacity onPress={() => { setScanOpen(false); setMode('volunteers'); setQuery(''); }} style={styles.manualBtn} activeOpacity={0.85}>
                <Ionicons name="create-outline" size={16} color="#22271F" />
                <Text style={styles.manualTxt}>Can't scan? Check in by name</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  title: { color: colors.text, fontSize: 28, fontFamily: font.black, letterSpacing: -0.8 },
  subtitle: { color: colors.mint, fontSize: 14, marginTop: 2, fontFamily: font.medium },
  closeBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },

  summaryRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginBottom: 14 },
  summaryTile: { flex: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  summaryNum: { fontFamily: font.black, fontSize: 26, color: colors.text, letterSpacing: -1 },
  summaryLbl: { fontFamily: font.medium, fontSize: 12, color: colors.textFaint, marginTop: 2 },

  segment: { flexDirection: 'row', marginHorizontal: 20, marginBottom: 14, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, padding: 4, gap: 4 },
  segmentBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong },
  segmentTxt: { fontFamily: font.semibold, fontSize: 14, color: colors.textFaint },
  segmentTxtActive: { color: colors.text },

  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 20, marginBottom: 14, paddingHorizontal: 14, height: 48, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline },
  searchInput: { flex: 1, fontFamily: font.regular, fontSize: 15, color: colors.text },

  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.surface, marginBottom: 10 },
  rowDone: { borderColor: 'rgba(76,122,97,0.4)', backgroundColor: 'rgba(76,122,97,0.06)' },
  rowName: { fontFamily: font.semibold, fontSize: 16, color: colors.text },
  rowSub: { fontFamily: font.regular, fontSize: 13, color: colors.textFaint, marginTop: 2 },
  rowPaired: { fontFamily: font.semibold, fontSize: 13, color: colors.mint, marginTop: 2 },
  checkBtn: { backgroundColor: colors.platinum, paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20 },
  checkTxt: { color: colors.base, fontFamily: font.bold, fontSize: 13 },
  undoBtn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, borderWidth: 1, borderColor: colors.hairlineStrong },
  undoTxt: { color: colors.textDim, fontFamily: font.semibold, fontSize: 13 },
  empty: { fontFamily: font.regular, fontSize: 14, color: colors.textFaint, textAlign: 'center', marginTop: 40 },

  scanBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20, marginBottom: 14, backgroundColor: colors.platinum, paddingVertical: 13, paddingHorizontal: 20, borderRadius: radius.md, justifyContent: 'center' },
  scanTxt: { fontFamily: font.bold, fontSize: 15, color: colors.base },

  cameraContainer: { flex: 1, backgroundColor: '#000' },
  cameraOverlay: { flex: 1, alignItems: 'center', justifyContent: 'space-between', paddingTop: 64, paddingBottom: 80, paddingHorizontal: 24 },
  cameraClose: { position: 'absolute', top: 56, right: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  cameraTitle: { fontFamily: font.bold, fontSize: 22, color: '#22271F', letterSpacing: -0.5 },
  cameraFrame: { width: 240, height: 240, borderRadius: 24, borderWidth: 2, borderColor: colors.platinum, backgroundColor: 'transparent' },
  cameraHint: { fontFamily: font.regular, fontSize: 13, color: 'rgba(34,39,31,0.6)', textAlign: 'center' },
  manualBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 24, backgroundColor: 'rgba(43,70,56,0.16)', borderWidth: 1, borderColor: 'rgba(43,70,56,0.3)' },
  manualTxt: { fontFamily: font.semibold, fontSize: 14, color: '#22271F' },
});
