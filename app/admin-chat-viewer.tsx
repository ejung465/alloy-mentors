import React, { useEffect, useState, useCallback } from 'react';
import {
  ActivityIndicator, Alert, Image, Modal, Pressable, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { canManageOrg } from '@/lib/roles';

const PINE = '#165B74';
const PINE_MID = '#2C7C96';
const INK = '#22271F';
const HAIRLINE = 'rgba(196,196,196,0.16)';

type Member = { id: string; full_name: string; role: string };
type IncidentReport = {
  id: string;
  reporter_id: string;
  reported_user_id: string;
  message_id: string | null;
  chat_snapshot: any;
  reason: string;
  status: string;
  action_taken: string | null;
  created_at: string;
};

export default function AdminChatViewerScreen() {
  const router = useRouter();
  const { profile, org } = useUser();

  const [tab, setTab] = useState<'reports' | 'browse'>('reports');
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [reports, setReports] = useState<IncidentReport[]>([]);

  // Browse-two-members state
  const [personA, setPersonA] = useState<Member | null>(null);
  const [personB, setPersonB] = useState<Member | null>(null);
  const [picking, setPicking] = useState<null | 'A' | 'B'>(null);
  const [pickSearch, setPickSearch] = useState('');
  const [thread, setThread] = useState<any[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);

  // Report detail
  const [activeReport, setActiveReport] = useState<IncidentReport | null>(null);
  const [resolving, setResolving] = useState(false);
  const [imageViewer, setImageViewer] = useState<string | null>(null);

  const nameOf = useCallback(
    (id: string) => members.find((m) => m.id === id)?.full_name ?? 'Member',
    [members]
  );

  const load = useCallback(async () => {
    if (!org?.id) return;
    const [{ data: users }, { data: reps }] = await Promise.all([
      supabase.from('users').select('id, full_name, role').eq('organization_id', org.id),
      supabase
        .from('chat_incident_reports')
        .select('*')
        .eq('organization_id', org.id)
        .order('created_at', { ascending: false }),
    ]);
    setMembers((users as Member[]) || []);
    setReports((reps as IncidentReport[]) || []);
    setLoading(false);
  }, [org?.id]);

  useEffect(() => {
    if (canManageOrg(profile?.role)) load();
    else setLoading(false);
  }, [load, profile?.role]);

  // Gate: leadership only.
  if (!canManageOrg(profile?.role)) {
    return (
      <SafeAreaView style={styles.screen}>
        <AuroraBackground />
        <View style={styles.lockedWrap}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.textFaint} />
          <Text style={styles.lockedTxt}>The chat safety console is for admins and leadership only.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.lockedBack}>
            <Text style={styles.lockedBackTxt}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const loadThread = useCallback(async (a: Member, b: Member) => {
    setThreadLoading(true);
    const { data } = await supabase
      .from('messages')
      .select('*')
      .is('group_chat_id', null)
      .or(
        `and(sender_id.eq.${a.id},receiver_id.eq.${b.id}),and(sender_id.eq.${b.id},receiver_id.eq.${a.id})`
      )
      .order('created_at', { ascending: true });
    setThread(data || []);
    setThreadLoading(false);
  }, []);

  useEffect(() => {
    if (personA && personB && personA.id !== personB.id) loadThread(personA, personB);
    else setThread([]);
  }, [personA, personB, loadThread]);

  const pending = reports.filter((r) => r.status === 'pending');
  const resolved = reports.filter((r) => r.status !== 'pending');

  const resolveReport = (action: 'suspend' | 'warning' | 'dismiss') => {
    if (!activeReport) return;
    const labels: Record<string, string> = {
      suspend: 'Confirm and suspend this account',
      warning: 'Confirm with a warning (no suspension)',
      dismiss: 'Dismiss as unfounded (removes the block)',
    };
    Alert.alert('Resolve report', `${labels[action]}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: action === 'dismiss' ? 'default' : 'destructive',
        onPress: async () => {
          setResolving(true);
          const { error } = await supabase.rpc('resolve_chat_incident_report', {
            p_report_id: activeReport.id,
            p_action: action,
          });
          setResolving(false);
          if (error) {
            Alert.alert('Could not resolve', error.message);
            return;
          }
          setActiveReport(null);
          await load();
        },
      },
    ]);
  };

  const filteredPick = members
    .filter((m) => (picking === 'A' ? m.id !== personB?.id : m.id !== personA?.id))
    .filter((m) => (pickSearch ? m.full_name?.toLowerCase().includes(pickSearch.toLowerCase()) : true));

  return (
    <SafeAreaView style={styles.screen}>
      <AuroraBackground />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={INK} />
        </TouchableOpacity>
        <View style={{ flex: 1, marginLeft: 8 }}>
          <Text style={styles.title}>Chat Safety</Text>
          <Text style={styles.subtitle}>{org?.name ?? 'Your organization'}</Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {(['reports', 'browse'] as const).map((t) => (
          <TouchableOpacity
            key={t}
            onPress={() => setTab(t)}
            style={[styles.tabBtn, tab === t && styles.tabBtnActive]}
            activeOpacity={0.85}
          >
            <Ionicons
              name={t === 'reports' ? 'flag-outline' : 'chatbubbles-outline'}
              size={15}
              color={tab === t ? PINE : 'rgba(34,39,31,0.4)'}
            />
            <Text style={[styles.tabLabel, tab === t && styles.tabLabelActive]}>
              {t === 'reports' ? `Reports${pending.length ? ` (${pending.length})` : ''}` : 'View DMs'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={PINE} /></View>
      ) : tab === 'reports' ? (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.sectionLabel}>PENDING</Text>
          {pending.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="shield-checkmark-outline" size={32} color="rgba(34,39,31,0.3)" />
              <Text style={styles.emptyTxt}>No pending incident reports.</Text>
            </View>
          ) : (
            pending.map((r) => (
              <TouchableOpacity key={r.id} style={styles.reportCard} activeOpacity={0.85} onPress={() => setActiveReport(r)}>
                <View style={styles.reportTop}>
                  <View style={styles.priorityDot} />
                  <Text style={styles.reportReason}>{r.reason}</Text>
                  <Ionicons name="chevron-forward" size={16} color="rgba(34,39,31,0.3)" />
                </View>
                <Text style={styles.reportMeta}>
                  {nameOf(r.reporter_id)} reported {nameOf(r.reported_user_id)}
                </Text>
                <Text style={styles.reportTime}>{new Date(r.created_at).toLocaleString()}</Text>
              </TouchableOpacity>
            ))
          )}

          {resolved.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 24 }]}>RESOLVED</Text>
              {resolved.map((r) => (
                <TouchableOpacity key={r.id} style={[styles.reportCard, { opacity: 0.72 }]} activeOpacity={0.85} onPress={() => setActiveReport(r)}>
                  <View style={styles.reportTop}>
                    <Text style={styles.reportReason}>{r.reason}</Text>
                    <View style={[styles.statusChip, chipStyle(r.status)]}>
                      <Text style={styles.statusChipTxt}>{r.action_taken ?? r.status}</Text>
                    </View>
                  </View>
                  <Text style={styles.reportMeta}>
                    {nameOf(r.reporter_id)} → {nameOf(r.reported_user_id)}
                  </Text>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      ) : (
        // ── Browse two members' DM thread ────────────────────────────────────
        <View style={{ flex: 1 }}>
          <View style={styles.pickRow}>
            <TouchableOpacity style={styles.pickBtn} onPress={() => { setPickSearch(''); setPicking('A'); }}>
              <Text style={styles.pickLabel}>Person A</Text>
              <Text style={styles.pickValue} numberOfLines={1}>{personA?.full_name ?? 'Choose…'}</Text>
            </TouchableOpacity>
            <Ionicons name="swap-horizontal" size={18} color="rgba(34,39,31,0.3)" />
            <TouchableOpacity style={styles.pickBtn} onPress={() => { setPickSearch(''); setPicking('B'); }}>
              <Text style={styles.pickLabel}>Person B</Text>
              <Text style={styles.pickValue} numberOfLines={1}>{personB?.full_name ?? 'Choose…'}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.readOnlyNote}>Read-only oversight view of a direct message thread.</Text>

          {threadLoading ? (
            <View style={styles.center}><ActivityIndicator color={PINE} /></View>
          ) : !personA || !personB ? (
            <View style={styles.emptyCard}>
              <Ionicons name="people-outline" size={32} color="rgba(34,39,31,0.3)" />
              <Text style={styles.emptyTxt}>Pick two members to view their conversation.</Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.threadScroll} showsVerticalScrollIndicator={false}>
              {thread.length === 0 ? (
                <Text style={styles.emptyTxt}>No messages between these two members.</Text>
              ) : (
                thread.map((m) => {
                  const fromA = m.sender_id === personA.id;
                  return (
                    <View key={m.id} style={[styles.viewerBubbleWrap, fromA ? { alignSelf: 'flex-start' } : { alignSelf: 'flex-end' }]}>
                      <Text style={[styles.viewerSender, !fromA && { textAlign: 'right' }]}>
                        {fromA ? personA.full_name : personB.full_name}
                      </Text>
                      <View style={[styles.viewerBubble, fromA ? styles.viewerBubbleA : styles.viewerBubbleB]}>
                        {m.deleted_at ? (
                          <Text style={styles.viewerDeleted}>message unsent</Text>
                        ) : (
                          <>
                            {m.image_url && (
                              <TouchableOpacity onPress={() => setImageViewer(m.image_url)}>
                                <Image source={{ uri: m.image_url }} style={styles.viewerImage} />
                              </TouchableOpacity>
                            )}
                            {!!m.content && (
                              <Text style={fromA ? styles.viewerTxtA : styles.viewerTxtB}>{m.content}</Text>
                            )}
                          </>
                        )}
                      </View>
                      <Text style={[styles.viewerTime, !fromA && { textAlign: 'right' }]}>
                        {new Date(m.created_at).toLocaleString()}{m.edited_at ? ' · edited' : ''}
                      </Text>
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}
        </View>
      )}

      {/* ── Member picker ──────────────────────────────────────────────────── */}
      <Modal visible={!!picking} transparent animationType="slide">
        <View style={styles.pickBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setPicking(null)} />
          <View style={styles.pickSheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Select {picking === 'A' ? 'Person A' : 'Person B'}</Text>
            <View style={styles.searchBar}>
              <Ionicons name="search" size={16} color="rgba(34,39,31,0.4)" />
              <TextInput
                style={styles.searchInput}
                placeholder="Search members…"
                placeholderTextColor="rgba(34,39,31,0.4)"
                value={pickSearch}
                onChangeText={setPickSearch}
                autoFocus
              />
            </View>
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {filteredPick.map((m) => (
                <TouchableOpacity
                  key={m.id}
                  style={styles.pickMemberRow}
                  onPress={() => {
                    if (picking === 'A') setPersonA(m);
                    else setPersonB(m);
                    setPicking(null);
                  }}
                >
                  <View style={styles.avatar}><Text style={styles.avatarTxt}>{m.full_name?.charAt(0).toUpperCase()}</Text></View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.memberName}>{m.full_name}</Text>
                    <Text style={styles.memberRole}>{m.role}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Report detail + resolution ─────────────────────────────────────── */}
      <Modal visible={!!activeReport} transparent animationType="slide">
        <View style={styles.pickBackdrop}>
          <Pressable style={{ flex: 1 }} onPress={() => setActiveReport(null)} />
          <View style={[styles.pickSheet, { maxHeight: '88%' }]}>
            <View style={styles.sheetHandle} />
            {activeReport && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.sheetTitle}>{activeReport.reason}</Text>
                <Text style={styles.reportMeta}>
                  {nameOf(activeReport.reporter_id)} reported {nameOf(activeReport.reported_user_id)}
                </Text>
                <Text style={styles.reportTime}>{new Date(activeReport.created_at).toLocaleString()}</Text>

                <Text style={[styles.sectionLabel, { marginTop: 18 }]}>CONVERSATION SNAPSHOT</Text>
                <View style={styles.snapshotBox}>
                  {Array.isArray(activeReport.chat_snapshot) && activeReport.chat_snapshot.length > 0 ? (
                    activeReport.chat_snapshot.map((s: any, i: number) => (
                      <View key={i} style={styles.snapshotRow}>
                        <Text style={styles.snapshotSender}>{nameOf(s.sender_id)}</Text>
                        <Text style={styles.snapshotTxt}>{s.content || (s.image_url ? '[image]' : '')}</Text>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.emptyTxt}>No snapshot captured.</Text>
                  )}
                </View>

                {activeReport.status === 'pending' ? (
                  <View style={{ marginTop: 20, gap: 10 }}>
                    <TouchableOpacity style={[styles.resolveBtn, { backgroundColor: '#B15A4E' }]} disabled={resolving} onPress={() => resolveReport('suspend')}>
                      <Ionicons name="ban-outline" size={17} color="#F4F6F6" />
                      <Text style={styles.resolveTxt}>Confirm — Suspend account</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.resolveBtn, { backgroundColor: '#B08A3E' }]} disabled={resolving} onPress={() => resolveReport('warning')}>
                      <Ionicons name="warning-outline" size={17} color="#F4F6F6" />
                      <Text style={styles.resolveTxt}>Confirm — Warning only</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.resolveBtn, { backgroundColor: 'rgba(196,196,196,0.22)' }]} disabled={resolving} onPress={() => resolveReport('dismiss')}>
                      <Ionicons name="close-circle-outline" size={17} color={INK} />
                      <Text style={[styles.resolveTxt, { color: INK }]}>Dismiss — Unfounded</Text>
                    </TouchableOpacity>
                    <Text style={styles.resolveNote}>
                      Suspend and Warning keep the reporter's block in place. Dismiss removes it.
                    </Text>
                  </View>
                ) : (
                  <View style={[styles.statusChip, chipStyle(activeReport.status), { alignSelf: 'flex-start', marginTop: 18 }]}>
                    <Text style={styles.statusChipTxt}>Resolved · {activeReport.action_taken ?? activeReport.status}</Text>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Full-screen image viewer ───────────────────────────────────────── */}
      <Modal visible={!!imageViewer} transparent animationType="fade" onRequestClose={() => setImageViewer(null)}>
        <Pressable style={styles.imageScrim} onPress={() => setImageViewer(null)}>
          {imageViewer && <Image source={{ uri: imageViewer }} style={styles.fullImage} resizeMode="contain" />}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function chipStyle(status: string) {
  if (status === 'confirmed') return { backgroundColor: 'rgba(177,90,78,0.16)' };
  if (status === 'dismissed') return { backgroundColor: 'rgba(94,116,136,0.16)' };
  if (status === 'cancelled') return { backgroundColor: 'rgba(94,116,136,0.16)' };
  return { backgroundColor: 'rgba(44,124,150,0.16)' };
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lockedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  lockedTxt: { fontFamily: 'Inter-Medium', fontSize: 15, color: 'rgba(34,39,31,0.6)', textAlign: 'center', marginTop: 14, lineHeight: 22 },
  lockedBack: { marginTop: 20, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(196,196,196,0.2)' },
  lockedBackTxt: { fontFamily: 'Inter-SemiBold', fontSize: 14, color: INK },

  header: { paddingTop: 8, paddingBottom: 14, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  iconBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(196,196,196,0.18)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.26)' },
  title: { fontFamily: 'Inter-Black', fontSize: 24, color: INK, letterSpacing: -0.5 },
  subtitle: { fontFamily: 'Inter-Regular', fontSize: 13, color: 'rgba(34,39,31,0.45)', marginTop: 1 },

  tabRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 8 },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 14, borderWidth: 1, borderColor: HAIRLINE, backgroundColor: 'rgba(196,196,196,0.06)' },
  tabBtnActive: { borderColor: 'rgba(44,124,150,0.4)', backgroundColor: 'rgba(44,124,150,0.1)' },
  tabLabel: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: 'rgba(34,39,31,0.4)' },
  tabLabelActive: { color: PINE },

  scroll: { padding: 16, paddingBottom: 60 },
  sectionLabel: { fontFamily: 'Inter-SemiBold', fontSize: 11, color: 'rgba(34,39,31,0.3)', letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 },
  emptyCard: { alignItems: 'center', padding: 40, gap: 10 },
  emptyTxt: { fontFamily: 'Inter-Medium', fontSize: 13.5, color: 'rgba(34,39,31,0.45)', textAlign: 'center' },

  reportCard: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: HAIRLINE, padding: 14, marginBottom: 10 },
  reportTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  priorityDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#B15A4E' },
  reportReason: { flex: 1, fontFamily: 'Inter-SemiBold', fontSize: 15, color: INK },
  reportMeta: { fontFamily: 'Inter-Regular', fontSize: 13, color: 'rgba(34,39,31,0.55)', marginTop: 6 },
  reportTime: { fontFamily: 'Inter-Regular', fontSize: 11.5, color: 'rgba(34,39,31,0.35)', marginTop: 3 },
  statusChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10 },
  statusChipTxt: { fontFamily: 'Inter-SemiBold', fontSize: 11, color: INK, textTransform: 'capitalize' },

  // Browse
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginTop: 4 },
  pickBtn: { flex: 1, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: HAIRLINE, paddingHorizontal: 14, paddingVertical: 10 },
  pickLabel: { fontFamily: 'Inter-Medium', fontSize: 10.5, color: 'rgba(34,39,31,0.4)', textTransform: 'uppercase', letterSpacing: 0.8 },
  pickValue: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: INK, marginTop: 2 },
  readOnlyNote: { fontFamily: 'Inter-Regular', fontSize: 12, color: 'rgba(34,39,31,0.4)', paddingHorizontal: 16, marginTop: 10, marginBottom: 4 },
  threadScroll: { padding: 16, paddingBottom: 40 },

  viewerBubbleWrap: { maxWidth: '82%', marginBottom: 12 },
  viewerSender: { fontFamily: 'Inter-Bold', fontSize: 11, color: PINE_MID, marginBottom: 3, marginHorizontal: 4 },
  viewerBubble: { borderRadius: 16, paddingVertical: 9, paddingHorizontal: 13 },
  viewerBubbleA: { backgroundColor: '#F7F8F8', borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderBottomLeftRadius: 5 },
  viewerBubbleB: { backgroundColor: '#165B74', borderBottomRightRadius: 5 },
  viewerTxtA: { fontFamily: 'Inter-Regular', fontSize: 14.5, color: INK, lineHeight: 20 },
  viewerTxtB: { fontFamily: 'Inter-Regular', fontSize: 14.5, color: '#F4F6F6', lineHeight: 20 },
  viewerDeleted: { fontFamily: 'Inter-Regular', fontSize: 13, fontStyle: 'italic', color: 'rgba(34,39,31,0.4)' },
  viewerImage: { width: 180, height: 180, borderRadius: 10, marginBottom: 6, backgroundColor: 'rgba(196,196,196,0.2)' },
  viewerTime: { fontFamily: 'Inter-Regular', fontSize: 10.5, color: 'rgba(34,39,31,0.35)', marginTop: 3, marginHorizontal: 4 },

  // Picker sheet
  pickBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(30,36,28,0.4)' },
  pickSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20, paddingBottom: 40 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(196,196,196,0.3)', alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontFamily: 'Inter-Bold', fontSize: 19, color: INK, marginBottom: 6 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(196,196,196,0.16)', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(196,196,196,0.26)', paddingHorizontal: 14, paddingVertical: 11, gap: 10, marginTop: 8, marginBottom: 8 },
  searchInput: { flex: 1, fontFamily: 'Inter-Regular', fontSize: 15, color: INK },
  pickMemberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(44,124,150,0.12)', borderWidth: 1, borderColor: 'rgba(44,124,150,0.25)', alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: 'Inter-Bold', fontSize: 17, color: PINE_MID },
  memberName: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: INK },
  memberRole: { fontFamily: 'Inter-Regular', fontSize: 12.5, color: 'rgba(34,39,31,0.45)', textTransform: 'capitalize', marginTop: 1 },

  // Snapshot + resolve
  snapshotBox: { backgroundColor: '#F7F8F8', borderRadius: 14, borderWidth: 1, borderColor: HAIRLINE, padding: 12, gap: 8 },
  snapshotRow: { gap: 1 },
  snapshotSender: { fontFamily: 'Inter-Bold', fontSize: 11.5, color: PINE_MID },
  snapshotTxt: { fontFamily: 'Inter-Regular', fontSize: 14, color: INK, lineHeight: 19 },
  resolveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 14 },
  resolveTxt: { fontFamily: 'Inter-Bold', fontSize: 14.5, color: '#F4F6F6' },
  resolveNote: { fontFamily: 'Inter-Regular', fontSize: 12, color: 'rgba(34,39,31,0.45)', textAlign: 'center', marginTop: 4, lineHeight: 17 },

  imageScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  fullImage: { width: '100%', height: '80%' },
});
