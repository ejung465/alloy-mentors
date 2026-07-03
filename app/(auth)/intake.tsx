import React, { useMemo, useState } from 'react';
import {
  View, Text, KeyboardAvoidingView, Platform, ScrollView, StyleSheet,
  TouchableOpacity, TextInput, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { GlassInput } from '@/components/ui/GlassInput';
import { GlassButton } from '@/components/ui/GlassButton';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { BrandMark } from '@/components/ui/Brand';
import { colors, font, radius } from '@/lib/theme';
import {
  SUBJECTS, DAYS, TIMES, TSHIRTS, TRANSPORT, VOLUNTEER_CONSENTS, CONSENT_DISCLAIMER,
  sendEmailOtp, verifyEmailOtp, completeVolunteerIntake, ageFromBirthday,
} from '@/lib/intake';

type Phase = 'email' | 'otp' | 'form';

// ── Reusable multi-select chip group ─────────────────────────────────────────
function Chips({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <View style={styles.chipWrap}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <TouchableOpacity
            key={o}
            onPress={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            style={[styles.chip, on && styles.chipOn]}
            activeOpacity={0.85}
          >
            <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{o}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function SingleChips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <View style={styles.chipWrap}>
      {options.map((o) => {
        const on = value === o;
        return (
          <TouchableOpacity key={o} onPress={() => onChange(on ? '' : o)} style={[styles.chip, on && styles.chipOn]} activeOpacity={0.85}>
            <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{o}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <Text style={styles.label}>{children}</Text>;
}

export default function IntakeScreen() {
  const router = useRouter();
  const { role, orgName, orgId, memberNoun } = useLocalSearchParams<{ role?: string; orgName?: string; orgId?: string; memberNoun?: string }>();
  const intakeNoun = role === 'student' ? 'Student' : (memberNoun || 'Tutor');
  const [phase, setPhase] = useState<Phase>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // email + otp
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  // identity
  const [fullName, setFullName] = useState('');
  const [preferredName, setPreferredName] = useState('');
  const [phone, setPhone] = useState('');
  const [birthday, setBirthday] = useState('');
  const [school, setSchool] = useState('');
  const [gradeOcc, setGradeOcc] = useState('');

  // skills / availability
  const [subjects, setSubjects] = useState<string[]>([]);
  const [languages, setLanguages] = useState('');
  const [days, setDays] = useState<string[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [experience, setExperience] = useState('');
  const [transport, setTransport] = useState('');
  const [tshirt, setTshirt] = useState('');

  // emergency + guardian
  const [emName, setEmName] = useState('');
  const [emPhone, setEmPhone] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');

  // consents
  const [consents, setConsents] = useState<Record<string, boolean>>(
    Object.fromEntries(VOLUNTEER_CONSENTS.map((c) => [c.key, c.defaultGranted]))
  );

  const birthdayISO = useMemo(() => {
    const m = birthday.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }, [birthday]);
  const age = useMemo(() => ageFromBirthday(birthdayISO), [birthdayISO]);
  const isMinor = age !== null && age < 18;

  // ── Step handlers ──────────────────────────────────────────────────────────
  const handleSendCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Enter a valid email.'); return; }
    setBusy(true); setError('');
    const { error } = await sendEmailOtp(email);
    setBusy(false);
    if (error) { setError(error.message); return; }
    setPhase('otp');
  };

  const handleVerify = async () => {
    if (code.trim().length < 6) { setError('Enter the 6-digit code.'); return; }
    setBusy(true); setError('');
    const { error } = await verifyEmailOtp(email, code);
    setBusy(false);
    if (error) { setError(error.message); return; }
    setPhase('form');
  };

  const handleSubmit = async () => {
    if (fullName.trim().length < 2) { Alert.alert('Required', 'Enter your full name.'); return; }
    if (!birthdayISO) { Alert.alert('Required', 'Enter your birthday as MM/DD/YYYY.'); return; }
    if (role !== 'student') {
      if (!phone.trim() || !/^[+()\d\s-]{7,20}$/.test(phone.trim())) { Alert.alert('Required', 'Enter a valid phone number — your coordinators need to reach you.'); return; }
      if (!school.trim() || school.trim().length > 80) { Alert.alert('Required', 'Enter your school or institution.'); return; }
    }
    if (!emName.trim() || !emPhone.trim()) { Alert.alert('Required', 'Add an emergency contact.'); return; }
    if (subjects.length === 0 || days.length === 0) { Alert.alert('Required', 'Pick at least one subject and one available day.'); return; }
    if (isMinor && (!guardianName.trim() || !guardianEmail.trim())) {
      Alert.alert('Guardian required', 'Since you are under 18, a parent/guardian name and email are required so they can authorize your participation.');
      return;
    }
    const missing = VOLUNTEER_CONSENTS.filter(
      (c) => (c.required || (isMinor && c.guardianRequiredIfMinor)) && !consents[c.key]
    );
    if (missing.length > 0) {
      Alert.alert('Agreements required', `Please accept: ${missing.map((m) => m.name).join(', ')}.`);
      return;
    }

    setBusy(true);
    const { error } = await completeVolunteerIntake({
      fullName, preferredName, email, phone, birthday: birthdayISO, school, gradeOrOccupation: gradeOcc,
      subjects, languages: languages.split(',').map((s) => s.trim()).filter(Boolean),
      availableDays: days, availableTimes: times, tutoringExperience: experience, transportation: transport, tshirtSize: tshirt,
      emergencyName: emName, emergencyPhone: emPhone,
      isMinor, guardianName, guardianPhone, guardianEmail,
      orgId: orgId || null, orgName: orgName || '', role: role === 'student' ? 'student' : 'member',
      consents,
    });
    setBusy(false);
    if (error) { Alert.alert('Could not finish', error.message); return; }

    if (isMinor) {
      Alert.alert(
        'Almost done',
        'Your profile is saved. A parent/guardian must still sign the required consent documents before you can be matched with a student. We have recorded their contact for that step.',
        [{ text: 'Continue', onPress: () => router.replace('/(tabs)') }]
      );
    } else {
      router.replace('/(tabs)');
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      <AuroraBackground variant="iris" />
      <TouchableOpacity onPress={() => (phase === 'form' ? setPhase('email') : router.back())} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={22} color="#22271F" />
      </TouchableOpacity>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <BrandMark size={52} style={{ marginBottom: 20 }} />

          {phase === 'email' && (
            <>
              <Text style={styles.title}>Let's get{'\n'}you verified</Text>
              <Text style={styles.subtitle}>Enter your email and we'll send a 6-digit code to confirm it's really you.</Text>
              <View style={{ gap: 16, marginTop: 28 }}>
                <GlassInput label="Email address" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                {error ? <ErrorBox text={error} /> : null}
                <GlassButton title={busy ? 'Sending…' : 'Send code'} onPress={handleSendCode} disabled={busy} />
              </View>
            </>
          )}

          {phase === 'otp' && (
            <>
              <Text style={styles.title}>Check your{'\n'}inbox</Text>
              <Text style={styles.subtitle}>We sent a 6-digit code to {email}. Enter it below.</Text>
              <View style={{ gap: 16, marginTop: 28 }}>
                <TextInput
                  style={styles.otpInput}
                  placeholder="000000"
                  placeholderTextColor={colors.textGhost}
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  maxLength={6}
                />
                {error ? <ErrorBox text={error} /> : null}
                <GlassButton title={busy ? 'Verifying…' : 'Verify'} onPress={handleVerify} disabled={busy} />
                <TouchableOpacity onPress={handleSendCode} disabled={busy}>
                  <Text style={styles.resend}>Resend code</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {phase === 'form' && (
            <>
              <Text style={styles.title}>{intakeNoun}{'\n'}intake</Text>
              <Text style={styles.subtitle}>Tell us about yourself so we can match you well and keep everyone safe.</Text>

              {isMinor && (
                <View style={styles.minorBanner}>
                  <Ionicons name="information-circle" size={18} color={colors.gold} />
                  <Text style={styles.minorText}>You're under 18 — a parent/guardian section is required below.</Text>
                </View>
              )}

              {/* Identity */}
              <SectionTitle>Identity & contact</SectionTitle>
              <GlassInput label="Full name" placeholder="Miles Morales" value={fullName} onChangeText={setFullName} />
              <GlassInput label="Preferred name (optional)" placeholder="What students call you" value={preferredName} onChangeText={setPreferredName} />
              <View style={styles.row2}>
                <View style={{ flex: 1 }}><GlassInput label="Phone *" placeholder="(555) 123-4567" value={phone} onChangeText={setPhone} keyboardType="phone-pad" /></View>
                <View style={{ flex: 1 }}><GlassInput label="Birthday" placeholder="MM/DD/YYYY" value={birthday} onChangeText={setBirthday} keyboardType="numbers-and-punctuation" /></View>
              </View>
              <View style={styles.row2}>
                <View style={{ flex: 1 }}><GlassInput label="School / Institution *" placeholder="Visions Academy" value={school} onChangeText={setSchool} /></View>
                <View style={{ flex: 1 }}><GlassInput label="Grade / occupation" placeholder="11th grade" value={gradeOcc} onChangeText={setGradeOcc} /></View>
              </View>

              {/* Skills */}
              <SectionTitle>Skills & availability</SectionTitle>
              <Label>Subjects you can tutor *</Label>
              <Chips options={SUBJECTS} value={subjects} onChange={setSubjects} />
              <GlassInput label="Languages spoken (comma separated)" placeholder="English, Arabic, Dari" value={languages} onChangeText={setLanguages} />
              <Label>Available days *</Label>
              <Chips options={DAYS} value={days} onChange={setDays} />
              <Label>Available times</Label>
              <Chips options={TIMES} value={times} onChange={setTimes} />
              <GlassInput label="Tutoring / teaching experience (optional)" placeholder="Briefly…" value={experience} onChangeText={setExperience} multiline style={{ height: 80, paddingTop: 12 }} />

              {/* Logistics */}
              <SectionTitle>Logistics</SectionTitle>
              <Label>Transportation</Label>
              <SingleChips options={TRANSPORT} value={transport} onChange={setTransport} />
              <Label>T-shirt size</Label>
              <SingleChips options={TSHIRTS} value={tshirt} onChange={setTshirt} />

              {/* Emergency */}
              <SectionTitle>Emergency contact</SectionTitle>
              <View style={styles.row2}>
                <View style={{ flex: 1 }}><GlassInput label="Name *" placeholder="Full name" value={emName} onChangeText={setEmName} /></View>
                <View style={{ flex: 1 }}><GlassInput label="Phone *" placeholder="(555) 000-0000" value={emPhone} onChangeText={setEmPhone} keyboardType="phone-pad" /></View>
              </View>

              {/* Guardian (minors) */}
              {isMinor && (
                <>
                  <SectionTitle>Parent / guardian (required)</SectionTitle>
                  <GlassInput label="Guardian name *" placeholder="Parent / guardian" value={guardianName} onChangeText={setGuardianName} />
                  <View style={styles.row2}>
                    <View style={{ flex: 1 }}><GlassInput label="Guardian phone" placeholder="(555) 000-0000" value={guardianPhone} onChangeText={setGuardianPhone} keyboardType="phone-pad" /></View>
                    <View style={{ flex: 1 }}><GlassInput label="Guardian email *" placeholder="parent@example.com" value={guardianEmail} onChangeText={setGuardianEmail} keyboardType="email-address" autoCapitalize="none" /></View>
                  </View>
                </>
              )}

              {/* Consents */}
              <SectionTitle>Agreements</SectionTitle>
              <View style={styles.disclaimerBox}>
                <Ionicons name="alert-circle-outline" size={15} color={colors.textFaint} />
                <Text style={styles.disclaimerTxt}>{CONSENT_DISCLAIMER}</Text>
              </View>
              {isMinor && (
                <Text style={styles.guardianNote}>As a minor, these must be signed by your parent/guardian — we'll route them for signature.</Text>
              )}
              {VOLUNTEER_CONSENTS.map((doc) => (
                <TouchableOpacity
                  key={doc.key}
                  style={styles.consentRow}
                  onPress={() => setConsents((p) => ({ ...p, [doc.key]: !p[doc.key] }))}
                  activeOpacity={0.85}
                >
                  <View style={[styles.checkbox, consents[doc.key] && styles.checkboxOn]}>
                    {consents[doc.key] && <Ionicons name="checkmark" size={14} color={colors.base} />}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.consentName}>{doc.name}{doc.required ? ' *' : ''}</Text>
                    <Text style={styles.consentSample}>{doc.sample}</Text>
                  </View>
                </TouchableOpacity>
              ))}

              <View style={{ marginTop: 20, marginBottom: 8 }}>
                <GlassButton title={busy ? 'Saving…' : 'Complete intake'} onPress={handleSubmit} disabled={busy} />
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}
function ErrorBox({ text }: { text: string }) {
  return <View style={styles.errorBox}><Text style={styles.errorText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  backBtn: { position: 'absolute', top: 56, left: 20, zIndex: 20, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 28, paddingBottom: 80, paddingTop: 110 },
  title: { fontFamily: font.black, fontSize: 38, color: colors.text, letterSpacing: -1.2, lineHeight: 40, marginBottom: 12 },
  subtitle: { fontFamily: font.regular, fontSize: 15, color: colors.textDim, lineHeight: 22 },
  errorBox: { backgroundColor: 'rgba(176,138,62,0.12)', borderRadius: radius.sm, padding: 14, borderWidth: 1, borderColor: 'rgba(176,138,62,0.3)' },
  errorText: { fontFamily: font.medium, fontSize: 13, color: colors.gold, textAlign: 'center' },
  otpInput: { backgroundColor: colors.surface, color: colors.text, fontSize: 32, fontFamily: font.bold, letterSpacing: 10, textAlign: 'center', paddingVertical: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.hairline },
  resend: { fontFamily: font.medium, fontSize: 14, color: colors.titanium, textAlign: 'center', marginTop: 4 },

  minorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(176,138,62,0.12)', borderWidth: 1, borderColor: 'rgba(176,138,62,0.3)', borderRadius: radius.md, padding: 12, marginTop: 20 },
  minorText: { flex: 1, fontFamily: font.medium, fontSize: 13, color: colors.gold },

  sectionTitle: { fontFamily: font.bold, fontSize: 18, color: colors.text, letterSpacing: -0.3, marginTop: 28, marginBottom: 8 },
  label: { fontFamily: font.semibold, fontSize: 11, color: colors.silver, textTransform: 'uppercase', letterSpacing: 1, marginTop: 14, marginBottom: 8 },
  row2: { flexDirection: 'row', gap: 12 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  chipOn: { backgroundColor: colors.surfaceStrong, borderColor: colors.platinum },
  chipTxt: { fontFamily: font.medium, fontSize: 13, color: colors.textFaint },
  chipTxtOn: { color: colors.text },

  disclaimerBox: { flexDirection: 'row', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, borderRadius: radius.md, padding: 12, marginBottom: 12 },
  disclaimerTxt: { flex: 1, fontFamily: font.regular, fontSize: 12, color: colors.textFaint, lineHeight: 17 },
  guardianNote: { fontFamily: font.medium, fontSize: 12.5, color: colors.gold, marginBottom: 12 },
  consentRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkboxOn: { backgroundColor: colors.platinum, borderColor: colors.platinum },
  consentName: { fontFamily: font.semibold, fontSize: 14, color: colors.text },
  consentSample: { fontFamily: font.regular, fontSize: 12, color: colors.textFaint, marginTop: 3, lineHeight: 17 },
});
