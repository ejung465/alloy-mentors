import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BlurView } from 'expo-blur';
import { useUser } from '@/contexts/UserContext';

export default function AnnouncementBanner() {
  const { profile } = useUser();
  const orgId = profile?.organization_id ?? null;
  const [announcement, setAnnouncement] = useState<any>(null);
  const [visible, setVisible] = useState(false);
  const opacity = useState(new Animated.Value(0))[0];

  useEffect(() => {
    if (!orgId) return;
    fetchLatest();

    // Subscribe to new announcements for THIS org only
    const channel = supabase
      .channel('public:announcements')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements', filter: `organization_id=eq.${orgId}` }, (payload) => {
        checkDismissedAndShow(payload.new);
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
      .limit(1)
      .maybeSingle();

    if (data) {
      checkDismissedAndShow(data);
    }
  };

  const checkDismissedAndShow = async (item: any) => {
    const dismissedId = await AsyncStorage.getItem('dismissed_announcement_id');
    if (dismissedId !== item.id) {
      setAnnouncement(item);
      setVisible(true);
      Animated.timing(opacity, {
        toValue: 1,
        duration: 400,
        useNativeDriver: true,
      }).start();
    }
  };

  const dismiss = async () => {
    if (announcement) {
      await AsyncStorage.setItem('dismissed_announcement_id', announcement.id);
      Animated.timing(opacity, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }).start(() => setVisible(false));
    }
  };

  if (!visible || !announcement) return null;

  const bgStyles = {
    info: styles.infoBanner,
    warning: styles.warningBanner,
    emergency: styles.emergencyBanner,
  }[announcement.urgency as 'info' | 'warning' | 'emergency'];

  const iconName = {
    info: 'information-circle',
    warning: 'warning',
    emergency: 'alert-circle',
  }[announcement.urgency as 'info' | 'warning' | 'emergency'] as any;

  const iconColor = {
    info: '#4C7A61',
    warning: '#B08A3E',
    emergency: '#B15A4E',
  }[announcement.urgency as 'info' | 'warning' | 'emergency'];

  return (
    <Animated.View style={[styles.container, { opacity }]}>
      <View style={[styles.banner, bgStyles]}>
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <Ionicons name={iconName} size={20} color={iconColor} />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.title}>{announcement.title}</Text>
            <Text style={styles.message}>{announcement.message}</Text>
          </View>
          <TouchableOpacity onPress={dismiss} style={styles.closeBtn}>
            <Ionicons name="close" size={18} color="rgba(34,39,31,0.5)" />
          </TouchableOpacity>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 20,
    width: '100%',
  },
  banner: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: 'hidden',
    padding: 14,
  },
  infoBanner: {
    backgroundColor: 'rgba(62,106,82,0.12)', // Pine tint
    borderColor: 'rgba(62,106,82,0.30)',
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
    backgroundColor: 'rgba(43,70,56,0.1)',
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
