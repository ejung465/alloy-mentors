import React, { useRef, useState } from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  View, TouchableOpacity, Text, Animated,
  StyleSheet, Modal, Pressable
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MeshGradient } from '@/components/ui/MeshGradient';
import { colors, alloyGradient } from '@/lib/theme';
import { useUser } from '@/contexts/UserContext';
import { canCreateEvents } from '@/lib/roles';
import { featureEnabled, type FeatureKey } from '@/lib/features';

// ── Individual tab button – own component so useRef is legal ──────
function TabButton({
  route, isFocused, onPress,
}: { route: any; isFocused: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const pIn  = () => Animated.spring(scale, { toValue: 0.8,  useNativeDriver: true, tension: 300, friction: 10 }).start();
  const pOut = () => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, tension: 300, friction: 10 }).start();

  const icons: Record<string, [string, string]> = {
    index:    ['home',         'home-outline'],
    calendar: ['calendar',    'calendar-outline'],
    chat:     ['chatbubbles', 'chatbubbles-outline'],
    profile:  ['person',      'person-outline'],
  };
  const [on, off] = icons[route.name] ?? ['ellipse', 'ellipse-outline'];

  return (
    <Pressable
      onPressIn={pIn} onPressOut={pOut} onPress={onPress}
      style={styles.tabBtn}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
        <Ionicons name={(isFocused ? on : off) as any} size={24}
          color={isFocused ? colors.platinum : 'rgba(34,39,31,0.4)'} />
        {isFocused && <View style={styles.dot} />}
      </Animated.View>
    </Pressable>
  );
}

// ── Custom Tab Bar ────────────────────────────────────────────────
function CustomTabBar({ state, navigation }: any) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, org } = useUser();
  const [fabOpen, setFabOpen] = useState(false);

  const elevated = canCreateEvents(profile?.role);
  const isStudent = profile?.role === 'student';

  const ALL_FAB_OPTIONS = [
    { icon: 'person-outline',           label: 'My Student',         color: colors.silver,   action: () => router.push('/my-pairing'),             elevatedOnly: false, memberOnly: true },
    { icon: 'people-outline',           label: 'Student Roster',     color: colors.silver,   action: () => router.push('/students'),               elevatedOnly: false, memberOnly: true },
    { icon: 'qr-code-outline',          label: 'My Check-In QR',     color: colors.silver,   action: () => router.push('/my-qr'),                  elevatedOnly: false, memberOnly: true, feature: 'checkin' as FeatureKey },
    { icon: 'checkmark-circle-outline', label: 'RSVP to Session',    color: colors.silver,   action: () => router.push({ pathname: '/(tabs)/calendar', params: { rsvp: '1' } }), elevatedOnly: false },
    { icon: 'time-outline',             label: 'Log Hours',          color: colors.silver,   action: () => router.push('/modal'),                  elevatedOnly: false, memberOnly: true, feature: 'hours' as FeatureKey },
    { icon: 'person-add-outline',       label: 'Add Student',        color: colors.silver,   action: () => router.push('/add-student'),            elevatedOnly: false, memberOnly: true },
    { icon: 'clipboard-outline',        label: 'Start Check-In',     color: colors.platinum, action: () => router.push('/kiosk'),                   elevatedOnly: true, feature: 'checkin' as FeatureKey },
    { icon: 'calendar-outline',         label: 'Create Event',       color: colors.platinum, action: () => router.push({ pathname: '/(tabs)/calendar', params: { add: '1' } }),  elevatedOnly: true },
    { icon: 'megaphone-outline',        label: 'Announcement',       color: colors.platinum, action: () => router.push({ pathname: '/(tabs)', params: { compose: '1' } }),       elevatedOnly: true },
  ];
  // Three gates: role elevation, student-facing menus stay lean, and org feature toggles.
  const FAB_OPTIONS = ALL_FAB_OPTIONS.filter((o: any) =>
    (elevated || !o.elevatedOnly) &&
    (!isStudent || !o.memberOnly) &&
    (!o.feature || featureEnabled(org, o.feature))
  );

  const handle = (action: () => void) => { setFabOpen(false); setTimeout(action, 50); };

  const left  = state.routes.slice(0, 2);
  const right = state.routes.slice(2, 4);

  return (
    // Floating bar: absolutely positioned so it overlays the scene instead of
    // reserving a white band. Tab screens pad their scroll content to clear it.
    <View style={[styles.outer, { paddingBottom: Math.max(insets.bottom, 10) }]}>

      {/* ── FAB popup – rendered as a Modal so it escapes all clipping ── */}
      <Modal visible={fabOpen} transparent animationType="fade" statusBarTranslucent>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setFabOpen(false)}>
          <BlurView intensity={45} tint="light" style={StyleSheet.absoluteFillObject} />
          <View style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(30,36,28,0.16)' }]} />
        </Pressable>
        {FAB_OPTIONS.map((opt, i) => (
          <View key={opt.label} style={[styles.fabOption, { bottom: 110 + i * 68 }]}>
            <TouchableOpacity onPress={() => handle(opt.action)} style={styles.fabRow} activeOpacity={0.85}>
              <BlurView intensity={55} tint="light" style={StyleSheet.absoluteFillObject} />
              <View style={[styles.fabIcon, { backgroundColor: `${opt.color}25`, borderColor: `${opt.color}50` }]}>
                <Ionicons name={opt.icon as any} size={17} color={opt.color} />
              </View>
              <Text style={[styles.fabLabel, { color: opt.color }]}>{opt.label}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </Modal>

      {/* ── The pill ─── */}
      <View style={styles.pill}>
        <BlurView intensity={35} tint="light" style={StyleSheet.absoluteFillObject} />

        <View style={styles.row}>
          {left.map((route: any, i: number) => (
            <TabButton key={route.key} route={route}
              isFocused={state.index === i}
              onPress={() => { if (state.index !== i) navigation.navigate(route.name); }}
            />
          ))}

          {/* ── Centre FAB ── */}
          <View style={styles.centre}>
            <View style={styles.divider} />
            <TouchableOpacity onPress={() => setFabOpen(true)} style={styles.plusBtn} activeOpacity={0.85}>
              <MeshGradient colors={alloyGradient} intensity={14} />
              {/* Always shows + (no rotation) */}
              <Ionicons name="add" size={26} color={colors.base} />
            </TouchableOpacity>
            <View style={styles.divider} />
          </View>

          {right.map((route: any, i: number) => (
            <TabButton key={route.key} route={route}
              isFocused={state.index === i + 2}
              onPress={() => { if (state.index !== i + 2) navigation.navigate(route.name); }}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs tabBar={(props) => <CustomTabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="calendar" />
      <Tabs.Screen name="chat" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const H = 68;
const styles = StyleSheet.create({
  // Floats OVER the scene (absolute) so there's no reserved white band around it.
  // Tab screens pad their scroll content at the bottom so nothing hides behind it.
  outer: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: 'transparent',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  pill: {
    height: H,
    borderRadius: 34,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(43,70,56,0.18)',
    backgroundColor: 'rgba(251,246,236,0.94)',
    shadowColor: '#2B3325',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 14,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: H, paddingHorizontal: 8 },
  tabBtn: { flex: 1, height: H, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', bottom: -8, width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.platinum },
  centre: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  divider: { width: 1, height: 26, backgroundColor: 'rgba(43,70,56,0.15)', marginHorizontal: 8 },
  plusBtn: {
    width: 46, height: 46, borderRadius: 23,
    overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(43,70,56,0.35)',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#375946', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.35, shadowRadius: 12,
  },
  // FAB popup styles (rendered inside Modal, absolute from screen bottom)
  fabOption: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  fabRow: {
    overflow: 'hidden', borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(43,70,56,0.26)',
    backgroundColor: '#FFFDF7',
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 13,
    gap: 12, minWidth: 220,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 14,
  },
  fabIcon: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  fabLabel: { fontFamily: 'Inter-SemiBold', fontSize: 14 },
});
