import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Linking, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { GlassCard } from '@/components/ui/GlassCard';
import { GlassInput } from '@/components/ui/GlassInput';
import { colors, font } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/contexts/UserContext';

const PINE = '#165B74';
const INK = '#22271F';
const SUPPORT_EMAIL = 'support@alloymentors.com';

export default function ContactSupportScreen() {
  const router = useRouter();
  const { profile } = useUser();

  const [name, setName] = useState(profile?.full_name || '');
  const [email, setEmail] = useState(profile?.email || '');
  const [phone, setPhone] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const openMail = () =>
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() =>
      Alert.alert('No mail app found', `Reach us at ${SUPPORT_EMAIL}`)
    );

  const canSubmit = name.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && message.trim().length > 0;

  const handleSubmit = async () => {
    if (!canSubmit || busy) return;
    setBusy(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('support_requests').insert({
        user_id: user?.id ?? null,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim() || null,
        message: message.trim(),
      });
      if (error) throw error;
      setSubmitted(true);
    } catch (e: any) {
      Alert.alert("Couldn't send", e?.message ?? 'Please try again, or email us directly.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <AuroraBackground variant="iris" />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} activeOpacity={0.8}>
          <Ionicons name="chevron-back" size={22} color={INK} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Contact Support</Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

          <TouchableOpacity onPress={openMail} activeOpacity={0.75} style={styles.mailPill}>
            <Ionicons name="mail-outline" size={16} color={PINE} />
            <Text style={styles.mailPillText}>{SUPPORT_EMAIL}</Text>
          </TouchableOpacity>

          {submitted ? (
            <GlassCard style={styles.confirmCard}>
              <View style={styles.confirmIcon}>
                <Ionicons name="checkmark-circle" size={36} color="#41785C" />
              </View>
              <Text style={styles.confirmTitle}>We got it, we'll get back to you soon</Text>
              <Text style={styles.confirmSub}>
                Thanks for reaching out — the Alloy Mentors team typically replies within a couple of
                business days.
              </Text>
              <TouchableOpacity onPress={() => router.back()} style={styles.doneBtn} activeOpacity={0.85}>
                <Text style={styles.doneBtnText}>Done</Text>
              </TouchableOpacity>
            </GlassCard>
          ) : (
            <GlassCard>
              <Text style={styles.formIntro}>
                Send us a message and we'll get back to you at the email you provide.
              </Text>
              <View style={{ gap: 14 }}>
                <GlassInput label="Name" placeholder="Your name" value={name} onChangeText={setName} autoCapitalize="words" />
                <GlassInput label="Email" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                <GlassInput label="Phone (optional)" placeholder="(555) 555-5555" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
                <GlassInput
                  label="How can we help?"
                  placeholder="Tell us what's going on…"
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={5}
                  style={{ minHeight: 120, textAlignVertical: 'top', paddingTop: 14 }}
                />
                <TouchableOpacity
                  onPress={handleSubmit}
                  disabled={!canSubmit || busy}
                  style={[styles.submitBtn, (!canSubmit || busy) && { opacity: 0.55 }]}
                  activeOpacity={0.85}
                >
                  <Text style={styles.submitBtnText}>{busy ? 'Sending…' : 'Submit'}</Text>
                </TouchableOpacity>
              </View>
            </GlassCard>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
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

  mailPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    backgroundColor: 'rgba(22,91,116,0.1)', borderWidth: 1, borderColor: 'rgba(22,91,116,0.28)',
    paddingHorizontal: 14, paddingVertical: 9, borderRadius: 14, marginBottom: 20,
  },
  mailPillText: { fontFamily: font.semibold, fontSize: 13.5, color: PINE },

  formIntro: { fontFamily: font.regular, fontSize: 13.5, color: colors.textDim, lineHeight: 20, marginBottom: 16 },
  submitBtn: { backgroundColor: colors.platinum, borderRadius: 16, paddingVertical: 15, alignItems: 'center', marginTop: 4 },
  submitBtnText: { fontFamily: font.bold, fontSize: 15, color: colors.base },

  confirmCard: { alignItems: 'center', paddingVertical: 32 },
  confirmIcon: { marginBottom: 14 },
  confirmTitle: { fontFamily: font.bold, fontSize: 18, color: INK, textAlign: 'center', letterSpacing: -0.3, marginBottom: 8, paddingHorizontal: 10 },
  confirmSub: { fontFamily: font.regular, fontSize: 13.5, color: colors.textDim, textAlign: 'center', lineHeight: 20, marginBottom: 22, paddingHorizontal: 10 },
  doneBtn: { backgroundColor: colors.platinum, borderRadius: 16, paddingVertical: 13, paddingHorizontal: 32 },
  doneBtnText: { fontFamily: font.bold, fontSize: 14.5, color: colors.base },
});
