import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { canManageOrg } from '@/lib/roles';

const PINE = '#165B74';
const PINE_MID = '#2C7C96';
const INK = '#22271F';

type AuditRow = {
  id: string;
  organization_id: string | null;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

/** Pick an Ionicon that hints at the action namespace (best-effort). */
function iconForAction(action: string): string {
  const a = action.toLowerCase();
  if (a.startsWith('role')) return 'swap-horizontal-outline';
  if (a.startsWith('hours')) return 'time-outline';
  if (a.startsWith('student')) return 'school-outline';
  if (a.includes('delete') || a.includes('remove')) return 'trash-outline';
  if (a.includes('create') || a.includes('add')) return 'add-circle-outline';
  if (a.includes('view')) return 'eye-outline';
  return 'ellipse-outline';
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString() + ' · ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** RFC-4180-ish CSV field escaping. */
function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export default function AuditLogScreen() {
  const router = useRouter();
  const { profile, org } = useUser();
  const canView = canManageOrg(profile?.role);

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchLog = useCallback(async () => {
    if (!org?.id) { setLoading(false); return; }
    const { data } = await supabase
      .from('audit_log')
      .select('*')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: false })
      .limit(500);
    const list = (data as AuditRow[]) ?? [];
    setRows(list);

    // Resolve actor names in a single follow-up query.
    const actorIds = [...new Set(list.map((r) => r.actor_id).filter(Boolean))] as string[];
    if (actorIds.length) {
      const { data: users } = await supabase.from('users').select('id, full_name').in('id', actorIds);
      const map: Record<string, string> = {};
      (users as { id: string; full_name: string }[] | null)?.forEach((u) => { map[u.id] = u.full_name; });
      setNames(map);
    }
    setLoading(false);
  }, [org?.id]);

  useEffect(() => { if (canView) fetchLog(); else setLoading(false); }, [canView, fetchLog]);

  const onRefresh = async () => { setRefreshing(true); await fetchLog(); setRefreshing(false); };

  const exportCsv = async () => {
    if (rows.length === 0) { Alert.alert('Nothing to export', 'The audit log is empty.'); return; }
    setExporting(true);
    try {
      const header = ['Timestamp', 'Actor', 'Action', 'Target type', 'Target id', 'Details'];
      const lines = rows.map((r) =>
        [
          r.created_at,
          names[r.actor_id ?? ''] ?? r.actor_id ?? '',
          r.action,
          r.target_type ?? '',
          r.target_id ?? '',
          r.details ? JSON.stringify(r.details) : '',
        ].map(csvCell).join(',')
      );
      const csv = [header.map(csvCell).join(','), ...lines].join('\n');

      const fileUri = `${FileSystem.cacheDirectory}audit-log-${Date.now()}.csv`;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, { UTI: 'public.comma-separated-values-text', mimeType: 'text/csv' });
      } else {
        Alert.alert('Export ready', `Saved to ${fileUri}`);
      }
    } catch (e: any) {
      Alert.alert('Export failed', e?.message ?? 'Please try again.');
    } finally {
      setExporting(false);
    }
  };

  // ── Leadership gate ───────────────────────────────────────────────────────
  if (profile && !canView) {
    return (
      <SafeAreaView style={styles.screen}>
        <AuroraBackground variant="warm" />
        <View style={styles.centered}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>Restricted</Text>
          <Text style={styles.emptyBody}>The audit log is available to organization leadership only.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.backPill}>
            <Ionicons name="chevron-back" size={16} color={INK} />
            <Text style={styles.backPillTxt}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <AuroraBackground variant="warm" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={20} color={INK} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.eyebrow}>OVERSIGHT</Text>
          <Text style={styles.title}>Audit Log</Text>
        </View>
        <TouchableOpacity
          onPress={exportCsv}
          style={[styles.exportBtn, (exporting || rows.length === 0) && { opacity: 0.5 }]}
          disabled={exporting || rows.length === 0}
          activeOpacity={0.85}
        >
          {exporting ? <ActivityIndicator color={PINE} size="small" /> : <Ionicons name="download-outline" size={16} color={PINE} />}
          <Text style={styles.exportTxt}>CSV</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={PINE} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={INK} />}
        >
          {rows.length === 0 ? (
            <View style={styles.centered}>
              <Ionicons name="receipt-outline" size={40} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>No activity logged</Text>
              <Text style={styles.emptyBody}>Actions like role changes and record edits will appear here once they’re recorded.</Text>
            </View>
          ) : (
            rows.map((r) => (
              <View key={r.id} style={styles.card}>
                <View style={styles.actIcon}>
                  <Ionicons name={iconForAction(r.action) as any} size={17} color={PINE} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.action}>{r.action}</Text>
                  <Text style={styles.actor}>
                    {names[r.actor_id ?? ''] ?? 'Unknown actor'}
                    {r.target_type ? <Text style={styles.target}>  ·  {r.target_type}</Text> : null}
                  </Text>
                  {r.details && Object.keys(r.details).length > 0 ? (
                    <Text style={styles.details} numberOfLines={3}>{JSON.stringify(r.details)}</Text>
                  ) : null}
                  <Text style={styles.when}>{fmtWhen(r.created_at)}</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: font.bold, fontSize: 11, color: PINE_MID, letterSpacing: 2.5 },
  title: { fontFamily: font.black, fontSize: 28, color: PINE, letterSpacing: -1, marginTop: 2 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, borderRadius: 12, paddingHorizontal: 12, height: 38 },
  exportTxt: { fontFamily: font.bold, fontSize: 13, color: PINE },

  scroll: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 60, flexGrow: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingVertical: 80 },
  emptyTitle: { fontFamily: font.bold, fontSize: 17, color: INK, marginTop: 14 },
  emptyBody: { fontFamily: font.regular, fontSize: 13.5, color: colors.textDim, textAlign: 'center', marginTop: 6, lineHeight: 19 },
  backPill: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 20, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong },
  backPillTxt: { fontFamily: font.semibold, fontSize: 14, color: INK },

  card: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: 14, padding: 13, marginBottom: 9 },
  actIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: 'rgba(22,91,116,0.10)', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  action: { fontFamily: font.semibold, fontSize: 14.5, color: INK },
  actor: { fontFamily: font.regular, fontSize: 12.5, color: colors.textDim, marginTop: 2 },
  target: { fontFamily: font.medium, color: PINE_MID },
  details: { fontFamily: font.regular, fontSize: 11.5, color: colors.textFaint, marginTop: 5, lineHeight: 16 },
  when: { fontFamily: font.regular, fontSize: 11, color: colors.textFaint, marginTop: 6 },
});
