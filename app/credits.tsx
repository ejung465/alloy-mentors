import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { GlassCard } from '@/components/ui/GlassCard';
import { colors, font } from '@/lib/theme';

const PINE = '#165B74';
const INK = '#22271F';

const WEBSITE = 'https://jpx.co';
const PHONE = '+1 (224) 724-9020';
const EMAIL = 'contact@jpxco.dev';

function InfoRow({ icon, label, value, onPress, last = false }: {
  icon: any; label: string; value: string; onPress: () => void; last?: boolean;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      style={[styles.row, !last && styles.rowBorder]}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={PINE} />
      </View>
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowValue}>{value}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="rgba(34,39,31,0.25)" />
    </TouchableOpacity>
  );
}

export default function CreditsScreen() {
  const router = useRouter();

  const openURL = (url: string) =>
    Linking.openURL(url).catch(() => Alert.alert('Could not open link', url));

  return (
    <SafeAreaView style={styles.screen}>
      <AuroraBackground variant="iris" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.8}>
          <Ionicons name="chevron-back" size={22} color={INK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Credits</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <GlassCard style={styles.heroCard}>
          <View style={styles.mark}>
            <Text style={styles.markText}>JPX</Text>
          </View>
          <Text style={styles.studioName}>JPX Software Development co.</Text>
          <Text style={styles.bio}>
            JPX Software Development co. is a self-run software studio led by a single founder.
            It builds small, focused tools designed to do one job well — Alloy Mentors is one of them.
            Every line of this app was written with that same philosophy: keep it simple, keep it useful.
          </Text>
        </GlassCard>

        <Text style={styles.sectionLabel}>GET IN TOUCH</Text>
        <GlassCard style={{ marginBottom: 24 }} contentStyle={{ padding: 0 }}>
          <InfoRow icon="globe-outline" label="Website" value={WEBSITE.replace('https://', '')} onPress={() => openURL(WEBSITE)} />
          <InfoRow icon="mail-outline" label="Email" value={EMAIL} onPress={() => openURL(`mailto:${EMAIL}`)} />
          <InfoRow icon="call-outline" label="Phone" value={PHONE} onPress={() => openURL(`tel:${PHONE.replace(/[^\d+]/g, '')}`)} last />
        </GlassCard>

        <Text style={styles.footer}>
          Thanks for using Alloy Mentors. Questions about the app itself? Use Contact Support from your
          profile — this page is just for saying hello to the team behind it.
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

  heroCard: { alignItems: 'center', paddingVertical: 28, marginBottom: 28 },
  mark: {
    width: 60, height: 60, borderRadius: 18, backgroundColor: 'rgba(22,91,116,0.1)',
    borderWidth: 1.5, borderColor: 'rgba(22,91,116,0.28)', alignItems: 'center', justifyContent: 'center',
    marginBottom: 14,
  },
  markText: { fontFamily: font.black, fontSize: 18, color: PINE, letterSpacing: 0.5 },
  studioName: { fontFamily: font.bold, fontSize: 19, color: INK, textAlign: 'center', letterSpacing: -0.3, marginBottom: 10 },
  bio: { fontFamily: font.regular, fontSize: 14, color: colors.textDim, textAlign: 'center', lineHeight: 21, paddingHorizontal: 6 },

  sectionLabel: {
    fontFamily: font.medium, fontSize: 11.5, color: 'rgba(34,39,31,0.35)',
    letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, marginLeft: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 15 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: 'rgba(196,196,196,0.2)' },
  rowIcon: {
    width: 38, height: 38, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(22,91,116,0.3)',
    backgroundColor: 'rgba(22,91,116,0.1)', alignItems: 'center', justifyContent: 'center',
  },
  rowLabel: { fontFamily: font.semibold, fontSize: 15, color: INK },
  rowValue: { fontFamily: font.regular, fontSize: 12, color: colors.textFaint, marginTop: 2 },

  footer: { fontFamily: font.regular, fontSize: 12, color: colors.textGhost, lineHeight: 18, marginTop: 8, textAlign: 'center' },
});
