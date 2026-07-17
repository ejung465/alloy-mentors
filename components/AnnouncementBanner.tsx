import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { useUser } from '@/contexts/UserContext';

// Cap how many undismissed announcements stack up on the home screen —
// newest first, at most this many at once.
const MAX_VISIBLE = 3;
// Set of dismissed announcement ids, persisted so a user never sees the same
// broadcast again after reading it once (replaces the old single-id key).
const DISMISSED_KEY = 'alloy.dismissedAnnouncementIds';

async function loadDismissedIds(): Promise<Set<string>> {
  try {
    const raw = await AsyncStorage.getItem(DISMISSED_KEY);
    if (raw) return new Set(JSON.parse(raw));
    // Migrate the legacy single-id key if present, so a previously-dismissed
    // announcement stays dismissed after this update.
    const legacy = await AsyncStorage.getItem('dismissed_announcement_id');
    return legacy ? new Set([legacy]) : new Set();
  } catch {
    return new Set();
  }
}

async function saveDismissedIds(ids: Set<string>) {
  try {
    await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)));
  } catch {
    // best-effort — a failed write just means it may show again later
  }
}

export default function AnnouncementBanner() {
  const { profile } = useUser();
  const orgId = profile?.organization_id ?? null;
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [visible, setVisible] = useState(false);
  const opacity = useState(new Animated.Value(0))[0];

  useEffect(() => {
    if (!orgId) return;
    fetchLatest();

    // Subscribe to new announcements for THIS org only
    const channel = supabase
      .channel('public:announcements')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements', filter: `organization_id=eq.${orgId}` }, () => {
        fetchLatest();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId]);

  const fetchLatest = async () => {
    if (!orgId) return;
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: false })
      .limit(MAX_VISIBLE * 3); // fetch a little extra headroom past dismissed ones

    if (!data) return;

    const dismissed = await loadDismissedIds();
    const unread = data.filter((a) => !dismissed.has(a.id)).slice(0, MAX_VISIBLE);

    if (unread.length > 0) {
      setAnnouncements(unread);
      setVisible(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    } else {
      setAnnouncements([]);
      setVisible(false);
    }
  };

  const dismiss = async (id: string) => {
    const dismissed = await loadDismissedIds();
    dismissed.add(id);
    await saveDismissedIds(dismissed);

    setAnnouncements((prev) => {
      const next = prev.filter((a) => a.id !== id);
      if (next.length === 0) {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setVisible(false));
      }
      return next;
    });
  };

  if (!visible || announcements.length === 0) return null;

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      {announcements.map((announcement) => {
        const urgency = announcement.urgency as 'info' | 'warning' | 'emergency';
        const bgStyles = {
          info: styles.infoBanner,
          warning: styles.warningBanner,
          emergency: styles.emergencyBanner,
        }[urgency];
        const iconName = ({
          info: 'information-circle',
          warning: 'warning',
          emergency: 'alert-circle',
        }[urgency] ?? 'information-circle') as any;
        const iconColor = {
          info: '#2C7C96',
          warning: '#B08A3E',
          emergency: '#B15A4E',
        }[urgency];

        return (
          <View key={announcement.id} style={[styles.banner, bgStyles]}>
            <View style={styles.content}>
              <View style={styles.iconWrap}>
                <Ionicons name={iconName} size={20} color={iconColor} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.title}>{announcement.title}</Text>
                <Text style={styles.message}>{announcement.message}</Text>
              </View>
              <TouchableOpacity onPress={() => dismiss(announcement.id)} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color="rgba(34,39,31,0.5)" />
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 8,
    width: '100%',
    gap: 10,
  },
  banner: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 14,
    marginBottom: 12,
  },
  infoBanner: {
    backgroundColor: 'rgba(44,124,150,0.12)', // Pine tint
    borderColor: 'rgba(44,124,150,0.30)',
  },
  warningBanner: {
    backgroundColor: 'rgba(176,138,62,0.14)', // Ochre tint
    borderColor: 'rgba(176,138,62,0.40)',
  },
  emergencyBanner: {
    backgroundColor: 'rgba(177,90,78,0.14)', // Clay tint
    borderColor: 'rgba(177,90,78,0.45)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: 'rgba(196,196,196,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'Inter-Bold',
    fontSize: 14,
    color: '#22271F',
    marginBottom: 2,
  },
  message: {
    fontFamily: 'Inter-Regular',
    fontSize: 13,
    color: 'rgba(34,39,31,0.8)',
    lineHeight: 18,
  },
  closeBtn: {
    padding: 4,
    marginLeft: 8,
  },
});
