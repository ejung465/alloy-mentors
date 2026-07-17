import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { isStudent as isStudentRole } from '@/lib/roles';
import { featureEnabled } from '@/lib/features';
import { buildHourVerificationHtml, buildStudentReportHtml } from '@/lib/reports';
import { listGoals, listSkills, listTimeline } from '@/lib/progress';

const PINE = '#165B74';
const PINE_MID = '#2C7C96';
const OCHRE = '#B08A3E';
const GREEN = '#41785C';
const INK = '#22271F';

// ── CSV helpers (self-contained — no dependency needed) ───────────────────────
/** Quote a single field if it holds a comma, quote, or newline; double quotes inside. */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
/** Build a CSV string from a header row and data rows. */
function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
const todayLong = () => new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

/** Write a text file into the cache dir and open the share sheet. */
async function shareText(filename: string, content: string, mimeType: string, uti: string) {
  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  file.write(content);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType, UTI: uti });
  } else {
    Alert.alert('Saved', 'The file was generated but sharing is unavailable on this device.');
  }
}
const shareCsv = (name: string, csv: string) =>
  shareText(name, csv, 'text/csv', 'public.comma-separated-values-text');

async function sharePdf(html: string) {
  const { uri } = await Print.printToFileAsync({ html });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
  } else {
    Alert.alert('Saved', 'The PDF was generated but sharing is unavailable on this device.');
  }
}

function ExportRow({
  icon, label, sublabel, color, onPress, busy, last,
}: {
  icon: any; label: string; sublabel: string; color: string;
  onPress: () => void; busy: boolean; last?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={busy}
      onPress={onPress}
      style={[styles.row, !last && styles.rowBorder, busy && { opacity: 0.55 }]}
    >
      <View style={[styles.rowIcon, { backgroundColor: `${color}18`, borderColor: `${color}30` }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sublabel}</Text>
      </View>
      {busy
        ? <ActivityIndicator size="small" color={color} />
        : <Ionicons name="share-outline" size={18} color="rgba(34,39,31,0.3)" />}
    </TouchableOpacity>
  );
}

export default function DataExportScreen() {
  const router = useRouter();
  const { profile, org } = useUser();
  const orgName = org?.name || 'Alloy Mentors';

  const [busy, setBusy] = useState<string | null>(null);
  // Student roster row linked to this account (for the progress report / student path).
  const [studentRow, setStudentRow] = useState<any | null>(null);
  const [checkedStudent, setCheckedStudent] = useState(false);

  const viewerIsStudent = isStudentRole(profile?.role) || !!studentRow;

  useEffect(() => {
    (async () => {
      if (!profile?.id) return;
      const { data } = await supabase.from('students').select('*').eq('user_id', profile.id).maybeSingle();
      setStudentRow(data ?? null);
      setCheckedStudent(true);
    })();
  }, [profile?.id]);

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try { await fn(); }
    catch (e: any) { Alert.alert("Couldn't export", e?.message ?? 'Please try again.'); }
    finally { setBusy(null); }
  }, [busy]);

  // ── My hours (CSV) ──────────────────────────────────────────────────────────
  const exportHoursCsv = () => run('hours-csv', async () => {
    if (!profile?.id) throw new Error('Your profile is still loading.');
    const { data } = await supabase
      .from('hours_logs')
      .select('date_worked, hours, description, status, created_at')
      .eq('mentor_id', profile.id)
      .order('date_worked', { ascending: false });
    const logs = data ?? [];
    if (!logs.length) { Alert.alert('No hours yet', 'You have no logged hours to export.'); return; }
    const csv = toCsv(
      ['Date', 'Hours', 'Description', 'Status', 'Logged on'],
      logs.map((l: any) => [fmtDate(l.date_worked), l.hours, l.description ?? '', l.status, fmtDate(l.created_at)]),
    );
    await shareCsv('my-hours.csv', csv);
  });

  // ── My hour verification certificate (PDF) ──────────────────────────────────
  const exportHourCertificate = () => run('hours-pdf', async () => {
    if (!profile?.id) throw new Error('Your profile is still loading.');
    const [{ data: approved }, { data: orgRow }] = await Promise.all([
      supabase.from('hours_logs').select('hours, date_worked').eq('mentor_id', profile.id).eq('status', 'approved'),
      org?.id
        ? supabase.from('organizations').select('hours_signer_name, hours_signer_role').eq('id', org.id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const rows = approved ?? [];
    const total = rows.reduce((a: number, r: any) => a + Number(r.hours || 0), 0);
    const dates = rows.map((r: any) => r.date_worked).filter(Boolean).sort();
    const html = buildHourVerificationHtml({
      memberName: profile.full_name || 'Volunteer',
      orgName,
      totalHours: total,
      fromDate: dates[0] ?? null,
      toDate: dates[dates.length - 1] ?? null,
      signerName: (orgRow as any)?.hours_signer_name ?? null,
      signerRole: (orgRow as any)?.hours_signer_role ?? null,
      today: todayLong(),
    });
    await sharePdf(html);
  });

  // ── My attendance history (CSV) ─────────────────────────────────────────────
  const exportAttendanceCsv = () => run('attendance-csv', async () => {
    if (!profile?.id) throw new Error('Your profile is still loading.');
    // Students attend as kind='student' (roster row); everyone else as kind='volunteer'.
    const query = supabase
      .from('session_attendance')
      .select('checked_in_at, kind, session:sessions(title, start_time, location)')
      .order('checked_in_at', { ascending: false });
    const { data } = studentRow
      ? await query.eq('kind', 'student').eq('student_id', studentRow.id)
      : await query.eq('kind', 'volunteer').eq('volunteer_id', profile.id);
    const rows = data ?? [];
    if (!rows.length) { Alert.alert('No attendance yet', 'You have no attendance records to export.'); return; }
    const csv = toCsv(
      ['Checked in', 'Session', 'Session date', 'Location'],
      rows.map((r: any) => [
        fmtDate(r.checked_in_at),
        r.session?.title ?? '',
        fmtDate(r.session?.start_time),
        r.session?.location ?? '',
      ]),
    );
    await shareCsv('my-attendance.csv', csv);
  });

  // ── My progress report (PDF) — student path ─────────────────────────────────
  const exportProgressReport = () => run('progress-pdf', async () => {
    if (!studentRow) { Alert.alert('No progress record', 'Your account is not linked to a student profile yet.'); return; }
    const [goals, skills, timeline] = await Promise.all([
      listGoals(studentRow.id), listSkills(studentRow.id), listTimeline(studentRow.id),
    ]);
    const html = buildStudentReportHtml({
      orgName,
      memberNoun: org?.memberNoun || 'Tutor',
      student: studentRow,
      goals, skills, timeline,
      today: todayLong(),
    });
    await sharePdf(html);
  });

  const hoursOn = featureEnabled(org, 'hours');

  return (
    <SafeAreaView style={styles.screen}>
      <AuroraBackground variant="iris" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.8}>
          <Ionicons name="chevron-back" size={22} color={INK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Export My Data</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>
          Download a personal copy of your records from {orgName}. Files open in your device's share
          sheet — save them, email them, or print them.
        </Text>

        {viewerIsStudent ? (
          <>
            <Text style={styles.sectionLabel}>MY PROGRESS</Text>
            <View style={styles.card}>
              <ExportRow
                icon="ribbon-outline"
                label="Export my progress report"
                sublabel="Goals, skills, and growth timeline (PDF)"
                color={PINE}
                busy={busy === 'progress-pdf'}
                onPress={exportProgressReport}
                last
              />
            </View>

            <Text style={styles.sectionLabel}>MY ATTENDANCE</Text>
            <View style={styles.card}>
              <ExportRow
                icon="calendar-outline"
                label="Export my attendance history"
                sublabel="Every session you checked in to (CSV)"
                color={PINE_MID}
                busy={busy === 'attendance-csv'}
                onPress={exportAttendanceCsv}
                last
              />
            </View>
          </>
        ) : (
          <>
            {hoursOn && (
              <>
                <Text style={styles.sectionLabel}>MY HOURS</Text>
                <View style={styles.card}>
                  <ExportRow
                    icon="time-outline"
                    label="Export my hours"
                    sublabel="Every logged hour entry (CSV)"
                    color={GREEN}
                    busy={busy === 'hours-csv'}
                    onPress={exportHoursCsv}
                  />
                  <ExportRow
                    icon="ribbon-outline"
                    label="Export my hour verification certificate"
                    sublabel="Official signed PDF of approved hours"
                    color={PINE}
                    busy={busy === 'hours-pdf'}
                    onPress={exportHourCertificate}
                    last
                  />
                </View>
              </>
            )}

            <Text style={styles.sectionLabel}>MY ATTENDANCE</Text>
            <View style={styles.card}>
              <ExportRow
                icon="calendar-outline"
                label="Export my attendance history"
                sublabel="Every session you checked in to (CSV)"
                color={PINE_MID}
                busy={busy === 'attendance-csv'}
                onPress={exportAttendanceCsv}
                last
              />
            </View>
          </>
        )}

        {!checkedStudent && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <ActivityIndicator size="small" color={colors.silver} />
            <Text style={styles.note}>Loading your available exports…</Text>
          </View>
        )}

        <Text style={styles.footer}>
          Your data is exported from your device. Alloy Mentors does not receive a copy of these files.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(196,196,196,0.18)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.28)',
  },
  headerTitle: { fontFamily: font.bold, fontSize: 18, color: INK, letterSpacing: -0.3 },
  scroll: { paddingHorizontal: 20, paddingBottom: 60 },
  intro: { fontFamily: font.regular, fontSize: 14, color: colors.textDim, lineHeight: 21, marginBottom: 24 },
  sectionLabel: {
    fontFamily: font.medium, fontSize: 11.5, color: 'rgba(34,39,31,0.35)',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, marginLeft: 4,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1,
    borderColor: colors.hairline, marginBottom: 24, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 15 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(196,196,196,0.2)' },
  rowIcon: { width: 38, height: 38, borderRadius: 11, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontFamily: font.semibold, fontSize: 15, color: INK },
  rowSub: { fontFamily: font.regular, fontSize: 12, color: colors.textFaint, marginTop: 2 },
  note: { fontFamily: font.regular, fontSize: 13, color: colors.silver },
  footer: { fontFamily: font.regular, fontSize: 12, color: colors.textGhost, lineHeight: 18, marginTop: 8 },
});
