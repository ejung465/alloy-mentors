import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, ScrollView, RefreshControl, TouchableOpacity,
  Modal, StyleSheet, Animated, Pressable, Linking, Platform
} from 'react-native';
import { GlassCard } from '@/components/ui/GlassCard';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { colors } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { canManageOrg, canCreateEvents } from '@/lib/roles';
import AnnouncementBanner from '@/components/AnnouncementBanner';
import CreateAnnouncementModal from '@/components/CreateAnnouncementModal';
import { useUser } from '@/contexts/UserContext';
import { myStudentsWithGoals, type StudentWithGoal } from '@/lib/progress';
import { featureEnabled } from '@/lib/features';
import { Image } from 'expo-image';
import {
  fetchSessionsOrdered,
  formatSessionLongDate,
  formatSessionTimeRange,
  getMyRsvp,
  setMyRsvp,
  type SessionListItem,
} from '@/lib/sessions';

// ── Palette (cream & pine, editorial) ────────────────────────────────────────
const PINE_DEEP = '#2C4A39';   // hero block
const PINE      = '#375946';   // primary accent
const PINE_MID  = '#3E6A52';
const CREAM     = '#F5EFE3';   // text on pine
const CLAY      = '#B15A4E';
const INK       = '#22271F';

function openMaps(location: string) {
  const url = Platform.OS === 'ios'
    ? `maps://?daddr=${encodeURIComponent(location)}`
    : `https://maps.google.com/?daddr=${encodeURIComponent(location)}`;
  Linking.canOpenURL(url).then(ok => { if (ok) Linking.openURL(url); });
}

function AnimPress({ children, onPress, style }: any) {
  const s = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPressIn={() => Animated.spring(s, { toValue: 0.96, useNativeDriver: true, tension: 300, friction: 12 }).start()}
      onPressOut={() => Animated.spring(s, { toValue: 1,    useNativeDriver: true, tension: 300, friction: 12 }).start()}
      onPress={onPress} style={style}
    >
      <Animated.View style={{ transform: [{ scale: s }], flex: 1 }}>{children}</Animated.View>
    </Pressable>
  );
}

function OverlayModal({ visible, onClose, title, children }: any) {
  return (
    <Modal visible={visible} transparent animationType="fade">
      <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.scrim }]} onPress={onClose}>
        <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }} pointerEvents="box-none">
          <Pressable onPress={(e) => e.stopPropagation()}>
          <GlassCard>
            <View style={styles.overlayHeader}>
              <Text style={styles.overlayTitle}>{title}</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color={INK} />
              </TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 460 }} showsVerticalScrollIndicator={false}>
              {children}
            </ScrollView>
          </GlassCard>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export default function DashboardScreen() {
  const router = useRouter();
  const { compose } = useLocalSearchParams<{ compose?: string }>();
  const { user, profile, org } = useUser();
  const memberNoun = org?.memberNoun || 'Tutor';
  const isStudent = profile?.role === 'student';
  const hasHours = featureEnabled(org, 'hours');
  const hasCheckin = featureEnabled(org, 'checkin');
  const hasProgress = featureEnabled(org, 'progress');

  const [totalHours, setTotalHours]     = useState(0);
  const [studentCount, setStudentCount] = useState(0);
  const [hoursHistory, setHoursHistory] = useState<any[]>([]);
  const [sessions, setSessions]         = useState<SessionListItem[]>([]);
  const [refreshing, setRefreshing]     = useState(false);
  const [adminMode, setAdminMode]       = useState(false);

  const [sessionsAttended, setSessionsAttended] = useState(0);
  const [hoursThisMonth, setHoursThisMonth]     = useState(0);
  const [myStudents, setMyStudents]             = useState<StudentWithGoal[]>([]);
  const [myLinked, setMyLinked]                 = useState<{ id: string; full_name: string } | null>(null);

  const [orgHours, setOrgHours]     = useState(0);
  const [orgMembers, setOrgMembers] = useState(0);
  const [pendingCount, setPending]  = useState(0);

  const [showHoursModal, setShowHours]       = useState(false);
  const [sessionDetail, setSessionDetail]    = useState<SessionListItem | null>(null);
  const [showOrgHours, setShowOrgHours]      = useState(false);
  const [showOrgMembers, setShowOrgMembers]  = useState(false);
  const [rsvpStatus, setRsvpStatus]          = useState<'none' | 'going' | 'not_going'>('none');
  const [showCreateModal, setShowCreateModal] = useState(false);

  const fetchData = useCallback(async () => {
    if (!user) return;
    const { data: hData } = await supabase.from('hours_logs').select('*').eq('mentor_id', user.id);
    if (hData) {
      setHoursHistory(hData);
      setTotalHours(hData.reduce((a, c) => a + Number(c.hours), 0));
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const monthSum = hData
        .filter((h) => new Date(h.date_worked ?? h.created_at).getTime() >= monthStart)
        .reduce((a, c) => a + Number(c.hours), 0);
      setHoursThisMonth(monthSum);
    }
    const { data: pairRows } = await supabase
      .from('session_attendance')
      .select('student_id')
      .eq('kind', 'student')
      .eq('paired_volunteer_id', user.id);
    setStudentCount(new Set((pairRows || []).map((r: any) => r.student_id)).size);

    const { count: attended } = await supabase
      .from('session_attendance')
      .select('*', { count: 'exact', head: true })
      .eq('kind', 'volunteer')
      .eq('volunteer_id', user.id);
    setSessionsAttended(attended || 0);

    if (profile?.role === 'student') {
      const { data: linked } = await supabase.from('students').select('id, full_name').eq('user_id', user.id).maybeSingle();
      setMyLinked(linked ?? null);
    } else {
      setMyStudents(await myStudentsWithGoals(user.id));
    }

    if (canManageOrg(profile?.role)) {
      const orgId = profile?.organization_id;
      let logsQ = supabase.from('hours_logs').select('hours, status');
      if (orgId) logsQ = logsQ.eq('organization_id', orgId);
      const { data: allLogs } = await logsQ;
      const approved = (allLogs || []).filter(l => l.status === 'approved');
      setOrgHours(approved.reduce((a, l) => a + Number(l.hours), 0));
      setPending((allLogs || []).filter(l => l.status === 'pending').length);
      let usersQ = supabase.from('users').select('*', { count: 'exact', head: true });
      if (orgId) usersQ = usersQ.eq('organization_id', orgId);
      const { count: mc } = await usersQ;
      setOrgMembers(mc || 0);
    }
  }, [user, profile?.role, profile?.organization_id]);

  const loadSessions = useCallback(async () => {
    setSessions(await fetchSessionsOrdered());
  }, []);

  useEffect(() => { void fetchData(); }, [fetchData]);
  useEffect(() => { void loadSessions(); }, [loadSessions]);

  useEffect(() => {
    if (compose === '1' && canCreateEvents(profile?.role)) {
      setShowCreateModal(true);
      router.setParams({ compose: undefined });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compose, profile?.role]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchData(), loadSessions()]);
    setRefreshing(false);
  };

  const handledPairings = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel('my_pairings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'session_attendance', filter: `paired_volunteer_id=eq.${user.id}` },
        (payload) => {
          const row = payload.new as any;
          if (!row?.id || row.paired_volunteer_id !== user.id || handledPairings.current.has(row.id)) return;
          handledPairings.current.add(row.id);
          router.push('/my-pairing');
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user?.id]);

  const nextUpcomingSession = useMemo(() => {
    const now = Date.now();
    return sessions.find((s) => s.endMs >= now) ?? null;
  }, [sessions]);

  useEffect(() => {
    (async () => {
      if (user && nextUpcomingSession) {
        setRsvpStatus(await getMyRsvp(nextUpcomingSession.id, user.id));
      } else {
        setRsvpStatus('none');
      }
    })();
  }, [user, nextUpcomingSession?.id]);

  const persistRsvp = async (status: 'going' | 'not_going') => {
    const next = rsvpStatus === status ? 'none' : status;
    setRsvpStatus(next as any);
    if (user && nextUpcomingSession && next !== 'none') {
      const { error } = await setMyRsvp(nextUpcomingSession.id, user.id, next as any);
      if (error) console.warn('[rsvp] save failed:', error.message);
    }
  };

  const toggleAdminMode = () => setAdminMode((v) => !v);

  const firstName = profile?.full_name ? profile.full_name.split(' ')[0] : memberNoun;
  const isAdmin = canManageOrg(profile?.role);

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning,';
    if (h < 18) return 'Good afternoon,';
    return 'Good evening,';
  };

  const dateEyebrow = `${org?.name ? org.name.toUpperCase() + ' · ' : ''}${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}`;

  const sessionIsToday = nextUpcomingSession
    ? startOfDay(new Date(nextUpcomingSession.start_time)) === startOfDay(new Date())
    : false;

  const relWhen = (iso: string) => {
    const days = Math.round((startOfDay(new Date(iso)) - startOfDay(new Date())) / 86400000);
    if (days <= 0) return 'TODAY';
    if (days === 1) return 'TOMORROW';
    if (days < 7) return `IN ${days} DAYS`;
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase();
  };

  const subline = () => {
    if (adminMode) return `Overseeing ${org?.name || 'your organization'}.`;
    if (sessionIsToday) return `You have a session today${studentCount ? ` — ${studentCount} ${studentCount === 1 ? 'student is' : 'students are'} counting on you.` : '.'}`;
    if (totalHours === 0) return 'Welcome aboard. Log your first hour to get rolling.';
    return `You're ${totalHours} ${totalHours === 1 ? 'hour' : 'hours'} into the season. Keep going.`;
  };

  // Real activity — hours bucketed into the last 6 weeks.
  const weeklyBars = useMemo(() => {
    const weeks = 6;
    const now = Date.now();
    const buckets = new Array(weeks).fill(0);
    hoursHistory.forEach((h) => {
      const t = new Date(h.date_worked ?? h.created_at).getTime();
      const wk = Math.floor((now - t) / (7 * 86400000));
      if (wk >= 0 && wk < weeks) buckets[weeks - 1 - wk] += Number(h.hours) || 0;
    });
    return buckets;
  }, [hoursHistory]);
  const barMax = Math.max(...weeklyBars, 1);

  const GOAL = 40;
  const goalPct = Math.min((totalHours / GOAL) * 100, 100);

  return (
    <View style={styles.screen}>
      <AuroraBackground />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={INK} />}
      >
        {/* ── Masthead ─────────────────────────────────── */}
        <View style={styles.mastRow}>
          <Text style={styles.eyebrow}>{dateEyebrow}</Text>
          {isAdmin && (
            <TouchableOpacity onPress={toggleAdminMode} activeOpacity={0.85}
              style={[styles.adminBadge, adminMode && styles.adminBadgeActive]}>
              <Ionicons name="shield-checkmark" size={12} color={adminMode ? CREAM : PINE_MID} />
              <Text style={[styles.adminBadgeText, adminMode && { color: CREAM }]}>
                {adminMode ? 'MY VIEW' : 'ADMIN'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.hello}>{greeting()}</Text>
        <Text style={styles.name}>{adminMode ? `${org?.name || 'Dashboard'}.` : `${firstName}.`}</Text>
        <Text style={styles.subline}>{subline()}</Text>

        <View style={{ height: 22 }} />
        <AnnouncementBanner />

        {adminMode ? (
          /* ══ ADMIN OVERVIEW ══════════════════════════════ */
          <>
            {/* Hero — season impact (hours module) */}
            {hasHours && (
            <View style={[styles.heroPine, { marginBottom: 24 }]}>
              <View style={styles.heroBlob} />
              <Text style={styles.heroEyebrow}>SEASON IMPACT</Text>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 6 }}>
                <AnimatedCounter value={orgHours} style={styles.heroBigNum} />
                <Text style={styles.heroBigUnit}>hours</Text>
              </View>
              <Text style={styles.heroSub}>Approved {memberNoun.toLowerCase()} hours across {org?.name || 'your org'}.</Text>
              <TouchableOpacity onPress={() => setShowOrgHours(true)} style={styles.heroGhostBtn} activeOpacity={0.85}>
                <Text style={styles.heroGhostTxt}>View breakdown</Text>
                <Ionicons name="arrow-forward" size={15} color={CREAM} />
              </TouchableOpacity>
            </View>
            )}

            <Text style={styles.sectionTitle}>Manage</Text>
            <AnimPress onPress={() => setShowOrgMembers(true)} style={{ marginBottom: 12 }}>
              <ListCard icon="people-outline" tint={PINE_MID} value={orgMembers} label="Members" sub={`${memberNoun}s, students & admins`} />
            </AnimPress>
            {hasHours && (
              <AnimPress onPress={() => router.push('/admin')} style={{ marginBottom: 12 }}>
                <ListCard icon="time-outline" tint="#B08A3E" value={pendingCount} label="Pending reviews"
                  sub="Open the Director Panel" badge={pendingCount > 0 ? pendingCount : undefined} />
              </AnimPress>
            )}
            <AnimPress onPress={() => setShowCreateModal(true)} style={{ marginBottom: 24 }}>
              <View style={[styles.listCard, { borderColor: 'rgba(62,106,82,0.30)', backgroundColor: 'rgba(62,106,82,0.07)' }]}>
                <View style={[styles.listIcon, { backgroundColor: 'rgba(62,106,82,0.15)', borderColor: 'rgba(62,106,82,0.3)' }]}>
                  <Ionicons name="megaphone-outline" size={20} color={PINE_MID} />
                </View>
                <View style={{ flex: 1, marginLeft: 14 }}>
                  <Text style={[styles.listLabel, { color: PINE_MID }]}>Broadcast announcement</Text>
                  <Text style={styles.listSub}>Post to everyone in {org?.name || 'your org'}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="rgba(62,106,82,0.4)" />
              </View>
            </AnimPress>
          </>
        ) : (
          /* ══ PERSONAL ════════════════════════════════════ */
          <>
            {/* Hero — next session (the cover story) */}
            {nextUpcomingSession ? (
              <AnimPress onPress={() => setSessionDetail(nextUpcomingSession)} style={{ marginBottom: 24 }}>
                <View style={styles.heroPine}>
                  <View style={styles.heroBlob} />
                  <View style={styles.heroTopRow}>
                    <Text style={styles.heroEyebrow}>NEXT SESSION</Text>
                    <View style={[styles.whenChip, sessionIsToday && { backgroundColor: CREAM }]}>
                      <Text style={[styles.whenChipTxt, sessionIsToday && { color: PINE_DEEP }]}>
                        {relWhen(nextUpcomingSession.start_time)}
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.heroTitle} numberOfLines={2}>{nextUpcomingSession.title}</Text>

                  <View style={styles.heroMetaRow}>
                    <Ionicons name="time-outline" size={14} color="rgba(245,239,227,0.7)" />
                    <Text style={styles.heroMetaTxt}>{nextUpcomingSession.time}</Text>
                    {nextUpcomingSession.location ? (
                      <>
                        <Text style={styles.heroMetaDot}>·</Text>
                        <Ionicons name="location-outline" size={14} color="rgba(245,239,227,0.7)" />
                        <Text style={styles.heroMetaTxt} numberOfLines={1}>{nextUpcomingSession.location}</Text>
                      </>
                    ) : null}
                  </View>

                  {/* Inline RSVP */}
                  <View style={styles.rsvpRow}>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => persistRsvp('going')}
                      style={[styles.rsvpPill, rsvpStatus === 'going' && styles.rsvpPillGoing]}
                    >
                      <Ionicons name="checkmark-circle" size={16}
                        color={rsvpStatus === 'going' ? PINE_DEEP : 'rgba(245,239,227,0.85)'} />
                      <Text style={[styles.rsvpPillTxt, rsvpStatus === 'going' && { color: PINE_DEEP }]}>I'm going</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => persistRsvp('not_going')}
                      style={[styles.rsvpPill, rsvpStatus === 'not_going' && styles.rsvpPillNo]}
                    >
                      <Text style={[styles.rsvpPillTxt, rsvpStatus === 'not_going' && { color: CREAM }]}>Can't make it</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </AnimPress>
            ) : (
              <View style={[styles.heroPine, { marginBottom: 24 }]}>
                <View style={styles.heroBlob} />
                <Text style={styles.heroEyebrow}>NEXT SESSION</Text>
                <Text style={[styles.heroTitle, { marginTop: 8 }]}>Nothing on the calendar yet.</Text>
                <Text style={styles.heroSub}>New sessions will show up here the moment they're scheduled.</Text>
                <TouchableOpacity onPress={() => router.push('/(tabs)/calendar')} style={styles.heroGhostBtn} activeOpacity={0.85}>
                  <Text style={styles.heroGhostTxt}>Open schedule</Text>
                  <Ionicons name="arrow-forward" size={15} color={CREAM} />
                </TouchableOpacity>
              </View>
            )}

            {/* Shortcuts — quick actions right under the hero, gated by org modules */}
            <Text style={styles.sectionTitle}>Shortcuts</Text>
            <View style={styles.chipRow}>
              {!isStudent && hasHours && (
                <AnimPress style={{ flex: 1 }} onPress={() => router.push('/modal')}>
                  <View style={[styles.chip, styles.chipPrimary]}>
                    <Ionicons name="time-outline" size={19} color={CREAM} />
                    <Text style={[styles.chipLabel, { color: CREAM }]}>Log hours</Text>
                  </View>
                </AnimPress>
              )}
              {!isStudent && hasCheckin && (
                <AnimPress style={{ flex: 1 }} onPress={() => router.push('/my-qr')}>
                  <View style={styles.chip}>
                    <Ionicons name="qr-code-outline" size={19} color={PINE} />
                    <Text style={styles.chipLabel}>My QR</Text>
                  </View>
                </AnimPress>
              )}
              {isStudent && myLinked && hasProgress && (
                <AnimPress style={{ flex: 1 }} onPress={() => router.push(`/student/${myLinked.id}`)}>
                  <View style={[styles.chip, styles.chipPrimary]}>
                    <Ionicons name="trending-up-outline" size={19} color={CREAM} />
                    <Text style={[styles.chipLabel, { color: CREAM }]}>My progress</Text>
                  </View>
                </AnimPress>
              )}
              <AnimPress style={{ flex: 1 }} onPress={() => router.push('/(tabs)/calendar')}>
                <View style={styles.chip}>
                  <Ionicons name="calendar-outline" size={19} color={PINE} />
                  <Text style={styles.chipLabel}>Schedule</Text>
                </View>
              </AnimPress>
            </View>

            {/* Student without a linked roster profile yet */}
            {isStudent && !myLinked && (
              <View style={styles.linkNotice}>
                <Ionicons name="link-outline" size={16} color={PINE_MID} />
                <Text style={styles.linkNoticeTxt}>
                  Your progress will appear once a coordinator links your account to your {org?.studentNoun?.toLowerCase() || 'student'} profile.
                </Text>
              </View>
            )}

            {/* Your students — the heart of the app, one tap from progress */}
            {!isStudent && hasProgress && myStudents.length > 0 && (
              <>
                <Text style={styles.sectionTitle}>Your students</Text>
                <View style={{ marginBottom: 24, gap: 10 }}>
                  {myStudents.map(({ student, goal }) => {
                    const initials = student.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
                    const pct = goal ? Math.round((goal.completed_checkpoints / goal.target_checkpoints) * 100) : 0;
                    return (
                      <AnimPress key={student.id} onPress={() => router.push(`/student/${student.id}`)}>
                        <View style={styles.studentRow}>
                          {student.photo_url ? (
                            <Image source={{ uri: student.photo_url }} style={styles.studentAvatar} contentFit="cover" />
                          ) : (
                            <View style={styles.studentAvatar}><Text style={styles.studentAvatarTxt}>{initials || '?'}</Text></View>
                          )}
                          <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={styles.studentName}>{student.full_name}</Text>
                            {goal ? (
                              <>
                                <Text style={styles.studentGoal} numberOfLines={1}>{goal.title}</Text>
                                <View style={styles.studentTrack}><View style={[styles.studentFill, { width: `${Math.max(pct, 4)}%` }]} /></View>
                              </>
                            ) : (
                              <Text style={styles.studentGoalMuted}>No goal set yet</Text>
                            )}
                          </View>
                          <Ionicons name="chevron-forward" size={16} color="rgba(34,39,31,0.3)" />
                        </View>
                      </AnimPress>
                    );
                  })}
                </View>
              </>
            )}

            {/* Season — the unified impact card (hours module) */}
            {!isStudent && hasHours && (
            <>
            <Text style={styles.sectionTitle}>Your season</Text>
            <GlassCard style={{ marginBottom: 24 }} contentStyle={{ padding: 20 }}>
              {/* real recent-activity bars */}
              <View style={styles.barChart}>
                {weeklyBars.map((v, i) => (
                  <View key={i} style={styles.barSlot}>
                    <View style={[styles.bar, { height: 6 + (v / barMax) * 46, backgroundColor: v > 0 ? PINE_MID : 'rgba(43,70,56,0.12)' }]} />
                  </View>
                ))}
              </View>
              <Text style={styles.barCaption}>Hours logged · last 6 weeks</Text>

              <View style={styles.triad}>
                <TriCell value={totalHours} label="Total hours" onPress={() => setShowHours(true)} />
                <View style={styles.triDivider} />
                <TriCell value={sessionsAttended} label="Sessions" />
                <View style={styles.triDivider} />
                <TriCell value={studentCount} label="Students" onPress={() => router.push('/students')} />
              </View>

              {/* goal meter */}
              <View style={styles.goalWrap}>
                <View style={styles.goalHead}>
                  <Text style={styles.goalLabel}>ANNUAL GOAL</Text>
                  <Text style={styles.goalValue}>
                    <Text style={{ color: INK, fontFamily: 'Inter-Bold' }}>{totalHours}</Text>
                    <Text style={{ color: 'rgba(34,39,31,0.45)' }}> / {GOAL} hrs</Text>
                  </Text>
                </View>
                <View style={styles.goalTrack}>
                  <View style={[styles.goalFill, { width: `${goalPct}%` }]} />
                </View>
                <Text style={styles.goalCaption}>{Math.round(goalPct)}% toward your yearly requirement.</Text>
              </View>
            </GlassCard>
            </>
            )}
          </>
        )}
      </ScrollView>

      {/* ── Hours History Modal ─────────────────── */}
      <OverlayModal visible={showHoursModal} onClose={() => setShowHours(false)} title="Hours history">
        {hoursHistory.length === 0
          ? <Text style={styles.emptyText}>No hours logged yet.</Text>
          : hoursHistory.map((h, i) => (
            <View key={i} style={styles.overlayRow}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={styles.overlayLabel}>{h.date_worked}</Text>
                <View style={styles.hrsBadge}><Text style={styles.hrsBadgeTxt}>+{h.hours} hrs</Text></View>
              </View>
              <Text style={styles.overlayDesc}>{h.description}</Text>
              <View style={[styles.statusBadge, h.status === 'approved' ? styles.statusGreen : h.status === 'rejected' ? styles.statusRed : styles.statusGrey]}>
                <Text style={styles.statusTxt}>{h.status}</Text>
              </View>
            </View>
          ))
        }
      </OverlayModal>

      {/* ── Session Detail Modal ── */}
      <Modal visible={!!sessionDetail} transparent animationType="fade">
        <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.scrim }]} onPress={() => setSessionDetail(null)}>
          <View style={{ flex: 1, justifyContent: 'center', paddingHorizontal: 24 }} pointerEvents="box-none">
            <Pressable onPress={(e) => e.stopPropagation()}>
            <GlassCard style={{ marginBottom: 0 }} contentStyle={{ padding: 20 }}>
              {sessionDetail ? (
                <>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
                    <Text style={styles.overlayTitle}>Event details</Text>
                    <TouchableOpacity onPress={() => setSessionDetail(null)} style={styles.closeBtn}>
                      <Ionicons name="close" size={20} color={INK} />
                    </TouchableOpacity>
                  </View>

                  <View style={{ marginBottom: 18 }}>
                    <View style={{ alignSelf: 'flex-start', backgroundColor: 'rgba(62,106,82,0.15)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 }}>
                      <Text style={{ fontFamily: 'Inter-Bold', fontSize: 10, color: PINE_MID, letterSpacing: 0.8 }}>
                        {sessionDetail.tag}
                      </Text>
                    </View>
                    <Text style={{ fontFamily: 'Inter-Bold', fontSize: 22, color: INK, letterSpacing: -0.3, lineHeight: 28 }}>{sessionDetail.title}</Text>
                  </View>

                  <View style={styles.infoBlock}>
                    <View style={styles.infoRow}>
                      <View style={[styles.infoIcon, { backgroundColor: 'rgba(62,106,82,0.15)' }]}>
                        <Ionicons name="calendar-outline" size={15} color={PINE_MID} />
                      </View>
                      <View>
                        <Text style={styles.infoLabel}>Date</Text>
                        <Text style={styles.infoValue}>{formatSessionLongDate(sessionDetail.start_time)}</Text>
                      </View>
                    </View>
                    <View style={styles.infoRow}>
                      <View style={[styles.infoIcon, { backgroundColor: 'rgba(94,116,136,0.15)' }]}>
                        <Ionicons name="time-outline" size={15} color="#5E7488" />
                      </View>
                      <View>
                        <Text style={styles.infoLabel}>Time</Text>
                        <Text style={styles.infoValue}>{formatSessionTimeRange(sessionDetail.start_time, sessionDetail.end_time)}</Text>
                      </View>
                    </View>
                    {sessionDetail.location ? (
                      <View style={styles.infoRow}>
                        <View style={[styles.infoIcon, { backgroundColor: 'rgba(76,122,97,0.15)' }]}>
                          <Ionicons name="location-outline" size={15} color="#4C7A61" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.infoLabel}>Location</Text>
                          <Text style={styles.infoValue}>{sessionDetail.location}</Text>
                        </View>
                      </View>
                    ) : null}
                    {sessionDetail.description ? (
                      <View style={styles.infoRow}>
                        <View style={[styles.infoIcon, { backgroundColor: 'rgba(176,138,62,0.15)' }]}>
                          <Ionicons name="document-text-outline" size={15} color="#B08A3E" />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.infoLabel}>Notes</Text>
                          <Text style={[styles.infoValue, { lineHeight: 20 }]}>{sessionDetail.description}</Text>
                        </View>
                      </View>
                    ) : null}
                  </View>

                  {sessionDetail.location ? (
                    <TouchableOpacity onPress={() => openMaps(sessionDetail.location!)} style={styles.dirBtn} activeOpacity={0.8}>
                      <Ionicons name="navigate-outline" size={17} color="#4C7A61" />
                      <Text style={styles.dirBtnTxt}>Get directions in Maps</Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              ) : null}
            </GlassCard>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* ── Org detail modals ── */}
      <OverlayModal visible={showOrgHours} onClose={() => setShowOrgHours(false)} title="Total impact">
        <View style={styles.overlayRow}>
          <Text style={styles.overlayLabel}>{orgHours} approved hours</Text>
          <Text style={styles.overlayDesc}>Across all {memberNoun.toLowerCase()}s in the organization this season.</Text>
        </View>
      </OverlayModal>

      <OverlayModal visible={showOrgMembers} onClose={() => setShowOrgMembers(false)} title="All members">
        <View style={styles.overlayRow}>
          <Text style={styles.overlayLabel}>{orgMembers} registered members</Text>
          <Text style={styles.overlayDesc}>View the full roster in the Director Panel.</Text>
          <TouchableOpacity onPress={() => { setShowOrgMembers(false); router.push('/admin'); }} style={styles.dirBtn}>
            <Text style={styles.dirBtnTxt}>Open Director Panel</Text>
          </TouchableOpacity>
        </View>
      </OverlayModal>

      <CreateAnnouncementModal
        visible={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => {}}
      />
    </View>
  );
}

// ── Small building blocks ─────────────────────────────────────────────────────
function TriCell({ value, label, onPress }: { value: number; label: string; onPress?: () => void }) {
  const body = (
    <View style={styles.triCell}>
      <AnimatedCounter value={value} style={styles.triNum} />
      <Text style={styles.triLabel}>{label}</Text>
    </View>
  );
  return onPress ? <TouchableOpacity style={{ flex: 1 }} activeOpacity={0.7} onPress={onPress}>{body}</TouchableOpacity> : body;
}

function ListCard({ icon, tint, value, label, sub, badge }: { icon: any; tint: string; value: number; label: string; sub: string; badge?: number }) {
  return (
    <View style={styles.listCard}>
      <View style={[styles.listIcon, { backgroundColor: `${tint}26`, borderColor: `${tint}4d` }]}>
        <Ionicons name={icon} size={20} color={tint} />
      </View>
      <View style={{ flex: 1, marginLeft: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <AnimatedCounter value={value} style={styles.listValue} />
          <Text style={styles.listLabel}>{label}</Text>
        </View>
        <Text style={styles.listSub}>{sub}</Text>
      </View>
      {badge !== undefined
        ? <View style={styles.badgeDot}><Text style={styles.badgeNum}>{badge}</Text></View>
        : <Ionicons name="chevron-forward" size={16} color="rgba(34,39,31,0.3)" />}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  scrollContent: { paddingTop: 72, paddingHorizontal: 20, paddingBottom: 140 },

  // Masthead
  mastRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  eyebrow: { fontFamily: 'Inter-Bold', fontSize: 11.5, color: PINE_MID, letterSpacing: 2 },
  hello: { fontFamily: 'Inter-Medium', fontSize: 19, color: 'rgba(34,39,31,0.55)', letterSpacing: -0.2 },
  name: { fontFamily: 'Inter-Black', fontSize: 40, color: PINE, letterSpacing: -1.6, lineHeight: 44, marginTop: 2 },
  subline: { fontFamily: 'Inter-Regular', fontSize: 14.5, color: 'rgba(34,39,31,0.6)', lineHeight: 21, marginTop: 10, maxWidth: '94%' },

  adminBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(62,106,82,0.12)', borderWidth: 1, borderColor: 'rgba(62,106,82,0.35)', paddingHorizontal: 11, paddingVertical: 6, borderRadius: 20 },
  adminBadgeActive: { backgroundColor: PINE_MID, borderColor: PINE_MID },
  adminBadgeText: { fontFamily: 'Inter-Bold', fontSize: 11, color: PINE_MID, letterSpacing: 0.5 },

  sectionTitle: { fontFamily: 'Inter-SemiBold', fontSize: 12.5, color: 'rgba(34,39,31,0.5)', letterSpacing: 1.2, marginBottom: 12, textTransform: 'uppercase' },

  // Hero pine block
  heroPine: { overflow: 'hidden', borderRadius: 26, backgroundColor: PINE_DEEP, padding: 22, borderWidth: 1, borderColor: 'rgba(245,239,227,0.10)' },
  heroBlob: { position: 'absolute', top: -70, right: -50, width: 200, height: 200, borderRadius: 100, backgroundColor: 'rgba(245,239,227,0.06)' },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroEyebrow: { fontFamily: 'Inter-Bold', fontSize: 11, color: 'rgba(245,239,227,0.6)', letterSpacing: 2 },
  whenChip: { backgroundColor: 'rgba(245,239,227,0.14)', borderRadius: 20, paddingHorizontal: 11, paddingVertical: 5 },
  whenChipTxt: { fontFamily: 'Inter-Bold', fontSize: 11, color: CREAM, letterSpacing: 0.6 },
  heroTitle: { fontFamily: 'Inter-Bold', fontSize: 25, color: CREAM, letterSpacing: -0.5, lineHeight: 30, marginTop: 14 },
  heroMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, flexWrap: 'wrap' },
  heroMetaTxt: { fontFamily: 'Inter-Medium', fontSize: 13.5, color: 'rgba(245,239,227,0.85)' },
  heroMetaDot: { color: 'rgba(245,239,227,0.4)', fontSize: 14, marginHorizontal: 2 },
  heroSub: { fontFamily: 'Inter-Regular', fontSize: 14, color: 'rgba(245,239,227,0.72)', lineHeight: 21, marginTop: 10 },

  heroBigNum: { fontFamily: 'Inter-Black', fontSize: 52, color: CREAM, letterSpacing: -2, lineHeight: 54 },
  heroBigUnit: { fontFamily: 'Inter-SemiBold', fontSize: 16, color: 'rgba(245,239,227,0.7)', marginBottom: 8 },
  heroGhostBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', marginTop: 18, backgroundColor: 'rgba(245,239,227,0.14)', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 14 },
  heroGhostTxt: { fontFamily: 'Inter-SemiBold', fontSize: 14, color: CREAM },

  // Inline RSVP
  rsvpRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  rsvpPill: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(245,239,227,0.3)' },
  rsvpPillGoing: { backgroundColor: CREAM, borderColor: CREAM },
  rsvpPillNo: { backgroundColor: CLAY, borderColor: CLAY },
  rsvpPillTxt: { fontFamily: 'Inter-SemiBold', fontSize: 14, color: 'rgba(245,239,227,0.9)' },

  // Season card
  barChart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 52, gap: 8 },
  barSlot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '100%', borderRadius: 5, minHeight: 6 },
  barCaption: { fontFamily: 'Inter-Medium', fontSize: 11, color: 'rgba(34,39,31,0.4)', marginTop: 10, letterSpacing: 0.3 },

  triad: { flexDirection: 'row', alignItems: 'center', marginTop: 20, paddingTop: 18, borderTopWidth: 1, borderTopColor: 'rgba(43,70,56,0.1)' },
  triCell: { flex: 1, alignItems: 'center' },
  triNum: { fontFamily: 'Inter-Black', fontSize: 30, color: INK, letterSpacing: -1 },
  triLabel: { fontFamily: 'Inter-Medium', fontSize: 11.5, color: 'rgba(34,39,31,0.5)', marginTop: 3 },
  triDivider: { width: 1, height: 34, backgroundColor: 'rgba(43,70,56,0.1)' },

  goalWrap: { marginTop: 20, paddingTop: 18, borderTopWidth: 1, borderTopColor: 'rgba(43,70,56,0.1)' },
  goalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  goalLabel: { fontFamily: 'Inter-SemiBold', fontSize: 11.5, color: colors.silver, letterSpacing: 1 },
  goalValue: { fontFamily: 'Inter-Medium', fontSize: 13 },
  goalTrack: { height: 8, backgroundColor: 'rgba(43,70,56,0.1)', borderRadius: 4, overflow: 'hidden' },
  goalFill: { height: '100%', backgroundColor: PINE, borderRadius: 4 },
  goalCaption: { fontFamily: 'Inter-Regular', fontSize: 12, color: 'rgba(34,39,31,0.4)', marginTop: 10 },

  // Shortcut chips
  chipRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  chip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 15, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(43,70,56,0.14)' },
  chipPrimary: { backgroundColor: PINE, borderColor: PINE },
  chipLabel: { fontFamily: 'Inter-SemiBold', fontSize: 13.5, color: INK },

  linkNotice: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(62,106,82,0.08)', borderWidth: 1, borderColor: 'rgba(62,106,82,0.22)', borderRadius: 14, padding: 14, marginBottom: 24 },
  linkNoticeTxt: { flex: 1, fontFamily: 'Inter-Regular', fontSize: 13, color: 'rgba(34,39,31,0.6)', lineHeight: 19 },

  // Your students
  studentRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(43,70,56,0.14)', borderRadius: 18, padding: 14 },
  studentAvatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: PINE, alignItems: 'center', justifyContent: 'center' },
  studentAvatarTxt: { fontFamily: 'Inter-Bold', fontSize: 17, color: CREAM },
  studentName: { fontFamily: 'Inter-SemiBold', fontSize: 15.5, color: INK },
  studentGoal: { fontFamily: 'Inter-Regular', fontSize: 12.5, color: 'rgba(34,39,31,0.55)', marginTop: 2 },
  studentGoalMuted: { fontFamily: 'Inter-Regular', fontSize: 12.5, color: 'rgba(34,39,31,0.4)', marginTop: 3 },
  studentTrack: { height: 5, backgroundColor: 'rgba(43,70,56,0.10)', borderRadius: 3, overflow: 'hidden', marginTop: 7 },
  studentFill: { height: '100%', backgroundColor: PINE_MID, borderRadius: 3 },

  // List cards (admin)
  listCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(43,70,56,0.14)', padding: 16 },
  listIcon: { width: 48, height: 48, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  listValue: { fontFamily: 'Inter-Black', fontSize: 24, color: INK, letterSpacing: -0.8 },
  listLabel: { fontFamily: 'Inter-SemiBold', fontSize: 14.5, color: INK },
  listSub: { fontFamily: 'Inter-Regular', fontSize: 12.5, color: 'rgba(34,39,31,0.45)', marginTop: 2 },
  badgeDot: { minWidth: 28, height: 28, paddingHorizontal: 8, borderRadius: 14, backgroundColor: '#B08A3E', alignItems: 'center', justifyContent: 'center' },
  badgeNum: { fontFamily: 'Inter-Bold', fontSize: 13, color: CREAM },

  // Overlay modals
  overlayHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  overlayTitle: { fontFamily: 'Inter-Bold', fontSize: 22, color: INK, letterSpacing: -0.3 },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(43,70,56,0.10)', borderWidth: 1, borderColor: 'rgba(43,70,56,0.2)', alignItems: 'center', justifyContent: 'center' },
  overlayRow: { backgroundColor: 'rgba(43,70,56,0.06)', borderRadius: 16, padding: 16, marginBottom: 10, borderWidth: 1, borderColor: 'rgba(43,70,56,0.14)' },
  overlayLabel: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: INK },
  overlayDesc: { fontFamily: 'Inter-Regular', fontSize: 13, color: 'rgba(34,39,31,0.55)', marginTop: 4, lineHeight: 20 },
  hrsBadge: { backgroundColor: 'rgba(62,106,82,0.15)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  hrsBadgeTxt: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: PINE_MID },
  statusBadge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20, marginTop: 8, borderWidth: 1 },
  statusGreen: { backgroundColor: 'rgba(65,120,92,0.15)', borderColor: 'rgba(65,120,92,0.3)' },
  statusRed: { backgroundColor: 'rgba(177,90,78,0.15)', borderColor: 'rgba(177,90,78,0.3)' },
  statusGrey: { backgroundColor: 'rgba(43,70,56,0.12)', borderColor: 'rgba(43,70,56,0.2)' },
  statusTxt: { fontFamily: 'Inter-Medium', fontSize: 12, color: 'rgba(34,39,31,0.7)', textTransform: 'capitalize' },
  emptyText: { fontFamily: 'Inter-Regular', fontSize: 14, color: 'rgba(34,39,31,0.4)', textAlign: 'center', paddingVertical: 30 },

  infoBlock: { backgroundColor: 'rgba(43,70,56,0.06)', borderRadius: 16, padding: 14, gap: 14, marginBottom: 18, borderWidth: 1, borderColor: 'rgba(43,70,56,0.14)' },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  infoIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  infoLabel: { fontFamily: 'Inter-Medium', fontSize: 11, color: 'rgba(34,39,31,0.4)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 },
  infoValue: { fontFamily: 'Inter-Medium', fontSize: 14, color: INK },
  dirBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: 'rgba(76,122,97,0.12)', borderWidth: 1, borderColor: 'rgba(76,122,97,0.3)', borderRadius: 16, paddingVertical: 14 },
  dirBtnTxt: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: '#4C7A61' },
});
