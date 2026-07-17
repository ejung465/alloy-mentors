import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { featureEnabled } from '@/lib/features';
import { isStudent } from '@/lib/roles';

const PINE = '#165B74';
const PINE_MID = '#2C7C96';
const CLAY = '#C5642D';
const INK = '#22271F';

type Audience = 'all' | 'students' | 'mentors' | 'specific';

type Resource = {
  id: string;
  title: string;
  description: string | null;
  file_url: string;
  shared_by: string | null;
  audience: Audience;
  audience_user_ids: string[];
  created_at: string;
};

type Member = { id: string; full_name: string; role: string };

const AUDIENCE_META: Record<Audience, { label: string; icon: string }> = {
  all: { label: 'Everyone', icon: 'people-outline' },
  students: { label: 'Students', icon: 'school-outline' },
  mentors: { label: 'Mentors', icon: 'ribbon-outline' },
  specific: { label: 'Specific people', icon: 'person-outline' },
};

function fileIconFor(url: string): string {
  const u = url.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|heic)(\?|$)/.test(u)) return 'image-outline';
  if (/\.pdf(\?|$)/.test(u)) return 'document-text-outline';
  if (/\.(docx?|pages)(\?|$)/.test(u)) return 'document-outline';
  if (/\.(xlsx?|csv|numbers)(\?|$)/.test(u)) return 'grid-outline';
  if (/\.(pptx?|key)(\?|$)/.test(u)) return 'easel-outline';
  return 'attach-outline';
}

export default function ResourcesScreen() {
  const router = useRouter();
  const { profile, org } = useUser();
  const enabled = featureEnabled(org, 'resource_sharing');
  const canUpload = !isStudent(profile?.role);

  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Upload modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [picked, setPicked] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [audience, setAudience] = useState<Audience>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [uploading, setUploading] = useState(false);

  const fetchResources = useCallback(async () => {
    if (!org?.id) { setLoading(false); return; }
    const { data } = await supabase
      .from('resources')
      .select('*')
      .eq('organization_id', org.id)
      .order('created_at', { ascending: false });
    setResources((data as Resource[]) ?? []);
    setLoading(false);
  }, [org?.id]);

  useEffect(() => { if (enabled) fetchResources(); else setLoading(false); }, [enabled, fetchResources]);

  const onRefresh = async () => { setRefreshing(true); await fetchResources(); setRefreshing(false); };

  const openUpload = async () => {
    // Preload org members for the "specific people" picker.
    if (org?.id && members.length === 0) {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, role')
        .eq('organization_id', org.id)
        .order('full_name');
      setMembers((data as Member[]) ?? []);
    }
    setPicked(null);
    setTitle('');
    setDescription('');
    setAudience('all');
    setSelectedIds([]);
    setModalOpen(true);
  };

  const pickFile = async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (res.canceled || !res.assets?.length) return;
    const asset = res.assets[0];
    setPicked(asset);
    if (!title.trim()) setTitle(asset.name.replace(/\.[^.]+$/, ''));
  };

  const toggleMember = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const submit = async () => {
    if (!picked || !org?.id || !profile?.id) return;
    if (!title.trim()) { Alert.alert('Title required', 'Give this resource a title.'); return; }
    if (audience === 'specific' && selectedIds.length === 0) {
      Alert.alert('Pick people', 'Select at least one person, or choose a different audience.');
      return;
    }
    setUploading(true);
    try {
      // Upload the file into the public `resources` storage bucket.
      const resp = await fetch(picked.uri);
      const arrayBuffer = await resp.arrayBuffer();
      const safeName = picked.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${org.id}/${Date.now()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('resources')
        .upload(path, arrayBuffer, {
          contentType: picked.mimeType || 'application/octet-stream',
          upsert: false,
        });
      if (upErr) { Alert.alert('Upload failed', upErr.message); setUploading(false); return; }

      const publicUrl = supabase.storage.from('resources').getPublicUrl(path).data.publicUrl;

      const { error: insErr } = await supabase.from('resources').insert({
        organization_id: org.id,
        title: title.trim(),
        description: description.trim() || null,
        file_url: publicUrl,
        shared_by: profile.id,
        audience,
        audience_user_ids: audience === 'specific' ? selectedIds : [],
      });
      if (insErr) { Alert.alert('Could not share', insErr.message); setUploading(false); return; }

      setModalOpen(false);
      await fetchResources();
    } catch (e: any) {
      Alert.alert('Something went wrong', e?.message ?? 'Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const openResource = async (r: Resource) => {
    try { await Linking.openURL(r.file_url); }
    catch { Alert.alert('Could not open', 'No app on this device can open that file.'); }
  };

  // ── Feature-disabled state ────────────────────────────────────────────────
  if (!enabled) {
    return (
      <SafeAreaView style={styles.screen}>
        <AuroraBackground />
        <Header onBack={() => router.back()} onUpload={undefined} canUpload={false} />
        <View style={styles.centered}>
          <Ionicons name="folder-open-outline" size={40} color={colors.textFaint} />
          <Text style={styles.emptyTitle}>Resource sharing is off</Text>
          <Text style={styles.emptyBody}>This module isn’t enabled for your organization. A leader can turn it on in org settings.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <AuroraBackground />
      <Header onBack={() => router.back()} onUpload={canUpload ? openUpload : undefined} canUpload={canUpload} />

      {loading ? (
        <View style={styles.centered}><ActivityIndicator size="large" color={PINE} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={INK} />}
        >
          {resources.length === 0 ? (
            <View style={styles.centered}>
              <Ionicons name="documents-outline" size={40} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>No resources yet</Text>
              <Text style={styles.emptyBody}>
                {canUpload ? 'Tap the + to share a worksheet, PDF, or lesson material.' : 'Lesson materials shared with you will appear here.'}
              </Text>
            </View>
          ) : (
            resources.map((r) => {
              const am = AUDIENCE_META[r.audience];
              return (
                <TouchableOpacity key={r.id} style={styles.card} activeOpacity={0.85} onPress={() => openResource(r)}>
                  <View style={styles.fileIcon}>
                    <Ionicons name={fileIconFor(r.file_url) as any} size={20} color={PINE} />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.cardTitle} numberOfLines={1}>{r.title}</Text>
                    {r.description ? <Text style={styles.cardDesc} numberOfLines={2}>{r.description}</Text> : null}
                    <View style={styles.metaRow}>
                      <View style={styles.audChip}>
                        <Ionicons name={am.icon as any} size={11} color={PINE_MID} />
                        <Text style={styles.audChipTxt}>{am.label}</Text>
                      </View>
                      <Text style={styles.dateTxt}>{new Date(r.created_at).toLocaleDateString()}</Text>
                    </View>
                  </View>
                  <Ionicons name="open-outline" size={18} color={colors.textFaint} />
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>
      )}

      {/* ── Upload modal ─────────────────────────────────────────────────── */}
      <Modal visible={modalOpen} transparent animationType="slide" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalScrim}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.sheetTitle}>Share a resource</Text>

              <TouchableOpacity style={styles.pickBtn} onPress={pickFile} activeOpacity={0.85}>
                <Ionicons name={picked ? 'checkmark-circle' : 'cloud-upload-outline'} size={20} color={picked ? PINE_MID : PINE} />
                <Text style={styles.pickBtnTxt} numberOfLines={1}>{picked ? picked.name : 'Choose a file'}</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>Title</Text>
              <TextInput
                style={styles.input}
                value={title}
                onChangeText={setTitle}
                placeholder="e.g. Algebra worksheet 3"
                placeholderTextColor={colors.textGhost}
              />

              <Text style={styles.fieldLabel}>Description (optional)</Text>
              <TextInput
                style={[styles.input, { height: 72, textAlignVertical: 'top' }]}
                value={description}
                onChangeText={setDescription}
                placeholder="A short note about this material"
                placeholderTextColor={colors.textGhost}
                multiline
              />

              <Text style={styles.fieldLabel}>Who can see it</Text>
              <View style={styles.segment}>
                {(Object.keys(AUDIENCE_META) as Audience[]).map((a) => {
                  const active = audience === a;
                  return (
                    <TouchableOpacity
                      key={a}
                      style={[styles.segItem, active && styles.segItemActive]}
                      onPress={() => setAudience(a)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.segTxt, active && styles.segTxtActive]}>{AUDIENCE_META[a].label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {audience === 'specific' && (
                <View style={styles.memberList}>
                  {members.map((m) => {
                    const on = selectedIds.includes(m.id);
                    const initials = m.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
                    return (
                      <TouchableOpacity key={m.id} style={styles.memberRow} onPress={() => toggleMember(m.id)} activeOpacity={0.8}>
                        <View style={styles.memberAvatar}><Text style={styles.memberAvatarTxt}>{initials || '?'}</Text></View>
                        <Text style={styles.memberName} numberOfLines={1}>{m.full_name}</Text>
                        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? PINE_MID : colors.textGhost} />
                      </TouchableOpacity>
                    );
                  })}
                  {members.length === 0 && <Text style={styles.emptyBody}>No other members found.</Text>}
                </View>
              )}

              <TouchableOpacity
                style={[styles.submitBtn, (!picked || uploading) && { opacity: 0.5 }]}
                onPress={submit}
                disabled={!picked || uploading}
                activeOpacity={0.9}
              >
                {uploading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitTxt}>Share resource</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalOpen(false)} disabled={uploading}>
                <Text style={styles.cancelTxt}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Header({ onBack, onUpload, canUpload }: { onBack: () => void; onUpload?: () => void; canUpload: boolean }) {
  return (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} style={styles.iconBtn}>
        <Ionicons name="chevron-back" size={20} color={INK} />
      </TouchableOpacity>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.eyebrow}>LIBRARY</Text>
        <Text style={styles.title}>Resources</Text>
      </View>
      {canUpload && onUpload && (
        <TouchableOpacity onPress={onUpload} style={styles.addBtn} activeOpacity={0.85}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: font.bold, fontSize: 11, color: PINE_MID, letterSpacing: 2.5 },
  title: { fontFamily: font.black, fontSize: 28, color: PINE, letterSpacing: -1, marginTop: 2 },
  addBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: PINE, alignItems: 'center', justifyContent: 'center' },

  scroll: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 60, flexGrow: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, paddingVertical: 80 },
  emptyTitle: { fontFamily: font.bold, fontSize: 17, color: INK, marginTop: 14 },
  emptyBody: { fontFamily: font.regular, fontSize: 13.5, color: colors.textDim, textAlign: 'center', marginTop: 6, lineHeight: 19 },

  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: 16, padding: 14, marginBottom: 10 },
  fileIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(22,91,116,0.10)', alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontFamily: font.semibold, fontSize: 15, color: INK },
  cardDesc: { fontFamily: font.regular, fontSize: 12.5, color: colors.textDim, marginTop: 2, lineHeight: 17 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 7 },
  audChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(44,124,150,0.10)', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  audChipTxt: { fontFamily: font.semibold, fontSize: 10.5, color: PINE_MID },
  dateTxt: { fontFamily: font.regular, fontSize: 11, color: colors.textFaint },

  modalScrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.base, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 28, maxHeight: '90%' },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.hairlineStrong, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontFamily: font.black, fontSize: 22, color: PINE, letterSpacing: -0.5, marginBottom: 16 },

  pickBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, borderRadius: 14, paddingVertical: 16, paddingHorizontal: 16, marginBottom: 4 },
  pickBtnTxt: { flex: 1, fontFamily: font.semibold, fontSize: 14.5, color: INK },

  fieldLabel: { fontFamily: font.bold, fontSize: 11.5, color: colors.textDim, letterSpacing: 0.5, marginTop: 16, marginBottom: 7, textTransform: 'uppercase' },
  input: { backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: font.regular, fontSize: 15, color: INK },

  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  segItem: { borderWidth: 1, borderColor: colors.hairlineStrong, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, backgroundColor: colors.surfaceStrong },
  segItemActive: { backgroundColor: PINE, borderColor: PINE },
  segTxt: { fontFamily: font.semibold, fontSize: 13, color: colors.textDim },
  segTxtActive: { color: '#fff' },

  memberList: { marginTop: 12, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairline, borderRadius: 12, overflow: 'hidden' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  memberAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: PINE, alignItems: 'center', justifyContent: 'center' },
  memberAvatarTxt: { fontFamily: font.bold, fontSize: 11.5, color: '#fff' },
  memberName: { flex: 1, fontFamily: font.medium, fontSize: 14, color: INK },

  submitBtn: { backgroundColor: CLAY, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 22 },
  submitTxt: { fontFamily: font.bold, fontSize: 15.5, color: '#fff' },
  cancelBtn: { alignItems: 'center', paddingVertical: 14 },
  cancelTxt: { fontFamily: font.semibold, fontSize: 14, color: colors.textDim },
});
