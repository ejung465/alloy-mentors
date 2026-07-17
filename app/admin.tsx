import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, RefreshControl,
  StyleSheet, Animated, Alert, Pressable, Modal, TextInput
} from 'react-native';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { GlassCard } from '@/components/ui/GlassCard';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { colors } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { useUser } from '@/contexts/UserContext';
import {
  roleLabel, roleColor, canManageOrg, canCreateEvents, VOLUNTEER_ROLES, ASSIGNABLE_ROLES, type UserRole,
} from '@/lib/roles';
import { checkAndAwardBadges } from '@/lib/badges';
import { TourOverlay } from '@/components/ui/TourOverlay';

const logAudit = (organizationId: string | null | undefined, actorId: string | undefined, action: string, targetType: string, targetId: string, details?: Record<string, any>) => {
  if (!organizationId || !actorId) return;
  supabase.from('audit_log').insert({ organization_id: organizationId, actor_id: actorId, action, target_type: targetType, target_id: targetId, details: details ?? {} }).then(() => {});
};

// Animated press
function AnimPress({ children, onPress, style }: any) {
  const s = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPressIn={() => Animated.spring(s, { toValue: 0.97, useNativeDriver: true, tension: 300, friction: 12 }).start()}
      onPressOut={() => Animated.spring(s, { toValue: 1, useNativeDriver: true, tension: 300, friction: 12 }).start()}
      onPress={onPress}
      style={style}
    >
      <Animated.View style={{ transform: [{ scale: s }] }}>{children}</Animated.View>
    </Pressable>
  );
}

type HoursLog = {
  id: string;
  mentor_id: string;
  hours: number;
  date_worked: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  mentor?: { full_name: string; email: string; school: string };
};

export default function AdminDashboard() {
  const router = useRouter();
  const { profile, org } = useUser();
  const canManage = canManageOrg(profile?.role);
  const [logs, setLogs] = useState<HoursLog[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'pending' | 'approved' | 'rejected'>('pending');
  const [updating, setUpdating] = useState<string | null>(null);

  // Role management
  const [editUser, setEditUser] = useState<any>(null);
  const [editSubject, setEditSubject] = useState('');
  const [savingRole, setSavingRole] = useState(false);
  const [adjHours, setAdjHours] = useState('');

  const [stats, setStats] = useState({ pending: 0, approved: 0, totalHours: 0, mentors: 0 });

  // Admin tour — auto-shows the first time an admin/leader lands here
  // (tracked per-role in AsyncStorage by TourOverlay/lib/tours.ts), and can
  // be replayed anytime via the "Take a tour" button in the header.
  const [forceTour, setForceTour] = useState(false);

  const fetchData = useCallback(async () => {
    // Fetch all hours logs with mentor info
    const { data: logsData, error } = await supabase
      .from('hours_logs')
      .select('*, mentor:users!hours_logs_mentor_id_fkey(full_name, email, school)')
      .order('created_at', { ascending: false });

    if (error) {
      console.log('Admin fetch error:', error.message);
      Alert.alert('Error', `Could not load submissions: ${error.message}`);
      return;
    }

    setLogs(logsData || []);

    // Compute stats
    const pending = (logsData || []).filter(l => l.status === 'pending').length;
    const approved = (logsData || []).filter(l => l.status === 'approved').length;
    const totalHours = (logsData || [])
      .filter(l => l.status === 'approved')
      .reduce((acc, l) => acc + Number(l.hours), 0);

    const { count: mentorCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .in('role', VOLUNTEER_ROLES);

    setStats({ pending, approved, totalHours, mentors: mentorCount || 0 });

    // Fetch all users
    const { data: usersData } = await supabase.from('users').select('*').order('created_at', { ascending: false });
    setAllUsers(usersData || []);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const handleDecision = async (logId: string, decision: 'approved' | 'rejected') => {
    setUpdating(logId);
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase
      .from('hours_logs')
      .update({ status: decision, approved_by: user?.id })
      .eq('id', logId);

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      // Reflect immediately, then reconcile all stats (incl. Total Hrs) from source.
      setLogs(prev => prev.map(l => l.id === logId ? { ...l, status: decision } : l));
      const log = logs.find(l => l.id === logId);
      logAudit(org?.id, user?.id, `hours.${decision}`, 'hours_log', logId, { mentor_id: log?.mentor_id, hours: log?.hours });
      if (decision === 'approved' && log?.mentor_id) checkAndAwardBadges(log.mentor_id).catch(() => {});
      await fetchData();
    }
    setUpdating(null);
  };

  const openRoleEditor = (u: any) => {
    if (!canManage) return;
    setEditSubject(u.director_subject || '');
    setAdjHours('');
    setEditUser(u);
  };

  const addManualHours = async () => {
    const n = Number(adjHours);
    if (!editUser || !n || isNaN(n)) { Alert.alert('Enter a number', 'e.g. 2 or 2.5'); return; }
    const { error } = await supabase.from('hours_logs').insert({
      mentor_id: editUser.id,
      hours: n,
      date_worked: new Date().toISOString().slice(0, 10),
      description: `Manual adjustment by ${profile?.full_name || 'admin'}`,
      status: 'approved',
      source: 'manual',
      organization_id: editUser.organization_id ?? profile?.organization_id ?? null,
      approved_by: profile?.id ?? null,
    });
    if (error) { Alert.alert('Error', error.message); return; }
    setAdjHours('');
    Alert.alert('Hours added', `${n}h credited to ${editUser.full_name}.`);
    fetchData();
  };

  const applyRole = async (newRole: UserRole) => {
    if (!editUser) return;
    if (editUser.id === profile?.id) { Alert.alert('Not allowed', "You can't change your own role — ask another admin."); return; }
    if (newRole === 'admin' && profile?.role !== 'admin') { Alert.alert('Admins only', 'Only an existing admin can grant the admin role.'); return; }
    setSavingRole(true);
    const patch: Record<string, any> = { role: newRole };
    patch.director_subject = newRole === 'director' ? (editSubject.trim() || null) : null;
    const { error } = await supabase.from('users').update(patch).eq('id', editUser.id);
    setSavingRole(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setAllUsers(prev => prev.map(u => u.id === editUser.id ? { ...u, ...patch } : u));
    logAudit(org?.id, profile?.id, 'user.role_changed', 'user', editUser.id, { from: editUser.role, to: newRole });
    setEditUser(null);
  };

  const filteredLogs = logs.filter(l => l.status === activeTab);

  const tabColors = {
    pending: '#B08A3E',
    approved: '#2C7C96',
    rejected: '#B15A4E', // rose — distinct from approved (was green, looked approved)
  };

  // Real authorization: directors+ may view; route is otherwise blocked.
  if (profile && !canCreateEvents(profile.role)) {
    return (
      <View style={[styles.screen, { justifyContent: 'center', alignItems: 'center', padding: 32 }]}>
        <AuroraBackground variant="warm" />
        <Ionicons name="lock-closed-outline" size={40} color="rgba(34,39,31,0.4)" />
        <Text style={[styles.pageTitle, { textAlign: 'center', marginTop: 12 }]}>Restricted</Text>
        <Text style={[styles.pageSubtitle, { textAlign: 'center', marginTop: 6 }]}>The Director Panel is for directors and leadership only.</Text>
        <TouchableOpacity onPress={() => router.back()} style={[styles.backBtn, { marginTop: 20, width: 'auto', paddingHorizontal: 18, flexDirection: 'row', gap: 6 }]}>
          <Ionicons name="chevron-back" size={18} color="#22271F" />
          <Text style={{ color: '#22271F', fontFamily: 'Inter-SemiBold' }}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <AuroraBackground variant="warm" />
      <TourOverlay
        role={profile?.role}
        force={forceTour}
        onDone={() => setForceTour(false)}
      />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#22271F" />}
      >
        {/* ── Header ─────────────────────────────── */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={20} color="#22271F" />
          </TouchableOpacity>
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.pageTitle}>Director Panel</Text>
            <Text style={styles.pageSubtitle}>Tutoring Hours Review</Text>
          </View>
          <TouchableOpacity onPress={() => setForceTour(true)} style={styles.gearBtn} activeOpacity={0.8}>
            <Ionicons name="help-circle-outline" size={18} color="#2C7C96" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.push('/org-settings')} style={styles.gearBtn} activeOpacity={0.8}>
            <Ionicons name="settings-outline" size={18} color="#2C7C96" />
          </TouchableOpacity>
          <View style={styles.adminBadge}>
            <Ionicons name="shield-checkmark" size={13} color="#2C7C96" />
            <Text style={styles.adminBadgeText}>Admin</Text>
          </View>
        </View>

        {/* ── Stats Strip ────────────────────────── */}
        <View style={styles.statsRow}>
          {[
            { label: 'Pending', value: stats.pending, color: '#B08A3E', icon: 'time-outline' },
            { label: 'Approved', value: stats.approved, color: '#2C7C96', icon: 'checkmark-circle-outline' },
            { label: 'Total Hrs', value: stats.totalHours, color: '#2C7C96', icon: 'hourglass-outline' },
            { label: 'Mentors', value: stats.mentors, color: '#7A7A7A', icon: 'people-outline' },
          ].map((s) => (
            <View key={s.label} style={styles.statTile}>
              <BlurView intensity={20} tint="light" style={StyleSheet.absoluteFillObject} />
              <View style={{ zIndex: 10, alignItems: 'center' }}>
                <Ionicons name={s.icon as any} size={18} color={s.color} />
                <AnimatedCounter value={s.value} style={[styles.statNum, { color: s.color }]} />
                <Text style={styles.statLbl}>{s.label}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Tab Selector ───────────────────────── */}
        <View style={styles.tabRow}>
          {(['pending', 'approved', 'rejected'] as const).map((tab) => (
            <TouchableOpacity
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[styles.tabPill, activeTab === tab && { backgroundColor: `${tabColors[tab]}20`, borderColor: `${tabColors[tab]}50` }]}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, activeTab === tab && { color: tabColors[tab] }]}>
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'pending' && stats.pending > 0 ? ` (${stats.pending})` : ''}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Log Cards ──────────────────────────── */}
        {filteredLogs.length === 0 ? (
          <GlassCard contentStyle={{ alignItems: 'center', paddingVertical: 40 }}>
            <Ionicons name="checkmark-done-outline" size={44} color="rgba(34,39,31,0.25)" />
            <Text style={styles.emptyText}>
              {activeTab === 'pending' ? 'No pending submissions' : `No ${activeTab} submissions`}
            </Text>
          </GlassCard>
        ) : (
          filteredLogs.map((log) => (
            <AnimPress key={log.id} style={{ marginBottom: 12 }}>
              <GlassCard>
                {/* Mentor info */}
                <View style={styles.cardHeader}>
                  <View style={styles.mentorAvatar}>
                    <Text style={styles.mentorAvatarText}>
                      {log.mentor?.full_name?.charAt(0).toUpperCase() || 'M'}
                    </Text>
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.mentorName}>{log.mentor?.full_name || 'Unknown Mentor'}</Text>
                    <Text style={styles.mentorEmail}>{log.mentor?.email || ''}</Text>
                  </View>
                  <View style={styles.hoursBadge}>
                    <Text style={styles.hoursBadgeText}>{log.hours}h</Text>
                  </View>
                </View>

                {/* Details */}
                <View style={styles.cardDetails}>
                  <View style={styles.detailRow}>
                    <Ionicons name="calendar-outline" size={14} color="rgba(34,39,31,0.4)" />
                    <Text style={styles.detailText}>{log.date_worked}</Text>
                  </View>
                  {log.description ? (
                    <View style={styles.detailRow}>
                      <Ionicons name="document-text-outline" size={14} color="rgba(34,39,31,0.4)" />
                      <Text style={styles.detailText} numberOfLines={2}>{log.description}</Text>
                    </View>
                  ) : null}
                  <View style={styles.detailRow}>
                    <Ionicons name="time-outline" size={14} color="rgba(34,39,31,0.4)" />
                    <Text style={styles.detailText}>
                      Submitted {new Date(log.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                </View>

                {/* Approve / Reject — only on pending */}
                {log.status === 'pending' && (
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      onPress={() => handleDecision(log.id, 'rejected')}
                      disabled={updating === log.id}
                      style={[styles.actionBtn, styles.rejectBtn]}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="close" size={16} color="#2C7C96" />
                      <Text style={[styles.actionBtnText, { color: '#2C7C96' }]}>Reject</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleDecision(log.id, 'approved')}
                      disabled={updating === log.id}
                      style={[styles.actionBtn, styles.approveBtn]}
                      activeOpacity={0.8}
                    >
                      {updating === log.id
                        ? <Text style={[styles.actionBtnText, { color: '#2C7C96' }]}>Saving...</Text>
                        : <>
                            <Ionicons name="checkmark" size={16} color="#2C7C96" />
                            <Text style={[styles.actionBtnText, { color: '#2C7C96' }]}>Approve</Text>
                          </>
                      }
                    </TouchableOpacity>
                  </View>
                )}

                {/* Status badge on non-pending */}
                {log.status !== 'pending' && (
                  <View style={[
                    styles.statusBadge,
                    log.status === 'approved' ? styles.statusApproved : styles.statusRejected
                  ]}>
                    <Ionicons
                      name={log.status === 'approved' ? 'checkmark-circle' : 'close-circle'}
                      size={13}
                      color={log.status === 'approved' ? '#2C7C96' : '#B15A4E'}
                    />
                    <Text style={[styles.statusText, { color: log.status === 'approved' ? '#2C7C96' : '#B15A4E' }]}>
                      {log.status.charAt(0).toUpperCase() + log.status.slice(1)}
                    </Text>
                  </View>
                )}
              </GlassCard>
            </AnimPress>
          ))
        )}

        {/* ── All Members ────────────────────────── */}
        <Text style={styles.sectionLabel}>ALL MEMBERS{canManage ? ' · TAP TO MANAGE' : ''}</Text>
        {allUsers.map((u) => {
          const rc = roleColor(u.role);
          return (
            <GlassCard key={u.id} style={{ marginBottom: 10 }} onPress={canManage ? () => openRoleEditor(u) : undefined}>
              <View style={styles.memberRow}>
                <View style={[styles.mentorAvatar, { width: 40, height: 40, borderRadius: 20 }]}>
                  <Text style={[styles.mentorAvatarText, { fontSize: 16 }]}>
                    {u.full_name?.charAt(0).toUpperCase() || 'U'}
                  </Text>
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.mentorName}>{u.full_name}</Text>
                  <Text style={styles.mentorEmail}>{u.email}</Text>
                </View>
                <View style={[styles.rolePill, { backgroundColor: `${rc}26`, borderColor: `${rc}55` }]}>
                  <Text style={[styles.rolePillText, { color: rc }]}>{roleLabel(u.role, u.director_subject, org?.memberNoun)}</Text>
                </View>
              </View>
            </GlassCard>
          );
        })}
      </ScrollView>

      {/* ── Role editor (leadership only) ───────── */}
      <Modal visible={!!editUser} transparent animationType="fade" onRequestClose={() => setEditUser(null)}>
        <Pressable style={styles.roleBackdrop} onPress={() => setEditUser(null)}>
          <BlurView intensity={28} tint="light" style={StyleSheet.absoluteFillObject} />
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%' }}>
            <GlassCard style={{ marginBottom: 0 }} contentStyle={{ padding: 20 }}>
              <View style={styles.roleHeader}>
                <Text style={styles.roleTitle}>Manage Role</Text>
                <TouchableOpacity onPress={() => setEditUser(null)} style={styles.backBtn}>
                  <Ionicons name="close" size={18} color="#22271F" />
                </TouchableOpacity>
              </View>
              <Text style={styles.roleSub}>{editUser?.full_name} · {editUser?.email}</Text>

              <View style={{ gap: 8, marginTop: 8 }}>
                {ASSIGNABLE_ROLES.map((r) => {
                  const active = editUser?.role === r;
                  const rc = roleColor(r);
                  return (
                    <TouchableOpacity
                      key={r}
                      activeOpacity={0.85}
                      onPress={() => applyRole(r)}
                      disabled={savingRole}
                      style={[styles.roleOption, active && { backgroundColor: `${rc}22`, borderColor: `${rc}66` }]}
                    >
                      <Text style={[styles.roleOptionTxt, active && { color: rc }]}>{roleLabel(r, r === 'director' ? editSubject : null, org?.memberNoun)}</Text>
                      {active && <Ionicons name="checkmark" size={18} color={rc} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.roleSub, { marginTop: 14, marginBottom: 6 }]}>Board subject (for Directors)</Text>
              <TextInput
                value={editSubject}
                onChangeText={setEditSubject}
                placeholder="e.g. Math, Music, English"
                placeholderTextColor={colors.textGhost}
                style={styles.roleInput}
              />

              <Text style={[styles.roleSub, { marginTop: 14, marginBottom: 6 }]}>Manual hours override</Text>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <TextInput
                  value={adjHours}
                  onChangeText={setAdjHours}
                  placeholder="Hours (e.g. 2.5)"
                  placeholderTextColor={colors.textGhost}
                  keyboardType="numeric"
                  style={[styles.roleInput, { flex: 1 }]}
                />
                <TouchableOpacity onPress={addManualHours} style={styles.addHoursBtn} activeOpacity={0.85}>
                  <Text style={styles.addHoursTxt}>Add</Text>
                </TouchableOpacity>
              </View>
            </GlassCard>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  scrollContent: { paddingTop: 64, paddingHorizontal: 20, paddingBottom: 160 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  backBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(196,196,196,0.16)',
    borderWidth: 1, borderColor: 'rgba(196,196,196,0.26)',
    alignItems: 'center', justifyContent: 'center',
  },
  pageTitle: { fontFamily: 'Inter-Black', fontSize: 30, color: '#22271F', letterSpacing: -1 },
  pageSubtitle: { fontFamily: 'Inter-Regular', fontSize: 14, color: 'rgba(34,39,31,0.45)', marginTop: 3 },
  gearBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(44,124,150,0.10)', borderWidth: 1, borderColor: 'rgba(44,124,150,0.25)', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  adminBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: 'rgba(76,122,97,0.12)',
    borderWidth: 1, borderColor: 'rgba(76,122,97,0.3)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12,
  },
  adminBadgeText: { fontFamily: 'Inter-SemiBold', fontSize: 12, color: '#2C7C96' },

  // Stats
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  statTile: {
    flex: 1, overflow: 'hidden', borderRadius: 16,
    borderWidth: 1, borderColor: 'rgba(196,196,196,0.26)',
    backgroundColor: 'rgba(196,196,196,0.16)',
    paddingVertical: 14, alignItems: 'center',
  },
  statNum: { fontFamily: 'Inter-Bold', fontSize: 22, marginTop: 6, letterSpacing: -0.5 },
  statLbl: { fontFamily: 'Inter-Regular', fontSize: 11, color: 'rgba(34,39,31,0.4)', marginTop: 2 },

  // Tabs
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  tabPill: {
    flex: 1, paddingVertical: 9, borderRadius: 12,
    backgroundColor: 'rgba(196,196,196,0.12)',
    borderWidth: 1, borderColor: 'rgba(196,196,196,0.22)',
    alignItems: 'center',
  },
  tabText: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: 'rgba(34,39,31,0.4)' },

  // Log card
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  mentorAvatar: {
    width: 46, height: 46, borderRadius: 23,
    backgroundColor: 'rgba(44,124,150,0.12)',
    borderWidth: 1, borderColor: 'rgba(44,124,150,0.25)',
    alignItems: 'center', justifyContent: 'center',
  },
  mentorAvatarText: { fontFamily: 'Inter-Bold', fontSize: 20, color: '#2C7C96' },
  mentorName: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: '#22271F' },
  mentorEmail: { fontFamily: 'Inter-Regular', fontSize: 12, color: 'rgba(34,39,31,0.4)', marginTop: 2 },
  hoursBadge: {
    backgroundColor: 'rgba(44,124,150,0.15)',
    borderWidth: 1, borderColor: 'rgba(44,124,150,0.3)',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6,
  },
  hoursBadgeText: { fontFamily: 'Inter-Bold', fontSize: 18, color: '#2C7C96' },

  cardDetails: {
    backgroundColor: 'rgba(196,196,196,0.12)',
    borderRadius: 12, padding: 12, gap: 6, marginBottom: 14,
  },
  detailRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  detailText: { fontFamily: 'Inter-Regular', fontSize: 13, color: 'rgba(34,39,31,0.55)', flex: 1, lineHeight: 19 },

  // Actions
  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1,
  },
  rejectBtn: { backgroundColor: 'rgba(44,124,150,0.08)', borderColor: 'rgba(44,124,150,0.25)' },
  approveBtn: { backgroundColor: 'rgba(76,122,97,0.1)', borderColor: 'rgba(76,122,97,0.3)' },
  actionBtnText: { fontFamily: 'Inter-SemiBold', fontSize: 14 },

  statusBadge: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center',
    gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12, borderWidth: 1,
  },
  statusApproved: { backgroundColor: 'rgba(76,122,97,0.1)', borderColor: 'rgba(76,122,97,0.25)' },
  statusRejected: { backgroundColor: 'rgba(177,90,78,0.12)', borderColor: 'rgba(177,90,78,0.3)' },
  statusText: { fontFamily: 'Inter-SemiBold', fontSize: 13 },

  sectionLabel: {
    fontFamily: 'Inter-Medium', fontSize: 11.5, color: 'rgba(34,39,31,0.35)',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12, marginTop: 10,
  },
  memberRow: { flexDirection: 'row', alignItems: 'center' },
  rolePill: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: 10, borderWidth: 1,
  },
  rolePillText: { fontFamily: 'Inter-SemiBold', fontSize: 11, textTransform: 'capitalize' },

  emptyText: {
    fontFamily: 'Inter-Regular', fontSize: 14,
    color: 'rgba(34,39,31,0.35)', marginTop: 14, textAlign: 'center',
  },

  // Role editor
  roleBackdrop: { flex: 1, justifyContent: 'center', paddingHorizontal: 24 },
  roleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  roleTitle: { fontFamily: 'Inter-Bold', fontSize: 20, color: '#22271F', letterSpacing: -0.3 },
  roleSub: { fontFamily: 'Inter-Regular', fontSize: 13, color: 'rgba(34,39,31,0.5)' },
  roleOption: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 13, paddingHorizontal: 16, borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(196,196,196,0.12)', backgroundColor: 'rgba(196,196,196,0.05)',
  },
  roleOptionTxt: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: 'rgba(34,39,31,0.85)' },
  roleInput: {
    fontFamily: 'Inter-Regular', fontSize: 15, color: '#22271F',
    backgroundColor: 'rgba(196,196,196,0.05)', borderRadius: 14, borderWidth: 1,
    borderColor: 'rgba(196,196,196,0.12)', paddingHorizontal: 14, paddingVertical: 12,
  },
  addHoursBtn: { backgroundColor: colors.platinum, borderRadius: 14, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center' },
  addHoursTxt: { fontFamily: 'Inter-Bold', fontSize: 15, color: colors.base },
});
