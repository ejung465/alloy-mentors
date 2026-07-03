import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { buildStudentReportHtml, buildGuardianDigestHtml } from '@/lib/reports';
import { featureEnabled } from '@/lib/features';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font, radius } from '@/lib/theme';
import { useUser } from '@/contexts/UserContext';
import { canCreateEvents } from '@/lib/roles';
import { getActiveSession } from '@/lib/checkin';
import {
  listGoals, activeGoal, createGoal, listSkills, upsertSkill, listTimeline, logProgress,
  getStudentById, listLinkableAccounts, getAccountById, linkStudentAccount,
  SKILL_LEVELS, type StudentGoal, type StudentSkill, type TimelineEntry, type Marker, type StudentAccount,
} from '@/lib/progress';

const PINE_DEEP = '#0E3E4F';
const PINE = '#165B74';
const PINE_MID = '#2C7C96';
const CREAM = '#F4F6F6';
const CLAY = '#B15A4E';
const OCHRE = '#B08A3E';
const INK = '#22271F';

const MARKERS: { key: Marker; label: string; color: string; icon: any }[] = [
  { key: 'breakthrough', label: 'Breakthrough', color: PINE_MID, icon: 'sparkles' },
  { key: 'progress', label: 'Steady progress', color: OCHRE, icon: 'trending-up' },
  { key: 'struggled', label: 'Found it tricky', color: CLAY, icon: 'help-buoy-outline' },
];
const markerMeta = (m: Marker | null) =>
  MARKERS.find((x) => x.key === m) ?? { key: 'milestone' as Marker, label: 'Milestone', color: 'rgba(196,196,196,0.35)', icon: 'flag' };

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
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

function InfoRow({ icon, label, value, color = colors.silver }: { icon: any; label: string; value?: string | null; color?: string }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <View style={[styles.infoIcon, { backgroundColor: `${color}1A` }]}>
        <Ionicons name={icon} size={15} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

export default function StudentProgressScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { profile, org } = useUser();
  const elevated = canCreateEvents(profile?.role);
  const orgId = profile?.organization_id ?? null;

  const [loading, setLoading] = useState(true);
  const [student, setStudent] = useState<any | null>(null);
  const [goals, setGoals] = useState<StudentGoal[]>([]);
  const [skills, setSkills] = useState<StudentSkill[]>([]);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Log-session modal
  const [logOpen, setLogOpen] = useState(false);
  const [logTitle, setLogTitle] = useState('');
  const [logBody, setLogBody] = useState('');
  const [logMarker, setLogMarker] = useState<Marker | null>(null);
  const [logAdvance, setLogAdvance] = useState(true);
  const [saving, setSaving] = useState(false);

  // Goal + skill modals
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalSubject, setGoalSubject] = useState('');
  const [skillOpen, setSkillOpen] = useState(false);
  const [skillName, setSkillName] = useState('');

  // Account ↔ roster linking (coordinators)
  const [linkedAccount, setLinkedAccount] = useState<StudentAccount | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkable, setLinkable] = useState<StudentAccount[]>([]);

  const goal = activeGoal(goals);

  const load = useCallback(async () => {
    if (!id) return;
    const [st, g, sk, tl] = await Promise.all([
      getStudentById(id), listGoals(id), listSkills(id), listTimeline(id),
    ]);
    setStudent(st); setGoals(g); setSkills(sk); setTimeline(tl);
    setLinkedAccount(st?.user_id ? await getAccountById(st.user_id) : null);
    setLoading(false);
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useFocusEffect(useCallback(() => { getActiveSession().then(({ data }) => setSessionId(data?.id ?? null)); }, []));

  const submitLog = async () => {
    if (!id || !logBody.trim()) { Alert.alert('Add a note', 'Tell us what you worked on this session.'); return; }
    if (!profile?.id) { Alert.alert('Still loading', 'Your profile is loading — try again in a moment.'); return; }
    setSaving(true);
    const { error } = await logProgress({
      studentId: id, content: logBody, title: logTitle, marker: logMarker,
      goal: goal, advanceGoal: !!goal && logAdvance, sessionId,
      authorId: profile.id, authorName: profile.full_name ?? (org?.memberNoun || 'Tutor'),
    });
    setSaving(false);
    if (error) { Alert.alert("Couldn't save", error.message); return; }
    setLogOpen(false); setLogTitle(''); setLogBody(''); setLogMarker(null); setLogAdvance(true);
    load();
  };

  const submitGoal = async () => {
    if (!id || !goalTitle.trim()) { Alert.alert('Name the goal', 'Give the goal a short title.'); return; }
    const { error } = await createGoal({ studentId: id, orgId, title: goalTitle, subject: goalSubject, createdBy: profile?.id });
    if (error) { Alert.alert("Couldn't create goal", error.message); return; }
    setGoalOpen(false); setGoalTitle(''); setGoalSubject(''); load();
  };

  const submitSkill = async () => {
    if (!id || !skillName.trim()) return;
    const { error } = await upsertSkill({ studentId: id, orgId, name: skillName, level: 1, updatedBy: profile?.id });
    if (error) { Alert.alert("Couldn't add skill", error.message); return; }
    setSkillOpen(false); setSkillName(''); load();
  };

  const cycleSkill = async (s: StudentSkill) => {
    if (!elevated || !id) return;
    await upsertSkill({ studentId: id, orgId, name: s.name, level: (s.level + 1) % 4, updatedBy: profile?.id });
    load();
  };

  const openLinkPicker = async () => {
    if (!linkedAccount) {
      setLinkable(await listLinkableAccounts(orgId));
      setLinkOpen(true);
      return;
    }
    Alert.alert(
      'Linked account',
      `${name} is linked to ${linkedAccount.full_name} (${linkedAccount.email}). They see this progress in their app.`,
      [
        { text: 'Close', style: 'cancel' },
        {
          text: 'Unlink', style: 'destructive',
          onPress: async () => {
            const { error } = await linkStudentAccount(id!, null);
            if (error) Alert.alert("Couldn't unlink", error.message);
            else load();
          },
        },
      ]
    );
  };

  const doLink = async (account: StudentAccount) => {
    const { error } = await linkStudentAccount(id!, account.id);
    setLinkOpen(false);
    if (error) { Alert.alert("Couldn't link", error.message); return; }
    load();
  };

  const [exporting, setExporting] = useState(false);
  const reportInput = () => ({
    orgName: org?.name || 'Alloy Mentors',
    memberNoun: org?.memberNoun || 'Tutor',
    student, goals, skills, timeline,
    today: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
  });
  const shareHtml = async (html: string) => {
    const { uri } = await Print.printToFileAsync({ html });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { UTI: '.pdf', mimeType: 'application/pdf' });
    } else {
      Alert.alert('Saved', 'The PDF was generated but sharing is unavailable on this device.');
    }
  };
  const exportReport = async () => {
    if (!student) return;
    setExporting(true);
    try { await shareHtml(buildStudentReportHtml(reportInput())); }
    catch (e: any) { Alert.alert("Couldn't export", e?.message ?? 'Try again.'); }
    finally { setExporting(false); }
  };
  const sendGuardianUpdate = async () => {
    if (!student) return;
    setExporting(true);
    try { await shareHtml(buildGuardianDigestHtml(reportInput())); }
    catch (e: any) { Alert.alert("Couldn't build update", e?.message ?? 'Try again.'); }
    finally { setExporting(false); }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <AuroraBackground />
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator color={PINE} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  const name = student?.full_name ?? 'Student';
  const initials = name.split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase();
  const age = ageFrom(student?.birthday);
  const hasAllergy = student?.allergies && String(student.allergies).toLowerCase() !== 'none';
  const goalPct = goal ? Math.round((goal.completed_checkpoints / goal.target_checkpoints) * 100) : 0;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AuroraBackground />

      {/* Top bar */}
      <View style={styles.topbar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={INK} />
        </TouchableOpacity>
        <Text style={styles.eyebrow}>STUDENT</Text>
        <TouchableOpacity onPress={exportReport} style={styles.iconBtn} disabled={exporting}>
          {exporting ? <ActivityIndicator size="small" color={PINE} /> : <Ionicons name="share-outline" size={20} color={INK} />}
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        {/* Identity */}
        <View style={styles.identityRow}>
          {student?.photo_url ? (
            <Image source={{ uri: student.photo_url }} style={styles.avatar} contentFit="cover" />
          ) : (
            <View style={styles.avatar}><Text style={styles.avatarTxt}>{initials || '?'}</Text></View>
          )}
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={styles.name}>{name}</Text>
            <Text style={styles.identitySub}>
              {[student?.grade, student?.school].filter(Boolean).join(' · ') || 'Student'}
            </Text>
          </View>
        </View>

        {hasAllergy ? (
          <View style={styles.safetyPill}>
            <Ionicons name="warning-outline" size={14} color="#8f3f36" />
            <Text style={styles.safetyTxt}>Allergy: {student.allergies}</Text>
          </View>
        ) : null}

        {/* Current goal */}
        {goal ? (
          <View style={styles.goalCard}>
            <View style={styles.goalBlob} />
            <View style={styles.goalHead}>
              <Text style={styles.goalEyebrow}>CURRENT GOAL</Text>
              <View style={styles.onTrackChip}><Text style={styles.onTrackTxt}>{goalPct >= 100 ? 'ACHIEVED' : 'ON TRACK'}</Text></View>
            </View>
            <Text style={styles.goalTitle}>{goal.title}</Text>
            <View style={styles.goalTrack}>
              <View style={[styles.goalFill, { width: `${Math.max(goalPct, 3)}%` }]} />
            </View>
            <Text style={styles.goalMeta}>
              {goal.completed_checkpoints} of {goal.target_checkpoints} checkpoints
              {goal.subject ? ` · ${goal.subject}` : ''}
            </Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.setGoalBtn}
            activeOpacity={0.85}
            onPress={() => (elevated ? setGoalOpen(true) : Alert.alert('Ask a coordinator', 'Only coordinators can set learning goals.'))}
          >
            <Ionicons name="flag-outline" size={18} color={PINE} />
            <Text style={styles.setGoalTxt}>{elevated ? 'Set a learning goal' : 'No goal set yet'}</Text>
          </TouchableOpacity>
        )}

        {/* Skills */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionTitle}>Skills</Text>
          {elevated && (
            <TouchableOpacity onPress={() => setSkillOpen(true)} hitSlop={8}>
              <Text style={styles.addLink}>+ Add</Text>
            </TouchableOpacity>
          )}
        </View>
        {skills.length === 0 ? (
          <Text style={styles.emptyLine}>No skills tracked yet{elevated ? ' — add one to start the map.' : '.'}</Text>
        ) : (
          <View style={styles.skillGrid}>
            {skills.map((s) => (
              <TouchableOpacity key={s.id} style={styles.skillCard} activeOpacity={elevated ? 0.7 : 1} onPress={() => cycleSkill(s)}>
                <Text style={styles.skillName}>{s.name}</Text>
                {s.level >= 3 ? (
                  <View style={styles.skillMastered}>
                    <Ionicons name="checkmark-circle" size={14} color={PINE_MID} />
                    <Text style={styles.skillMasteredTxt}>Mastered</Text>
                  </View>
                ) : (
                  <View style={styles.skillDots}>
                    {[0, 1, 2].map((i) => (
                      <View key={i} style={[styles.skillDot, i < s.level && { backgroundColor: PINE }]} />
                    ))}
                    <Text style={styles.skillLevelTxt}>{SKILL_LEVELS[s.level]}</Text>
                  </View>
                )}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Growth timeline */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Growth timeline</Text>
        {timeline.length === 0 ? (
          <Text style={styles.emptyLine}>No sessions logged yet. Log the first one after you tutor.</Text>
        ) : (
          <View style={styles.timeline}>
            <View style={styles.timelineRail} />
            {timeline.map((t) => {
              const m = markerMeta(t.marker);
              return (
                <View key={t.id} style={styles.tlEntry}>
                  <View style={[styles.tlDot, { backgroundColor: m.color }]} />
                  <View style={{ flex: 1 }}>
                    <View style={styles.tlHead}>
                      <Text style={styles.tlTitle}>{t.title || (t.marker ? m.label : 'Session note')}</Text>
                      <Text style={styles.tlDate}>{fmtDate(t.created_at)}</Text>
                    </View>
                    <Text style={styles.tlBody}>{t.content}</Text>
                    {t.author_name ? <Text style={styles.tlAuthor}>— {t.author_name}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        )}

        {/* Details (kept, but secondary to progress) */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Details</Text>
        <View style={styles.detailsCard}>
          <InfoRow icon="calendar-outline" label="Age" value={age ? `${age} years` : null} />
          <InfoRow icon="language-outline" label="Home language" value={student?.language} color="#7A7A7A" />
          <InfoRow icon="chatbubbles-outline" label="English level" value={student?.english_level} color="#7A7A7A" />
          <InfoRow icon="car-outline" label="Transportation" value={student?.transportation} />
          <InfoRow icon="people-outline" label="Guardian" value={[student?.guardian_name, student?.guardian_relationship].filter(Boolean).join(' · ') || null} color={OCHRE} />
          <InfoRow icon="call-outline" label="Guardian phone" value={student?.guardian_phone} color={OCHRE} />
          <InfoRow icon="alert-circle-outline" label="Emergency contact" value={[student?.emergency_contact_name, student?.emergency_contact_phone].filter(Boolean).join(' · ') || null} color={CLAY} />
          {elevated && (student?.medical_notes || student?.country_of_origin) ? (
            <>
              <Text style={styles.restrictedLabel}>Restricted · coordinators only</Text>
              <InfoRow icon="medical-outline" label="Medical notes" value={student?.medical_notes} color={CLAY} />
              <InfoRow icon="earth-outline" label="Country of origin" value={student?.country_of_origin} color={colors.steel} />
            </>
          ) : null}
        </View>

        {elevated && (
          <TouchableOpacity style={styles.linkRow} activeOpacity={0.85} onPress={openLinkPicker}>
            <View style={[styles.linkIcon, linkedAccount && { backgroundColor: 'rgba(44,124,150,0.15)', borderColor: 'rgba(44,124,150,0.35)' }]}>
              <Ionicons name={linkedAccount ? 'link' : 'link-outline'} size={16} color={linkedAccount ? PINE_MID : 'rgba(34,39,31,0.45)'} />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.linkLabel}>App account</Text>
              <Text style={[styles.linkValue, !linkedAccount && { color: 'rgba(34,39,31,0.45)' }]}>
                {linkedAccount ? `${linkedAccount.full_name} · ${linkedAccount.email}` : 'Not linked — tap to connect their login'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color="rgba(34,39,31,0.3)" />
          </TouchableOpacity>
        )}

        {featureEnabled(org, 'guardian_digests') && (student?.guardian_name || student?.guardian_phone || student?.guardian_email) ? (
          <TouchableOpacity style={styles.guardianBtn} activeOpacity={0.85} onPress={sendGuardianUpdate} disabled={exporting}>
            <Ionicons name="mail-outline" size={16} color={PINE_MID} />
            <Text style={styles.guardianBtnTxt}>Send {String(student?.guardian_name || 'guardian').split(' ')[0]} a progress update</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {/* Sticky log CTA */}
      <View style={styles.footer}>
        <TouchableOpacity style={styles.logCta} activeOpacity={0.9} onPress={() => setLogOpen(true)}>
          <Ionicons name="create-outline" size={19} color={CREAM} />
          <Text style={styles.logCtaTxt}>Log today's session</Text>
        </TouchableOpacity>
      </View>

      {/* ── Link account picker ── */}
      <Modal visible={linkOpen} transparent animationType="slide">
        <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.scrim }]} onPress={() => setLinkOpen(false)}>
          <View style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
            <Pressable onPress={(e: any) => e.stopPropagation()}>
              <View style={styles.sheet}>
                <View style={styles.sheetHandle} />
                <Text style={styles.sheetTitle}>Link {name.split(' ')[0]}'s account</Text>
                <Text style={styles.linkHelp}>
                  Pick the login this {org?.studentNoun?.toLowerCase() || 'student'} signs in with. Once linked, they'll see this progress — and only this — in their own app.
                </Text>
                <ScrollView style={{ maxHeight: 340 }} showsVerticalScrollIndicator={false}>
                  {linkable.length === 0 ? (
                    <Text style={styles.linkEmpty}>
                      No unlinked {org?.studentNounPlural?.toLowerCase() || 'student'} accounts yet. Ask them to join with the {org?.studentNoun?.toLowerCase() || 'student'} code first.
                    </Text>
                  ) : (
                    linkable.map((a) => (
                      <TouchableOpacity key={a.id} style={styles.linkAccountRow} activeOpacity={0.8} onPress={() => doLink(a)}>
                        <View style={styles.linkAvatar}>
                          <Text style={styles.linkAvatarTxt}>{a.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</Text>
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                          <Text style={styles.linkAccountName}>{a.full_name}</Text>
                          <Text style={styles.linkAccountEmail}>{a.email}</Text>
                        </View>
                        <Ionicons name="add-circle-outline" size={20} color={PINE_MID} />
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setLinkOpen(false)}>
                  <Text style={styles.cancelTxt}>Cancel</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* ── Log session modal ── */}
      <Modal visible={logOpen} transparent animationType="slide">
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.scrim }]}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>Log session · {name.split(' ')[0]}</Text>

              <Text style={styles.fieldLabel}>HEADLINE (OPTIONAL)</Text>
              <TextInput style={styles.input} placeholder="e.g. Regrouping finally clicked!" placeholderTextColor={colors.textGhost} value={logTitle} onChangeText={setLogTitle} />

              <Text style={styles.fieldLabel}>WHAT DID YOU WORK ON?</Text>
              <TextInput style={[styles.input, { minHeight: 84, textAlignVertical: 'top' }]} placeholder="A sentence or two on what you covered and how it went." placeholderTextColor={colors.textGhost} value={logBody} onChangeText={setLogBody} multiline />

              <Text style={styles.fieldLabel}>HOW'D IT GO?</Text>
              <View style={styles.markerRow}>
                {MARKERS.map((m) => {
                  const on = logMarker === m.key;
                  return (
                    <TouchableOpacity key={m.key} onPress={() => setLogMarker(on ? null : m.key)}
                      style={[styles.markerChip, on && { backgroundColor: `${m.color}1f`, borderColor: m.color }]}>
                      <Ionicons name={m.icon} size={14} color={on ? m.color : colors.textFaint} />
                      <Text style={[styles.markerTxt, on && { color: m.color }]}>{m.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {goal && (
                <TouchableOpacity style={styles.checkpointRow} onPress={() => setLogAdvance((v) => !v)} activeOpacity={0.8}>
                  <View style={[styles.checkbox, logAdvance && styles.checkboxOn]}>
                    {logAdvance && <Ionicons name="checkmark" size={14} color={CREAM} />}
                  </View>
                  <Text style={styles.checkpointTxt}>Mark a checkpoint toward “{goal.title}”</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity style={[styles.saveBtn, (saving || !logBody.trim()) && { opacity: 0.5 }]} disabled={saving || !logBody.trim()} onPress={submitLog}>
                <Text style={styles.saveTxt}>{saving ? 'Saving…' : 'Save to timeline'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setLogOpen(false)}>
                <Text style={styles.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Set goal modal ── */}
      <Modal visible={goalOpen} transparent animationType="slide">
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.scrim }]}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>New learning goal</Text>
            <Text style={styles.fieldLabel}>GOAL</Text>
            <TextInput style={styles.input} placeholder="e.g. Double-digit multiplication" placeholderTextColor={colors.textGhost} value={goalTitle} onChangeText={setGoalTitle} />
            <Text style={styles.fieldLabel}>SUBJECT (OPTIONAL)</Text>
            <TextInput style={styles.input} placeholder="e.g. Math" placeholderTextColor={colors.textGhost} value={goalSubject} onChangeText={setGoalSubject} />
            <TouchableOpacity style={[styles.saveBtn, !goalTitle.trim() && { opacity: 0.5 }]} disabled={!goalTitle.trim()} onPress={submitGoal}>
              <Text style={styles.saveTxt}>Set goal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setGoalOpen(false)}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Add skill modal ── */}
      <Modal visible={skillOpen} transparent animationType="slide">
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.scrim }]}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Track a skill</Text>
            <Text style={styles.fieldLabel}>SKILL NAME</Text>
            <TextInput style={styles.input} placeholder="e.g. Reading comprehension" placeholderTextColor={colors.textGhost} value={skillName} onChangeText={setSkillName} />
            <Text style={styles.hint}>Tip: tap a skill card to move it Learning → Practicing → Mastered.</Text>
            <TouchableOpacity style={[styles.saveBtn, !skillName.trim() && { opacity: 0.5 }]} disabled={!skillName.trim()} onPress={submitSkill}>
              <Text style={styles.saveTxt}>Add skill</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancelBtn} onPress={() => setSkillOpen(false)}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: font.bold, fontSize: 11, color: PINE_MID, letterSpacing: 2 },

  identityRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, marginBottom: 12 },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: PINE, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.bold, fontSize: 22, color: CREAM },
  name: { fontFamily: font.black, fontSize: 26, color: INK, letterSpacing: -0.8 },
  identitySub: { fontFamily: font.regular, fontSize: 13.5, color: 'rgba(34,39,31,0.55)', marginTop: 2 },

  safetyPill: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(177,90,78,0.12)', borderWidth: 1, borderColor: 'rgba(177,90,78,0.3)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 18 },
  safetyTxt: { fontFamily: font.semibold, fontSize: 12, color: '#8f3f36' },

  goalCard: { overflow: 'hidden', backgroundColor: PINE_DEEP, borderRadius: 18, padding: 18, marginBottom: 22 },
  goalBlob: { position: 'absolute', top: -50, right: -40, width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(245,239,227,0.06)' },
  goalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  goalEyebrow: { fontFamily: font.bold, fontSize: 10.5, color: 'rgba(245,239,227,0.6)', letterSpacing: 2 },
  onTrackChip: { backgroundColor: 'rgba(245,239,227,0.16)', borderRadius: 20, paddingHorizontal: 9, paddingVertical: 4 },
  onTrackTxt: { fontFamily: font.bold, fontSize: 10.5, color: CREAM, letterSpacing: 0.5 },
  goalTitle: { fontFamily: font.bold, fontSize: 19, color: CREAM, marginTop: 8 },
  goalTrack: { height: 7, backgroundColor: 'rgba(245,239,227,0.18)', borderRadius: 4, overflow: 'hidden', marginTop: 14 },
  goalFill: { height: '100%', backgroundColor: CREAM, borderRadius: 4 },
  goalMeta: { fontFamily: font.regular, fontSize: 12, color: 'rgba(245,239,227,0.7)', marginTop: 8 },

  setGoalBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.18)', borderRadius: 16, paddingVertical: 16, marginBottom: 22 },
  setGoalTxt: { fontFamily: font.semibold, fontSize: 14.5, color: PINE },

  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionTitle: { fontFamily: font.semibold, fontSize: 12, color: 'rgba(34,39,31,0.5)', letterSpacing: 1.2, textTransform: 'uppercase' },
  addLink: { fontFamily: font.bold, fontSize: 13, color: PINE_MID },
  emptyLine: { fontFamily: font.regular, fontSize: 13, color: 'rgba(34,39,31,0.42)', marginBottom: 4 },

  skillGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  skillCard: { width: '48.5%', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 12, padding: 12 },
  skillName: { fontFamily: font.semibold, fontSize: 13.5, color: INK },
  skillMastered: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  skillMasteredTxt: { fontFamily: font.medium, fontSize: 11.5, color: PINE_MID },
  skillDots: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  skillDot: { width: 22, height: 4, borderRadius: 2, backgroundColor: 'rgba(196,196,196,0.15)' },
  skillLevelTxt: { fontFamily: font.medium, fontSize: 10.5, color: 'rgba(34,39,31,0.45)', marginLeft: 4 },

  timeline: { position: 'relative', paddingLeft: 26, marginTop: 4 },
  timelineRail: { position: 'absolute', left: 7, top: 6, bottom: 14, width: 2, backgroundColor: 'rgba(196,196,196,0.14)' },
  tlEntry: { flexDirection: 'row', marginBottom: 16 },
  tlDot: { position: 'absolute', left: -26, top: 2, width: 16, height: 16, borderRadius: 8, borderWidth: 3, borderColor: colors.base },
  tlHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  tlTitle: { fontFamily: font.semibold, fontSize: 14, color: INK, flex: 1, marginRight: 8 },
  tlDate: { fontFamily: font.regular, fontSize: 11.5, color: 'rgba(34,39,31,0.45)' },
  tlBody: { fontFamily: font.regular, fontSize: 13, color: 'rgba(34,39,31,0.62)', lineHeight: 19, marginTop: 3 },
  tlAuthor: { fontFamily: font.medium, fontSize: 11.5, color: 'rgba(34,39,31,0.4)', marginTop: 4 },

  detailsCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 9 },
  infoIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  infoLabel: { fontFamily: font.medium, fontSize: 11, color: 'rgba(34,39,31,0.4)', textTransform: 'uppercase', letterSpacing: 0.6 },
  infoValue: { fontFamily: font.medium, fontSize: 15, color: INK, marginTop: 2 },
  restrictedLabel: { fontFamily: font.semibold, fontSize: 11, color: colors.steel, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 12, marginBottom: 2, marginLeft: 4 },

  guardianBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, backgroundColor: 'rgba(44,124,150,0.10)', borderWidth: 1, borderColor: 'rgba(44,124,150,0.28)', borderRadius: 14, paddingVertical: 14 },
  guardianBtnTxt: { fontFamily: font.semibold, fontSize: 14, color: PINE_MID },

  linkRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 14, padding: 13, marginTop: 14 },
  linkIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(196,196,196,0.08)', borderWidth: 1, borderColor: 'rgba(196,196,196,0.18)', alignItems: 'center', justifyContent: 'center' },
  linkLabel: { fontFamily: font.medium, fontSize: 11, color: 'rgba(34,39,31,0.4)', textTransform: 'uppercase', letterSpacing: 0.8 },
  linkValue: { fontFamily: font.medium, fontSize: 13.5, color: INK, marginTop: 2 },
  linkHelp: { fontFamily: font.regular, fontSize: 13, color: 'rgba(34,39,31,0.55)', lineHeight: 19, marginBottom: 14 },
  linkEmpty: { fontFamily: font.regular, fontSize: 13.5, color: 'rgba(34,39,31,0.45)', textAlign: 'center', paddingVertical: 26, lineHeight: 20 },
  linkAccountRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 14, padding: 12, marginBottom: 8 },
  linkAvatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: PINE, alignItems: 'center', justifyContent: 'center' },
  linkAvatarTxt: { fontFamily: font.bold, fontSize: 13, color: CREAM },
  linkAccountName: { fontFamily: font.semibold, fontSize: 14.5, color: INK },
  linkAccountEmail: { fontFamily: font.regular, fontSize: 12, color: 'rgba(34,39,31,0.5)', marginTop: 1 },

  footer: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 28, borderTopWidth: 1, borderTopColor: 'rgba(196,196,196,0.10)', backgroundColor: colors.base },
  logCta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: PINE, borderRadius: 16, paddingVertical: 16 },
  logCtaTxt: { fontFamily: font.bold, fontSize: 15, color: CREAM },

  // Sheets
  sheet: { marginTop: 'auto', maxHeight: '90%', backgroundColor: colors.surfaceStrong, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: 'rgba(196,196,196,0.18)', padding: 22, paddingTop: 12 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(196,196,196,0.2)', alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontFamily: font.bold, fontSize: 20, color: INK, letterSpacing: -0.3, marginBottom: 16 },
  fieldLabel: { fontFamily: font.semibold, fontSize: 11, color: colors.silver, letterSpacing: 1, marginBottom: 8, marginTop: 12 },
  input: { fontFamily: font.medium, fontSize: 15, color: INK, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12 },
  hint: { fontFamily: font.regular, fontSize: 12, color: 'rgba(34,39,31,0.45)', marginTop: 10, lineHeight: 17 },
  markerRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  markerChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', backgroundColor: colors.surface },
  markerTxt: { fontFamily: font.medium, fontSize: 12.5, color: colors.textDim },
  checkpointRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  checkbox: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: 'rgba(196,196,196,0.3)', alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: PINE, borderColor: PINE },
  checkpointTxt: { flex: 1, fontFamily: font.medium, fontSize: 13.5, color: INK },
  saveBtn: { backgroundColor: PINE, borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
  saveTxt: { fontFamily: font.bold, fontSize: 15, color: CREAM },
  cancelBtn: { alignItems: 'center', paddingVertical: 14, marginBottom: 8 },
  cancelTxt: { fontFamily: font.semibold, fontSize: 14, color: 'rgba(34,39,31,0.5)' },
});
