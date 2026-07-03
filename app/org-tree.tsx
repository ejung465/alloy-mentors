import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';
import { roleLabel, roleColor } from '@/lib/roles';

const PINE = '#165B74';
const PINE_MID = '#2C7C96';
const CREAM = '#F4F6F6';
const INK = '#22271F';
const RAIL = 'rgba(196,196,196,0.16)';

type Member = {
  id: string;
  full_name: string;
  role: string;
  director_subject: string | null;
  school: string | null;
};

/** Hierarchy tiers, top to bottom. Members/students resolve via fallthrough. */
const TIERS: { roles: string[]; label: (noun: string) => string }[] = [
  { roles: ['admin'], label: () => 'Admins' },
  { roles: ['president'], label: () => 'President' },
  { roles: ['vp'], label: () => 'Vice Presidents' },
  { roles: ['director'], label: () => 'Directors' },
  { roles: ['member', 'mentor'], label: (noun) => noun },
  { roles: ['student'], label: () => 'Students' },
];

function PersonRow({ m, isSelf, noun, last }: { m: Member; isSelf: boolean; noun?: string | null; last: boolean }) {
  const initials = m.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const rc = roleColor(m.role);
  return (
    <View style={styles.personRow}>
      {/* connector */}
      <View style={styles.connectorCol}>
        <View style={[styles.railV, last && { height: 22 }]} />
        <View style={styles.railH} />
      </View>
      <View style={styles.personCard}>
        <View style={styles.avatar}><Text style={styles.avatarTxt}>{initials || '?'}</Text></View>
        <View style={{ flex: 1, marginLeft: 11 }}>
          <Text style={styles.personName}>
            {m.full_name}{isSelf ? <Text style={styles.youTag}>  (You)</Text> : null}
          </Text>
          {m.school ? <Text style={styles.personSub} numberOfLines={1}>{m.school}</Text> : null}
        </View>
        <View style={[styles.roleChip, { backgroundColor: `${rc}1f`, borderColor: `${rc}55` }]}>
          <Text style={[styles.roleChipTxt, { color: rc }]}>{roleLabel(m.role, m.director_subject, noun)}</Text>
        </View>
      </View>
    </View>
  );
}

export default function OrgTreeScreen() {
  const router = useRouter();
  const { profile, org } = useUser();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      if (!profile?.organization_id) { setLoading(false); return; }
      const { data } = await supabase
        .from('users')
        .select('id, full_name, role, director_subject, school')
        .eq('organization_id', profile.organization_id)
        .order('full_name');
      setMembers((data as Member[]) ?? []);
      setLoading(false);
    })();
  }, [profile?.organization_id]);

  const noun = org?.memberNounPlural || 'Tutors';
  const tiers = TIERS.map((t) => ({
    label: t.label(noun),
    people: members.filter((m) => t.roles.includes(m.role)),
  })).filter((t) => t.people.length > 0);

  return (
    <SafeAreaView style={styles.screen}>
      <AuroraBackground />
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>ORGANIZATION</Text>
          <Text style={styles.title}>{org?.name || 'Your org'}</Text>
          <Text style={styles.subtitle}>{members.length} people</Text>
        </View>
        <TouchableOpacity onPress={() => router.back()} style={styles.closeBtn}>
          <Ionicons name="close" size={20} color={INK} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={PINE} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {tiers.map((tier, ti) => (
            <View key={tier.label}>
              {/* tier header */}
              <View style={styles.tierHead}>
                {ti > 0 && <View style={styles.tierRail} />}
                <View style={styles.tierPill}>
                  <Text style={styles.tierPillTxt}>{tier.label.toUpperCase()}</Text>
                  <View style={styles.countDot}><Text style={styles.countTxt}>{tier.people.length}</Text></View>
                </View>
              </View>
              {tier.people.map((m, i) => (
                <PersonRow key={m.id} m={m} isSelf={m.id === profile?.id} noun={org?.memberNoun} last={i === tier.people.length - 1} />
              ))}
            </View>
          ))}
          {tiers.length === 0 && (
            <Text style={styles.empty}>No members found.</Text>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6 },
  eyebrow: { fontFamily: font.bold, fontSize: 11, color: PINE_MID, letterSpacing: 2.5 },
  title: { fontFamily: font.black, fontSize: 30, color: PINE, letterSpacing: -1, marginTop: 4 },
  subtitle: { fontFamily: font.regular, fontSize: 13, color: 'rgba(34,39,31,0.5)', marginTop: 2 },
  closeBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 60 },

  tierHead: { marginTop: 6 },
  tierRail: { width: 2, height: 18, backgroundColor: RAIL, marginLeft: 15 },
  tierPill: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: 'rgba(44,124,150,0.10)', borderWidth: 1, borderColor: 'rgba(44,124,150,0.25)', borderRadius: 20, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  tierPillTxt: { fontFamily: font.bold, fontSize: 11, color: PINE_MID, letterSpacing: 1.2 },
  countDot: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: PINE_MID, alignItems: 'center', justifyContent: 'center' },
  countTxt: { fontFamily: font.bold, fontSize: 11.5, color: CREAM },

  personRow: { flexDirection: 'row' },
  connectorCol: { width: 34, alignItems: 'flex-start' },
  railV: { position: 'absolute', left: 15, top: 0, bottom: 0, width: 2, backgroundColor: RAIL },
  railH: { position: 'absolute', left: 15, top: 22, width: 17, height: 2, backgroundColor: RAIL },

  personCard: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 12, marginVertical: 5 },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: PINE, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontFamily: font.bold, fontSize: 13, color: CREAM },
  personName: { fontFamily: font.semibold, fontSize: 14.5, color: INK },
  youTag: { fontFamily: font.medium, fontSize: 12, color: PINE_MID },
  personSub: { fontFamily: font.regular, fontSize: 12, color: 'rgba(34,39,31,0.45)', marginTop: 1 },
  roleChip: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4, marginLeft: 8 },
  roleChipTxt: { fontFamily: font.semibold, fontSize: 10.5 },

  empty: { fontFamily: font.regular, fontSize: 14, color: 'rgba(34,39,31,0.45)', textAlign: 'center', marginTop: 60 },
});
