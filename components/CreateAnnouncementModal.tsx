import React, { useState } from 'react';
import { 
  View, Text, StyleSheet, Modal, Pressable,
  TouchableOpacity, ScrollView, Alert, 
  ActivityIndicator, KeyboardAvoidingView, Platform
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { useUser } from '@/contexts/UserContext';
import { GlassCard } from './ui/GlassCard';
import { GlassInput } from './ui/GlassInput';
import { GlassButton } from './ui/GlassButton';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type Urgency = 'info' | 'warning' | 'emergency';

export default function CreateAnnouncementModal({ visible, onClose, onSuccess }: Props) {
  const { profile } = useUser();
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [urgency, setUrgency] = useState<Urgency>('info');
  const [loading, setLoading] = useState(false);

  const handlePost = async () => {
    if (!title || !message) {
      Alert.alert('Error', 'Please fill in both title and message.');
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user found');

      const { error } = await supabase.from('announcements').insert({
        title,
        message,
        urgency,
        created_by: user.id,
        organization_id: profile?.organization_id ?? null,
      });

      if (error) throw error;

      Alert.alert('Success', 'Announcement posted successfully!');
      setTitle('');
      setMessage('');
      setUrgency('info');
      onSuccess();
      onClose();
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const UrgencyOption = ({ type, label, color }: { type: Urgency, label: string, color: string }) => (
    <TouchableOpacity 
      onPress={() => setUrgency(type)}
      style={[
        styles.urgencyBtn, 
        urgency === type && { backgroundColor: `${color}20`, borderColor: color }
      ]}
    >
      <Ionicons 
        name={urgency === type ? "radio-button-on" : "radio-button-off"} 
        size={18} 
        color={urgency === type ? color : 'rgba(34,39,31,0.3)'}
      />
      <Text style={[styles.urgencyLabel, urgency === type && { color: color }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide">
      {/* SOLID dim scrim — not a BlurView — so it never composites-muddy with
          the GlassCard's own blur (the nested-blur bug). */}
      <Pressable style={[StyleSheet.absoluteFillObject, { backgroundColor: colors.scrim }]} onPress={onClose}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalContent}
          pointerEvents="box-none"
        >
          <Pressable onPress={(e: any) => e.stopPropagation()}>
          <GlassCard style={styles.card} contentStyle={{ padding: 24 }}>
            <View style={styles.header}>
              <Text style={styles.modalTitle}>Broadcast Message</Text>
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Ionicons name="close" size={20} color="#22271F" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ marginBottom: 20 }}>
                <GlassInput 
                  label="Announcement Title"
                  placeholder="e.g., Session Rescheduled"
                  value={title}
                  onChangeText={setTitle}
                />
              </View>

              <View style={{ marginBottom: 20 }}>
                <GlassInput 
                  label="Message Content"
                  placeholder="Describe the update or emergency..."
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  style={{ height: 100, paddingTop: 15 }}
                />
              </View>

              <Text style={styles.subLabel}>Urgency Level</Text>
              <View style={styles.urgencyRow}>
                <UrgencyOption type="info" label="Info" color="#4C7A61" />
                <UrgencyOption type="warning" label="Warning" color="#B08A3E" />
                <UrgencyOption type="emergency" label="Urgent" color="#B15A4E" />
              </View>

              <View style={{ marginTop: 24 }}>
                <GlassButton 
                  title={loading ? "Posting..." : "Post Announcement"} 
                  onPress={handlePost}
                  disabled={loading}
                />
              </View>
            </ScrollView>
          </GlassCard>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalContent: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    maxHeight: '85%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontFamily: 'Inter-Bold',
    fontSize: 22,
    color: '#22271F',
    letterSpacing: -0.5,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(43,70,56,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subLabel: {
    fontFamily: 'Inter-Medium',
    fontSize: 12,
    color: 'rgba(76,122,97,0.9)',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 12,
    marginLeft: 4,
  },
  urgencyRow: {
    flexDirection: 'row',
    gap: 8,
  },
  urgencyBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(43,70,56,0.15)',
    backgroundColor: 'rgba(43,70,56,0.05)',
  },
  urgencyLabel: {
    fontFamily: 'Inter-SemiBold',
    fontSize: 13,
    color: 'rgba(34,39,31,0.4)',
  },
});
