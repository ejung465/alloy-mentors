import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, Alert, ScrollView, Modal, KeyboardAvoidingView,
  Platform, TouchableOpacity, StyleSheet, Animated, Switch, Pressable, Linking
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassCard } from '@/components/ui/GlassCard';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { AnimatedCounter } from '@/components/ui/AnimatedCounter';
import { colors } from '@/lib/theme';
import { roleLabel, canCreateEvents, canManageOrg } from '@/lib/roles';
import { featureEnabled } from '@/lib/features';
import { clearLastOrg } from '@/lib/org';
import { getAttendanceStreak } from '@/lib/checkin';
import { Image } from 'expo-image';

function PressRow({ children, onPress }: any) {
  const scale = useRef(new Animated.Value(1)).current;
  return (
    <Pressable
      onPressIn={() => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, tension: 300, friction: 12 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, tension: 300, friction: 12 }).start()}
      onPress={onPress}
    >
      <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>
    </Pressable>
  );
}

function SettingRow({ icon, label, sublabel, onPress, rightEl, color = '#2C7C96', last = false }: any) {
  return (
    <PressRow onPress={onPress}>
      <View style={[styles.settingRow, !last && styles.settingRowBorder]}>
        <View style={[styles.settingIcon, { backgroundColor: `${color}18`, borderColor: `${color}30` }]}>
          <Ionicons name={icon} size={18} color={color} />
        </View>
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text style={styles.settingLabel}>{label}</Text>
          {sublabel ? <Text style={styles.settingSubLabel}>{sublabel}</Text> : null}
        </View>
        {rightEl ?? <Ionicons name="chevron-forward" size={16} color="rgba(34,39,31,0.25)" />}
      </View>
    </PressRow>
  );
}

// ── Video-game style stat bar ──────────────────────────────────
function StatBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.min(value / max, 1);
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: pct, duration: 800, useNativeDriver: false, delay: 200 }).start();
  }, [pct]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
        <Text style={styles.barLabel}>{label}</Text>
        <Text style={[styles.barVal, { color }]}>{value}</Text>
      </View>
      <View style={styles.barTrack}>
        <Animated.View style={[styles.barFill, { width, backgroundColor: color }]} />
      </View>
    </View>
  );
}

// ── Rank badge helper ─────────────────────────────────────────
function getStreakTier(weeks: number): { title: string; color: string; nextAt: number } {
  if (weeks >= 12) return { title: 'Unstoppable', color: '#2C7C96', nextAt: 999 };
  if (weeks >= 8)  return { title: 'Dedicated',   color: '#B08A3E', nextAt: 12  };
  if (weeks >= 4)  return { title: 'Consistent',  color: '#8C8C8C', nextAt: 8   };
  if (weeks >= 2)  return { title: 'Building',    color: '#E26522', nextAt: 4   };
  return              { title: 'Just started', color: '#2C7C96', nextAt: 2   };
}

export default function ProfileScreen() {
  const router = useRouter();
  const { org } = useUser();
  const orgName = org?.name || 'Alloy Mentors';
  const [profile, setProfile]         = useState<any>(null);
  const [totalHours, setTotalHours]   = useState(0);
  const [studentsHelped, setStudents] = useState(0);
  const [streak, setStreak]           = useState(0); // consecutive weeks attended
  const [loadingPdf, setLoadingPdf]   = useState(false);
  const [showStats, setShowStats]     = useState(false);
  const [notifEnabled, setNotif]      = useState(true);
  const [showEmail, setShowEmail]     = useState(false);
  const [newEmail, setNewEmail]       = useState('');
  const [emailStep, setEmailStep]     = useState<'address' | 'code'>('address');
  const [emailCode, setEmailCode]     = useState('');
  const [emailBusy, setEmailBusy]     = useState(false);

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('users').select('*').eq('id', user.id).maybeSingle();
    setProfile({ ...(data ?? {}), email: user.email });

    // Hours
    const { data: hLogs } = await supabase.from('hours_logs').select('hours, created_at').eq('mentor_id', user.id).eq('status', 'approved');
    const total = (hLogs || []).reduce((a, l) => a + Number(l.hours), 0);
    setTotalHours(total);

    // Students paired with me (distinct) — real source is session_attendance
    const { data: pairRows } = await supabase
      .from('session_attendance')
      .select('student_id')
      .eq('kind', 'student')
      .eq('paired_volunteer_id', user.id);
    setStudents(new Set((pairRows || []).map((r: any) => r.student_id)).size);

    // Attendance streak — consecutive weeks showing up, not vanity hours
    setStreak(await getAttendanceStreak(user.id));
  };

  useEffect(() => { fetchProfile(); }, []);
  // Refetch when returning from the edit screen so changes show immediately.
  useFocusEffect(React.useCallback(() => { fetchProfile(); }, []));

  // ── Change email: step 1 sends a 6-digit code to the new address, step 2
  //    verifies it (supabase email_change OTP). Requires SMTP + the Email
  //    Change template to include {{ .Token }}.
  const closeEmailModal = () => { setShowEmail(false); setEmailStep('address'); setEmailCode(''); };

  const handleSendEmailCode = async () => {
    const next = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) { Alert.alert('Invalid email', 'Enter a valid email address.'); return; }
    if (next === (profile?.email || '').toLowerCase()) { closeEmailModal(); return; }
    setEmailBusy(true);
    const { error } = await supabase.auth.updateUser({ email: next });
    setEmailBusy(false);
    if (error) { Alert.alert("Couldn't send the code", error.message); return; }
    setEmailStep('code');
  };

  const handleVerifyEmailCode = async () => {
    const next = newEmail.trim().toLowerCase();
    setEmailBusy(true);
    const { error } = await supabase.auth.verifyOtp({ type: 'email_change', email: next, token: emailCode.trim() });
    setEmailBusy(false);
    if (error) { Alert.alert('Wrong code', error.message); return; }
    closeEmailModal();
    await fetchProfile();
    Alert.alert('Email updated', `You now sign in with ${next}.`);
  };

  // Support / legal row handlers — real actions, no dead taps
  const mail = (subject: string) =>
    Linking.openURL(`mailto:support@alloymentors.com?subject=${encodeURIComponent(subject)}`)
      .catch(() => Alert.alert('No mail app found', 'Reach us at support@alloymentors.com'));
  const openURL = (url: string) =>
    Linking.openURL(url).catch(() => Alert.alert('Could not open link', url));

  const toggleNotif = async (v: boolean) => {
    setNotif(v);
    await AsyncStorage.setItem('alloy.notifEnabled', v ? '1' : '0');
  };
  useEffect(() => {
    AsyncStorage.getItem('alloy.notifEnabled').then((v) => { if (v !== null) setNotif(v === '1'); });
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/(auth)/onboarding');
  };

  const handleLeaveOrg = () => {
    Alert.alert(
      'Leave organization?',
      'You will be signed out and will need an organization code to join again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            await clearLastOrg();
            await supabase.auth.signOut();
            router.replace('/(auth)/onboarding');
          },
        },
      ]
    );
  };

  const exportPDF = async () => {
    setLoadingPdf(true);
    try {
      const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      const html = `
      <html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head>
      <body style="font-family: Georgia, 'Times New Roman', serif; color:#111; margin:0; padding:56px 54px;">
        <div style="border:2px solid #0A0C10; padding:40px 44px; border-radius:6px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px solid #CFC8B8; padding-bottom:18px;">
            <div>
              <div style="font-size:13px; letter-spacing:4px; color:#7A7F70;">${orgName.toUpperCase()} · ALLOY</div>
              <div style="font-size:26px; font-weight:bold; margin-top:4px;">Tutoring Hours Confirmation</div>
            </div>
            <div style="text-align:right; font-size:12px; color:#7A7F70;">Issued<br/><b style="color:#111;">${today}</b></div>
          </div>

          <p style="font-size:15px; line-height:1.7; margin-top:26px;">
            This letter certifies that <b>${profile?.full_name || 'the tutor'}</b>
            ${profile?.school ? `of <b>${profile.school}</b>` : ''} has served with the
            <b>${orgName}</b> tutoring program and has accrued the verified service hours recorded below.
          </p>

          <div style="margin:26px 0; padding:22px; background:#EDE6D8; border-radius:8px; display:flex; justify-content:space-between; align-items:center;">
            <div style="font-size:14px; color:#5A5F52;">Total Verified Service Hours</div>
            <div style="font-size:40px; font-weight:bold; letter-spacing:-1px;">${totalHours}</div>
          </div>

          <p style="font-size:13px; line-height:1.6; color:#5A5F52;">
            Role: <b style="color:#111;">${roleText}</b>
            &nbsp;·&nbsp; Hours are auto-credited at door check-in and reviewed by program leadership.
          </p>

          <div style="margin-top:54px; display:flex; justify-content:space-between; align-items:flex-end;">
            <div style="width:48%;">
              <div style="font-family:'Snell Roundhand','Apple Chancery',cursive; font-size:30px; color:#1a1a1a;">${orgName}</div>
              <div style="border-top:1px solid #111; margin-top:4px; padding-top:6px; font-size:12px; color:#5A5F52;">Authorized Signature · Program Founder</div>
            </div>
            <div style="width:40%; text-align:right; font-size:11px; color:#9AA090;">
              This is a pre-authorized confirmation generated by Alloy.<br/>Verification ID: ${(profile?.id || '').slice(0, 8).toUpperCase()}
            </div>
          </div>
        </div>
      </body></html>`;
      const { uri } = await Print.printToFileAsync({ html });
      await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
    } catch { Alert.alert('Error', 'Could not generate PDF.'); }
    finally { setLoadingPdf(false); }
  };

  const initials   = profile?.full_name?.charAt(0).toUpperCase() || 'V';
  const tier       = getStreakTier(streak);
  const isElevated = canCreateEvents(profile?.role);
  const roleText   = roleLabel(profile?.role, profile?.director_subject, org?.memberNoun);

  return (
    <View style={styles.screen}>
      <AuroraBackground variant="iris" />
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Header ─────────────────────────────── */}
        <View style={styles.pageHeader}>
          <Text style={styles.pageTitle}>Profile</Text>
          <TouchableOpacity onPress={() => router.push('/edit-profile')} style={styles.editPill} activeOpacity={0.8}>
            <Ionicons name="pencil-outline" size={15} color="#22271F" />
            <Text style={styles.editPillText}>Edit</Text>
          </TouchableOpacity>
        </View>

        {/* ── Avatar Card (tappable → stats modal) ─ */}
        <PressRow onPress={() => setShowStats(true)}>
          <GlassCard style={styles.profileCard}>
            <View style={styles.avatarRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials}</Text>
                <View style={styles.avatarOnline} />
              </View>
              <View style={{ flex: 1, marginLeft: 16 }}>
                <Text style={styles.profileName}>{profile?.full_name || 'Your Name'}</Text>
                <Text style={styles.profileRole} numberOfLines={1}>{roleText} · Alloy</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  <View style={styles.verifiedBadge}>
                    <Ionicons name="shield-checkmark" size={11} color="#2C7C96" />
                    <Text style={styles.verifiedText}>Verified</Text>
                  </View>
                  <View style={[styles.verifiedBadge, { backgroundColor: `${tier.color}18`, borderColor: `${tier.color}35` }]}>
                    <Ionicons name="flame-outline" size={11} color={tier.color} />
                    <Text style={[styles.verifiedText, { color: tier.color }]}>{tier.title}</Text>
                  </View>
                </View>
              </View>
              <Ionicons name="chevron-forward" size={16} color="rgba(34,39,31,0.32)" />
            </View>

            <View style={styles.statStrip}>
              <View style={styles.statItem}>
                <AnimatedCounter value={totalHours} style={styles.statNum} />
                <Text style={styles.statLbl}>Hours</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <AnimatedCounter value={streak} suffix="wk" style={styles.statNum} />
                <Text style={styles.statLbl}>Streak</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <AnimatedCounter value={studentsHelped} style={styles.statNum} />
                <Text style={styles.statLbl}>Students</Text>
              </View>
            </View>
          </GlassCard>
        </PressRow>

        {/* ── Administration (leadership & directors) ─── */}
        {isElevated && (
          <>
            <Text style={styles.sectionLabel}>ADMINISTRATION</Text>
            <GlassCard style={[styles.settingsCard, styles.adminCard]} contentStyle={{ padding: 0 }}>
              <SettingRow icon="shield-checkmark" label="Director Dashboard" sublabel="Review hours & manage members" onPress={() => router.push('/admin')} color={colors.titanium} last />
            </GlassCard>
          </>
        )}

        {/* ── Account ────────────────────────────── */}
        <Text style={styles.sectionLabel}>ACCOUNT</Text>
        <GlassCard style={styles.settingsCard} contentStyle={{ padding: 0 }}>
          <SettingRow icon="mail-outline"     label="Email"        sublabel={profile?.email || '—'}           color="#2C7C96" onPress={() => { setNewEmail(profile?.email || ''); setShowEmail(true); }} />
          <SettingRow icon="school-outline"   label="Institution"  sublabel={profile?.school || 'Not set'}    color="#7A7A7A" onPress={() => router.push('/edit-profile')} />
          <SettingRow icon="person-outline"   label="Role"         sublabel={roleText}                        color={colors.gold} onPress={() => router.push('/org-tree')} />
          {featureEnabled(org, 'checkin') && (
            <SettingRow icon="qr-code-outline"  label="Check-In QR"  sublabel="Show this at the door"           color={colors.silver} onPress={() => router.push('/my-qr')} />
          )}
          <SettingRow icon="business-outline" label="Organization" sublabel={canManageOrg(profile?.role) ? `${orgName} · Codes, features & vocabulary` : `${orgName} · Tap to leave`}       color={colors.titanium} onPress={canManageOrg(profile?.role) ? () => router.push('/org-settings') : handleLeaveOrg} last />
        </GlassCard>

        {/* ── Preferences ────────────────────────── */}
        <Text style={styles.sectionLabel}>PREFERENCES</Text>
        <GlassCard style={styles.settingsCard} contentStyle={{ padding: 0 }}>
          <SettingRow icon="notifications-outline" label="Push Notifications" sublabel="Session reminders & approvals" color="#C77E88" last
            rightEl={<Switch value={notifEnabled} onValueChange={toggleNotif} trackColor={{ true: 'rgba(199,126,136,0.5)' }} thumbColor="#C77E88" />}
          />
        </GlassCard>

        {/* ── Documents ──────────────────────────── */}
        <Text style={styles.sectionLabel}>DOCUMENTS</Text>
        <GlassCard style={styles.settingsCard} contentStyle={{ padding: 0 }}>
          {featureEnabled(org, 'hours') && (
            <SettingRow icon="document-text-outline" label={loadingPdf ? 'Generating...' : 'Export Verification PDF'} sublabel="Download your signed hours record" onPress={exportPDF} color="#41785C" />
          )}
          <SettingRow icon="cloud-download-outline" label="Request Data Export" sublabel="Email us to receive a copy of your data" color="#2C7C96" onPress={() => mail('Data export request')} last />
        </GlassCard>

        {/* ── Support ─────────────────────────────── */}
        <Text style={styles.sectionLabel}>SUPPORT</Text>
        <GlassCard style={styles.settingsCard} contentStyle={{ padding: 0 }}>
          <SettingRow icon="help-circle-outline" label="Help Center" color="#B08A3E" onPress={() => mail('Help request')} />
          <SettingRow icon="chatbox-outline" label="Contact Support" sublabel="Email the Alloy Mentors team" color="#2C7C96" onPress={() => mail('Support')} />
          <SettingRow icon="star-outline" label="Rate the App" color="#C77E88" onPress={() => Alert.alert('Thanks!', 'Ratings open once Alloy is on the App Store.')} last />
        </GlassCard>

        {/* ── Legal ───────────────────────────────── */}
        <Text style={styles.sectionLabel}>LEGAL</Text>
        <GlassCard style={styles.settingsCard} contentStyle={{ padding: 0 }}>
          <SettingRow icon="shield-outline" label="Privacy Policy" color="#7A7A7A" onPress={() => openURL('https://alloy.app/privacy')} />
          <SettingRow icon="document-outline" label="Terms of Service" color="#7A7A7A" onPress={() => openURL('https://alloy.app/terms')} last />
        </GlassCard>

        {/* ── Sign Out ─────────────────────────────── */}
        <TouchableOpacity onPress={handleSignOut} style={styles.signOutBtn} activeOpacity={0.8}>
          <BlurView intensity={15} tint="light" style={StyleSheet.absoluteFillObject} />
          <Ionicons name="log-out-outline" size={18} color="#2C7C96" style={{ marginRight: 8 }} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>
        <Text style={styles.versionText}>Alloy Mentors · v1.0.0</Text>
      </ScrollView>

      {/* ── VIDEO GAME STATS MODAL ─────────────────── */}
      <Modal visible={showStats} transparent animationType="slide" presentationStyle="overFullScreen">
        <View style={{ flex: 1 }}>
          <BlurView intensity={25} tint="light" style={StyleSheet.absoluteFillObject} />
          <Pressable style={{ flex: 1 }} onPress={() => setShowStats(false)} />
          <View style={styles.statsSheet}>
            <BlurView intensity={40} tint="light" style={StyleSheet.absoluteFillObject} />
            <View style={{ zIndex: 10 }}>
              {/* Handle */}
              <View style={{ alignItems: 'center', marginBottom: 20 }}>
                <View style={styles.sheetHandle} />
              </View>

              {/* Avatar + streak badge */}
              <View style={styles.statsHeader}>
                <View style={styles.statsAvatar}>
                  <Text style={styles.statsAvatarText}>{initials}</Text>
                </View>
                <View style={{ flex: 1, marginLeft: 16 }}>
                  <Text style={styles.statsName}>{profile?.full_name}</Text>
                  <View style={[styles.tierBadge, { backgroundColor: `${tier.color}20`, borderColor: `${tier.color}40` }]}>
                    <Ionicons name="flame" size={14} color={tier.color} />
                    <Text style={[styles.tierText, { color: tier.color }]}>{tier.title} Tier</Text>
                  </View>
                </View>
                {/* Attendance streak */}
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.rankNum}>{streak}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Ionicons name="flame" size={12} color="#E26522" />
                    <Text style={{ fontFamily: 'Inter-SemiBold', fontSize: 12, color: '#E26522' }}>
                      {streak === 1 ? 'week' : 'weeks'} running
                    </Text>
                  </View>
                  <Text style={{ fontFamily: 'Inter-Regular', fontSize: 10, color: 'rgba(34,39,31,0.35)', marginTop: 1 }}>Consecutive</Text>
                </View>
              </View>

              {/* Stat bars (video-game style) */}
              <View style={styles.statBarsWrapper}>
                <StatBar label="Hours Contributed" value={totalHours} max={200} color="#2C7C96" />
                <StatBar label="Students Helped"   value={studentsHelped} max={20} color="#2C7C96" />
                <StatBar label="Sessions Completed" value={Math.ceil(totalHours / 2)} max={50} color="#7A7A7A" />
              </View>

              {/* Next tier progress */}
              <View style={styles.nextTierBox}>
                <Text style={styles.nextTierLabel}>Next Tier</Text>
                <Text style={styles.nextTierVal}>{tier.nextAt - streak > 0
                  ? `${tier.nextAt - streak} more ${tier.nextAt - streak === 1 ? 'week' : 'weeks'} to ${tier.nextAt >= 999 ? 'Max' : 'next tier'}`
                  : '🔥 Max Tier Reached!'}</Text>
              </View>

              {/* Number badges */}
              <View style={styles.badgeRow}>
                {[
                  { icon: 'time', val: totalHours, label: 'Hours', color: '#2C7C96' },
                  { icon: 'people', val: studentsHelped, label: 'Students', color: '#2C7C96' },
                  { icon: 'flame', val: `${streak}wk`, label: 'Streak', color: '#E26522' },
                ].map((b) => (
                  <View key={b.label} style={[styles.badge, { borderColor: `${b.color}30` }]}>
                    <Ionicons name={b.icon as any} size={18} color={b.color} />
                    <Text style={[styles.badgeNum, { color: b.color }]}>{b.val}</Text>
                    <Text style={styles.badgeLbl}>{b.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Change Email Modal (two-step: address → 6-digit code) ── */}
      <Modal visible={showEmail} animationType="fade" transparent>
        <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.scrim }]} onPress={closeEmailModal}>
          <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
            <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <Pressable onPress={(e) => e.stopPropagation()}>
                <GlassCard>
                  <View style={styles.modalHeader}>
                    <Text style={styles.modalTitle}>{emailStep === 'address' ? 'Change Email' : 'Enter the code'}</Text>
                    <TouchableOpacity onPress={closeEmailModal} style={styles.sCloseBtn}>
                      <Ionicons name="close" size={20} color="#22271F" />
                    </TouchableOpacity>
                  </View>
                  {emailStep === 'address' ? (
                    <>
                      <Text style={styles.emailHelp}>
                        For security, changing your email requires a 6-digit verification code. We'll send one to the new address.
                      </Text>
                      <View style={{ gap: 14 }}>
                        <GlassInput label="New email" placeholder="you@example.com" value={newEmail} onChangeText={setNewEmail} keyboardType="email-address" autoCapitalize="none" />
                        <TouchableOpacity onPress={handleSendEmailCode} disabled={emailBusy} style={[styles.saveCTA, emailBusy && { opacity: 0.6 }]}>
                          <Text style={styles.saveCTAText}>{emailBusy ? 'Sending…' : 'Send code'}</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={styles.emailHelp}>
                        Enter the 6-digit code we sent to {newEmail.trim().toLowerCase()}.
                      </Text>
                      <View style={{ gap: 14 }}>
                        <GlassInput label="Verification code" placeholder="123456" value={emailCode} onChangeText={setEmailCode} keyboardType="number-pad" maxLength={6} />
                        <TouchableOpacity onPress={handleVerifyEmailCode} disabled={emailBusy || emailCode.trim().length !== 6} style={[styles.saveCTA, (emailBusy || emailCode.trim().length !== 6) && { opacity: 0.6 }]}>
                          <Text style={styles.saveCTAText}>{emailBusy ? 'Verifying…' : 'Verify & change email'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setEmailStep('address')} style={{ alignItems: 'center', paddingVertical: 6 }}>
                          <Text style={styles.emailBackTxt}>Use a different address</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </GlassCard>
              </Pressable>
            </KeyboardAvoidingView>
          </View>
        </Pressable>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  scrollContent: { paddingTop: 72, paddingHorizontal: 20, paddingBottom: 180 },
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  pageTitle: { fontFamily: 'Inter-Black', fontSize: 34, color: '#22271F', letterSpacing: -1 },
  editPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(196,196,196,0.22)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.32)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  editPillText: { fontFamily: 'Inter-Medium', fontSize: 13, color: '#22271F' },

  profileCard: { marginBottom: 28 },
  avatarRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(44,124,150,0.12)', borderWidth: 1.5, borderColor: 'rgba(44,124,150,0.3)', alignItems: 'center', justifyContent: 'center', position: 'relative' },
  avatarText: { fontFamily: 'Inter-Bold', fontSize: 30, color: '#2C7C96' },
  avatarOnline: { position: 'absolute', bottom: 2, right: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: '#41785C', borderWidth: 2, borderColor: '#050812' },
  profileName: { fontFamily: 'Inter-Bold', fontSize: 20, color: '#22271F', letterSpacing: -0.3 },
  profileRole: { fontFamily: 'Inter-Regular', fontSize: 13, color: 'rgba(34,39,31,0.4)', marginTop: 2, textTransform: 'capitalize' },
  verifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(76,122,97,0.12)', borderWidth: 1, borderColor: 'rgba(76,122,97,0.25)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  verifiedText: { fontFamily: 'Inter-Medium', fontSize: 11, color: '#2C7C96' },
  statStrip: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: 'rgba(196,196,196,0.16)', paddingTop: 16 },
  statItem: { flex: 1, alignItems: 'center' },
  statNum: { fontFamily: 'Inter-Bold', fontSize: 22, color: '#22271F', letterSpacing: -0.5 },
  statLbl: { fontFamily: 'Inter-Regular', fontSize: 12, color: 'rgba(34,39,31,0.4)', marginTop: 2 },
  statDivider: { width: 1, backgroundColor: 'rgba(196,196,196,0.22)', marginVertical: 4 },

  sectionLabel: { fontFamily: 'Inter-Medium', fontSize: 11.5, color: 'rgba(34,39,31,0.35)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, marginLeft: 4 },
  settingsCard: { marginBottom: 24 },
  adminCard: { borderColor: 'rgba(76,122,97,0.3)', shadowColor: '#2C7C96', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.15, shadowRadius: 12 },
  settingRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14 },
  settingRowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(196,196,196,0.16)' },
  settingIcon: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { fontFamily: 'Inter-Medium', fontSize: 15, color: '#22271F' },
  settingSubLabel: { fontFamily: 'Inter-Regular', fontSize: 12, color: 'rgba(34,39,31,0.4)', marginTop: 2 },
  signOutBtn: { overflow: 'hidden', borderRadius: 18, borderWidth: 1, borderColor: 'rgba(44,124,150,0.25)', backgroundColor: 'rgba(44,124,150,0.1)', paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  signOutText: { fontFamily: 'Inter-SemiBold', fontSize: 15, color: '#2C7C96' },
  versionText: { fontFamily: 'Inter-Regular', fontSize: 12, color: 'rgba(34,39,31,0.32)', textAlign: 'center' },

  // Stats modal
  statsSheet: { overflow: 'hidden', borderTopLeftRadius: 32, borderTopRightRadius: 32, borderWidth: 1, borderColor: 'rgba(196,196,196,0.32)', backgroundColor: '#FFFFFF', padding: 24, paddingBottom: 48 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(196,196,196,0.3)' },
  statsHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  statsAvatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: 'rgba(44,124,150,0.12)', borderWidth: 1.5, borderColor: 'rgba(44,124,150,0.3)', alignItems: 'center', justifyContent: 'center' },
  statsAvatarText: { fontFamily: 'Inter-Bold', fontSize: 26, color: '#2C7C96' },
  statsName: { fontFamily: 'Inter-Bold', fontSize: 18, color: '#22271F', marginBottom: 6 },
  tierBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  tierText: { fontFamily: 'Inter-SemiBold', fontSize: 12 },
  rankNum: { fontFamily: 'Inter-Black', fontSize: 28, color: '#22271F', letterSpacing: -1 },
  statBarsWrapper: { backgroundColor: 'rgba(196,196,196,0.12)', borderRadius: 18, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)' },
  barLabel: { fontFamily: 'Inter-Medium', fontSize: 13, color: 'rgba(34,39,31,0.6)' },
  barVal: { fontFamily: 'Inter-Bold', fontSize: 13 },
  barTrack: { height: 8, backgroundColor: 'rgba(196,196,196,0.16)', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4 },
  nextTierBox: { backgroundColor: 'rgba(196,196,196,0.12)', borderRadius: 14, padding: 14, marginBottom: 18, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)' },
  nextTierLabel: { fontFamily: 'Inter-Medium', fontSize: 13, color: 'rgba(34,39,31,0.4)' },
  nextTierVal: { fontFamily: 'Inter-SemiBold', fontSize: 14, color: '#22271F' },
  badgeRow: { flexDirection: 'row', gap: 10 },
  badge: { flex: 1, borderRadius: 16, borderWidth: 1, backgroundColor: 'rgba(196,196,196,0.12)', padding: 14, alignItems: 'center', gap: 4 },
  badgeNum: { fontFamily: 'Inter-Bold', fontSize: 20, letterSpacing: -0.5 },
  badgeLbl: { fontFamily: 'Inter-Regular', fontSize: 11, color: 'rgba(34,39,31,0.4)' },

  // Edit modal
  emailHelp: { fontFamily: 'Inter-Regular', fontSize: 13, color: 'rgba(34,39,31,0.55)', marginBottom: 14, lineHeight: 19 },
  emailBackTxt: { fontFamily: 'Inter-SemiBold', fontSize: 13, color: 'rgba(34,39,31,0.5)' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontFamily: 'Inter-Bold', fontSize: 20, color: '#22271F', letterSpacing: -0.3 },
  sCloseBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(196,196,196,0.22)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.26)', alignItems: 'center', justifyContent: 'center' },
  saveCTA: { backgroundColor: colors.platinum, borderRadius: 16, paddingVertical: 14, alignItems: 'center', marginTop: 4 },
  saveCTAText: { fontFamily: 'Inter-Bold', fontSize: 15, color: colors.base },

  // QR modal
  qrBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  qrTitle: { fontFamily: 'Inter-Bold', fontSize: 20, color: '#22271F', letterSpacing: -0.3 },
  qrSub: { fontFamily: 'Inter-Regular', fontSize: 13, color: 'rgba(34,39,31,0.5)', textAlign: 'center', marginTop: 6, lineHeight: 19 },
  qrPanel: { backgroundColor: '#F7F8F8', borderRadius: 20, padding: 14, marginVertical: 18 },
  qrName: { fontFamily: 'Inter-Bold', fontSize: 17, color: '#22271F' },
  qrRole: { fontFamily: 'Inter-Medium', fontSize: 13, color: 'rgba(34,39,31,0.5)', marginTop: 2 },
});
