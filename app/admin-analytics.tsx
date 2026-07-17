import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { canManageOrg } from '@/lib/roles';

const PINE = '#165B74';
const PINE_MID = '#2C7C96';
const OCHRE = '#B08A3E';
const GREEN = '#41785C';
const INK = '#22271F';

// ── CSV helpers (self-contained) ──────────────────────────────────────────────
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}
const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

const startOfMonthIso = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
};
const daysAgoIso = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

type Analytics = {
  hoursThisMonth: number;
  hoursAllTime: number;
  memberCount: number;
  studentCount: number;
  weeks: { label: string; count: number }[]; // last 8 weeks, oldest→newest
  retentionPct: number | null;               // % members active in last 30d
  activeMembers: number;
  goalAchievedPct: number | null;            // % goals achieved
  goalsAchieved: number;
  goalsTotal: number;
};

// ── Proportional bar row (mirrors profile.tsx StatBar) ────────────────────────
function TrendBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={[styles.barVal, { color }]}>{value}</Text>
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${Math.max(pct * 100, value > 0 ? 4 : 0)}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

function StatTile({ value, label, color }: { value: string | number; label: string; color: string }) {
  return (
    <View style={styles.tile}>
      <Text style={[styles.tileVal, { color }]}>{value}</Text>
      <Text style={styles.tileLbl}>{label}</Text>
    </View>
  );
}

export default function AdminAnalyticsScreen() {
  const router = useRouter();
  const { profile, org } = useUser();
  const orgId = org?.id ?? null;
  const orgName = org?.name || 'Alloy Mentors';

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Analytics | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    setLoading(true);

    const [
      { data: approvedHours },
      { count: memberCount },
      { count: studentCount },
      { data: sessions8w },
      { data: activeAtt30d },
      { data: goals },
    ] = await Promise.all([
      supabase.from('hours_logs').select('hours, date_worked').eq('organization_id', orgId).eq('status', 'approved'),
      supabase.from('users').select('*', { count: 'exact', head: true }).eq('organization_id', orgId).neq('role', 'student'),
      supabase.from('students').select('*', { count: 'exact', head: true }).eq('organization_id', orgId),
      supabase.from('sessions').select('id, start_time').eq('organization_id', orgId).gte('start_time', daysAgoIso(56)),
      supabase.from('session_attendance').select('volunteer_id').eq('organization_id', orgId).eq('kind', 'volunteer').gte('checked_in_at', daysAgoIso(30)),
      supabase.from('student_goals').select('status').eq('organization_id', orgId),
    ]);

    const monthStart = startOfMonthIso();
    const hoursAllTime = (approvedHours ?? []).reduce((a: number, r: any) => a + Number(r.hours || 0), 0);
    const hoursThisMonth = (approvedHours ?? [])
      .filter((r: any) => r.date_worked && new Date(r.date_worked).toISOString() >= monthStart)
      .reduce((a: number, r: any) => a + Number(r.hours || 0), 0);

    // 8 weekly buckets from sessions' start_time (sessions-per-week).
    const now = Date.now();
    const weekMs = 7 * 86400000;
    const buckets = Array.from({ length: 8 }, (_, i) => {
      const end = now - (7 - i) * weekMs + weekMs; // window [start, end)
      const start = end - weekMs;
      return { start, end, count: 0, label: new Date(start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
    });
    (sessions8w ?? []).forEach((s: any) => {
      const t = new Date(s.start_time).getTime();
      const b = buckets.find((x) => t >= x.start && t < x.end);
      if (b) b.count += 1;
    });

    const activeMembers = new Set((activeAtt30d ?? []).map((r: any) => r.volunteer_id).filter(Boolean)).size;
    const members = memberCount ?? 0;
    const retentionPct = members > 0 ? Math.round((activeMembers / members) * 100) : null;

    const goalsTotal = (goals ?? []).length;
    const goalsAchieved = (goals ?? []).filter((g: any) => g.status === 'achieved').length;
    const goalAchievedPct = goalsTotal > 0 ? Math.round((goalsAchieved / goalsTotal) * 100) : null;

    setData({
      hoursThisMonth, hoursAllTime,
      memberCount: members, studentCount: studentCount ?? 0,
      weeks: buckets.map((b) => ({ label: b.label, count: b.count })),
      retentionPct, activeMembers,
      goalAchievedPct, goalsAchieved, goalsTotal,
    });
    setLoading(false);
  }, [orgId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // ── Org-wide CSV export (hours + attendance + students) ──────────────────────
  const exportOrgCsv = async () => {
    if (!orgId || exporting) return;
    setExporting(true);
    try {
      const [{ data: hours }, { data: attendance }, { data: students }, { data: users }] = await Promise.all([
        supabase.from('hours_logs').select('mentor_id, hours, date_worked, description, status, created_at').eq('organization_id', orgId).order('date_worked', { ascending: false }),
        supabase.from('session_attendance').select('kind, volunteer_id, student_id, checked_in_at, session_id').eq('organization_id', orgId).order('checked_in_at', { ascending: false }),
        supabase.from('students').select('full_name, grade, guardian_name, guardian_email, active, created_at').eq('organization_id', orgId).order('full_name'),
        supabase.from('users').select('id, full_name, email').eq('organization_id', orgId),
      ]);

      const userName = new Map<string, string>();
      (users ?? []).forEach((u: any) => userName.set(u.id, u.full_name || u.email || u.id));
      const studentName = new Map<string, string>();
      // Students CSV rows don't carry ids here; fetch id→name for attendance labels.
      const { data: studentIds } = await supabase.from('students').select('id, full_name').eq('organization_id', orgId);
      (studentIds ?? []).forEach((s: any) => studentName.set(s.id, s.full_name || s.id));

      const hoursCsv = toCsv(
        ['Member', 'Date', 'Hours', 'Description', 'Status', 'Logged on'],
        (hours ?? []).map((h: any) => [userName.get(h.mentor_id) ?? h.mentor_id, fmtDate(h.date_worked), h.hours, h.description ?? '', h.status, fmtDate(h.created_at)]),
      );
      const attCsv = toCsv(
        ['Kind', 'Who', 'Checked in', 'Session ID'],
        (attendance ?? []).map((a: any) => [
          a.kind,
          a.kind === 'volunteer' ? (userName.get(a.volunteer_id) ?? a.volunteer_id ?? '') : (studentName.get(a.student_id) ?? a.student_id ?? ''),
          fmtDate(a.checked_in_at),
          a.session_id ?? '',
        ]),
      );
      const studentsCsv = toCsv(
        ['Student', 'Grade', 'Guardian', 'Guardian email', 'Active', 'Added'],
        (students ?? []).map((s: any) => [s.full_name, s.grade ?? '', s.guardian_name ?? '', s.guardian_email ?? '', s.active ? 'Yes' : 'No', fmtDate(s.created_at)]),
      );

      const combined =
        `${orgName} — Data Export (${fmtDate(new Date().toISOString())})\r\n\r\n` +
        `# HOURS LOGS\r\n${hoursCsv}\r\n\r\n` +
        `# SESSION ATTENDANCE\r\n${attCsv}\r\n\r\n` +
        `# STUDENTS\r\n${studentsCsv}\r\n`;

      const file = new File(Paths.cache, 'org-data-export.csv');
      file.create({ overwrite: true });
      file.write(combined);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', UTI: 'public.comma-separated-values-text' });
      } else {
        Alert.alert('Saved', 'The export was generated but sharing is unavailable on this device.');
      }
    } catch (e: any) {
      Alert.alert("Couldn't export", e?.message ?? 'Please try again.');
    } finally {
      setExporting(false);
    }
  };

  // ── Admin gate (mirrors org-settings.tsx) ────────────────────────────────────
  if (!canManageOrg(profile?.role)) {
    return (
      <SafeAreaView style={styles.screen}>
        <AuroraBackground />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.textFaint} />
          <Text style={styles.lockedTxt}>Analytics are for admins and leadership.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.lockedBack}>
            <Text style={styles.lockedBackTxt}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const maxWeek = data ? Math.max(1, ...data.weeks.map((w) => w.count)) : 1;

  return (
    <SafeAreaView style={styles.screen}>
      <AuroraBackground variant="iris" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.8}>
          <Ionicons name="chevron-back" size={22} color={INK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Analytics</Text>
        <View style={{ width: 40 }} />
      </View>

      {loading || !data ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={PINE} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.orgName}>{orgName}</Text>

          {/* Headline stats */}
          <View style={styles.tileRow}>
            <StatTile value={data.hoursThisMonth} label="Approved hrs (month)" color={PINE} />
            <StatTile value={data.hoursAllTime} label="Approved hrs (all-time)" color={PINE_MID} />
          </View>
          <View style={styles.tileRow}>
            <StatTile value={data.memberCount} label={org?.memberNounPlural || 'Members'} color={GREEN} />
            <StatTile value={data.studentCount} label={org?.studentNounPlural || 'Students'} color={OCHRE} />
          </View>

          {/* Attendance trend */}
          <Text style={styles.sectionLabel}>SESSIONS PER WEEK · LAST 8 WEEKS</Text>
          <View style={styles.card}>
            {data.weeks.every((w) => w.count === 0) ? (
              <Text style={styles.empty}>No sessions in the last 8 weeks.</Text>
            ) : (
              data.weeks.map((w) => (
                <TrendBar key={w.label} label={`Wk of ${w.label}`} value={w.count} max={maxWeek} color={PINE_MID} />
              ))
            )}
          </View>

          {/* Retention */}
          <Text style={styles.sectionLabel}>MEMBER RETENTION</Text>
          <View style={styles.card}>
            <View style={styles.metricRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.metricLead}>
                  {data.retentionPct == null ? '—' : `${data.retentionPct}%`}
                </Text>
                <Text style={styles.metricSub}>
                  {data.activeMembers} of {data.memberCount} {(org?.memberNounPlural || 'members').toLowerCase()} attended a session in the last 30 days
                </Text>
              </View>
            </View>
            <View style={[styles.barTrack, { marginTop: 12 }]}>
              <View style={[styles.barFill, { width: `${data.retentionPct ?? 0}%`, backgroundColor: GREEN }]} />
            </View>
          </View>

          {/* Goal completion */}
          <Text style={styles.sectionLabel}>GOAL COMPLETION</Text>
          <View style={styles.card}>
            <View style={styles.metricRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.metricLead}>
                  {data.goalAchievedPct == null ? '—' : `${data.goalAchievedPct}%`}
                </Text>
                <Text style={styles.metricSub}>
                  {data.goalsAchieved} of {data.goalsTotal} student goals achieved
                </Text>
              </View>
            </View>
            <View style={[styles.barTrack, { marginTop: 12 }]}>
              <View style={[styles.barFill, { width: `${data.goalAchievedPct ?? 0}%`, backgroundColor: OCHRE }]} />
            </View>
          </View>

          {/* Org-wide export */}
          <Text style={styles.sectionLabel}>EXPORT</Text>
          <TouchableOpacity
            onPress={exportOrgCsv}
            disabled={exporting}
            activeOpacity={0.85}
            style={[styles.exportBtn, exporting && { opacity: 0.6 }]}
          >
            {exporting
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="download-outline" size={18} color="#fff" />}
            <Text style={styles.exportBtnTxt}>{exporting ? 'Preparing…' : 'Export org data (CSV)'}</Text>
          </TouchableOpacity>
          <Text style={styles.footer}>
            Includes all hours logs, session attendance, and students for {orgName} in one CSV.
          </Text>
        </ScrollView>
      )}
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
  orgName: { fontFamily: font.black, fontSize: 24, color: INK, letterSpacing: -0.6, marginBottom: 18 },

  tileRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  tile: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.hairline,
    paddingVertical: 18, paddingHorizontal: 16, alignItems: 'flex-start',
  },
  tileVal: { fontFamily: font.black, fontSize: 30, letterSpacing: -1 },
  tileLbl: { fontFamily: font.medium, fontSize: 12, color: colors.textFaint, marginTop: 4 },

  sectionLabel: {
    fontFamily: font.medium, fontSize: 11.5, color: 'rgba(34,39,31,0.35)',
    letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 16, marginBottom: 10, marginLeft: 4,
  },
  card: {
    backgroundColor: colors.surface, borderRadius: 18, borderWidth: 1, borderColor: colors.hairline,
    padding: 18,
  },
  empty: { fontFamily: font.regular, fontSize: 13, color: colors.textFaint },

  barLabel: { fontFamily: font.medium, fontSize: 13, color: 'rgba(34,39,31,0.6)' },
  barVal: { fontFamily: font.bold, fontSize: 13 },
  barTrack: { height: 8, backgroundColor: 'rgba(196,196,196,0.2)', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },

  metricRow: { flexDirection: 'row', alignItems: 'center' },
  metricLead: { fontFamily: font.black, fontSize: 28, color: INK, letterSpacing: -0.8 },
  metricSub: { fontFamily: font.regular, fontSize: 12.5, color: colors.textDim, marginTop: 4, lineHeight: 18 },

  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: PINE, borderRadius: 16, paddingVertical: 15,
  },
  exportBtnTxt: { fontFamily: font.bold, fontSize: 15, color: '#fff' },
  footer: { fontFamily: font.regular, fontSize: 12, color: colors.textGhost, lineHeight: 18, marginTop: 12 },

  lockedTxt: { fontFamily: font.medium, fontSize: 15, color: colors.textDim, textAlign: 'center', marginTop: 16, lineHeight: 22 },
  lockedBack: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  lockedBackTxt: { fontFamily: font.semibold, fontSize: 14, color: PINE },
});
