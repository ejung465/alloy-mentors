import { router } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font } from '@/lib/theme';
import { useUser } from '@/contexts/UserContext';
import { createStudent, uploadStudentPhoto } from '@/lib/checkin';
import { SUBJECTS, ENGLISH_LEVELS, TRANSPORT } from '@/lib/intake';

const GENDERS = ['Male', 'Female', 'Other'];

function ChipRow({ options, value, onToggle, single = false }: { options: string[]; value: string[]; onToggle: (o: string) => void; single?: boolean }) {
  return (
    <View style={styles.chipWrap}>
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <TouchableOpacity key={o} onPress={() => onToggle(o)} style={[styles.chip, on && styles.chipOn]} activeOpacity={0.85}>
            <Text style={[styles.chipTxt, on && styles.chipTxtOn]}>{o}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// Lazy-load expo-image-picker so the screen still renders in an Expo Go / dev
// build that doesn't have the native module compiled in (avoids a hard crash).
type ImagePickerModule = typeof import('expo-image-picker');
let _imagePicker: ImagePickerModule | null | undefined;
function getImagePicker(): ImagePickerModule | null {
  if (_imagePicker !== undefined) return _imagePicker;
  try {
    _imagePicker = require('expo-image-picker') as ImagePickerModule;
  } catch {
    _imagePicker = null;
  }
  return _imagePicker;
}

export default function AddStudentModal() {
  const { user, profile } = useUser();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [grade, setGrade] = useState('');
  const [birthday, setBirthday] = useState('');
  const [school, setSchool] = useState('');
  const [language, setLanguage] = useState('');
  const [gender, setGender] = useState('');
  const [guardianName, setGuardianName] = useState('');
  const [guardianPhone, setGuardianPhone] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [notes, setNotes] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // 0009 intake fields
  const [subjectsHelp, setSubjectsHelp] = useState<string[]>([]);
  const [englishLevel, setEnglishLevel] = useState('');
  const [allergies, setAllergies] = useState('');
  const [emName, setEmName] = useState('');
  const [emPhone, setEmPhone] = useState('');
  const [transport, setTransport] = useState('');
  const [guardianRel, setGuardianRel] = useState('');
  const [interpreter, setInterpreter] = useState(false);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [medConsent, setMedConsent] = useState(false);

  const toggleSubject = (s: string) => setSubjectsHelp((p) => (p.includes(s) ? p.filter((x) => x !== s) : [...p, s]));

  const pickPhoto = async (useCamera: boolean) => {
    const ImagePicker = getImagePicker();
    if (!ImagePicker) {
      Alert.alert('Photos unavailable', 'Photo capture needs a native rebuild (npx expo run:android). You can still add the student without a photo.');
      return;
    }
    const perm = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permission needed', `Allow ${useCamera ? 'camera' : 'photo library'} access to add a photo.`);
      return;
    }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.6 })
      : await ImagePicker.launchImageLibraryAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.6 });
    if (!result.canceled && result.assets?.[0]) setPhotoUri(result.assets[0].uri);
  };

  const choosePhoto = () => {
    if (!getImagePicker()) {
      Alert.alert('Photos unavailable', 'Photo capture needs a native rebuild (npx expo run:android). Add the student now and attach a photo after rebuilding.');
      return;
    }
    Alert.alert('Add Photo', 'Choose a source', [
      { text: 'Take Photo', onPress: () => pickPhoto(true) },
      { text: 'Choose from Library', onPress: () => pickPhoto(false) },
      ...(photoUri ? [{ text: 'Remove Photo', style: 'destructive' as const, onPress: () => setPhotoUri(null) }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  // Accept MM/DD/YYYY → store as ISO date (YYYY-MM-DD). Returns null if blank/invalid.
  const parseBirthday = (s: string): string | null | 'invalid' => {
    if (!s.trim()) return null;
    const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return 'invalid';
    const mm = +m[1], dd = +m[2], yyyy = +m[3];
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return 'invalid';
    // Reject impossible dates like 02/31 by round-tripping through Date.
    const probe = new Date(yyyy, mm - 1, dd);
    if (probe.getMonth() !== mm - 1 || probe.getDate() !== dd || probe.getFullYear() !== yyyy) return 'invalid';
    return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  };

  const handleAddStudent = async () => {
    if (!firstName.trim() || !lastName.trim()) {
      Alert.alert('Missing Info', 'Please enter a first and last name.');
      return;
    }
    const bday = parseBirthday(birthday);
    if (bday === 'invalid') {
      Alert.alert('Invalid birthday', 'Use MM/DD/YYYY, or leave it blank.');
      return;
    }
    if (guardianPhone.trim() && !/^[+()\d\s-]{7,20}$/.test(guardianPhone.trim())) {
      Alert.alert('Invalid phone', 'Enter a valid guardian phone number.');
      return;
    }

    setIsSubmitting(true);
    const fullName = `${firstName.trim()} ${lastName.trim()}`;

    // Upload photo first (if any)
    let photoUrl: string | null = null;
    if (photoUri) {
      photoUrl = await uploadStudentPhoto(photoUri, user?.id ?? 'anon');
      if (!photoUrl) {
        // Non-fatal — let them save without the photo
        const proceed = await new Promise<boolean>((resolve) => {
          Alert.alert('Photo upload failed', 'Save the student without a photo?', [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Save anyway', onPress: () => resolve(true) },
          ]);
        });
        if (!proceed) { setIsSubmitting(false); return; }
      }
    }

    const { error } = await createStudent({
      fullName,
      grade: grade.trim() || null,
      orgId: profile?.organization_id ?? null,
      createdBy: user?.id ?? null,
      school: school.trim() || null,
      birthday: bday,
      photoUrl,
      gender: gender || null,
      language: language.trim() || null,
      guardianName: guardianName.trim() || null,
      guardianPhone: guardianPhone.trim() || null,
      guardianEmail: guardianEmail.trim() || null,
      notes: notes.trim() || null,
      subjectsHelp: subjectsHelp.length ? subjectsHelp : null,
      englishLevel: englishLevel || null,
      allergies: allergies.trim() || null,
      emergencyName: emName.trim() || null,
      emergencyPhone: emPhone.trim() || null,
      transportation: transport || null,
      guardianRelationship: guardianRel.trim() || null,
      interpreterNeeded: interpreter,
      photoMediaConsent: photoConsent,
      medTreatmentConsent: medConsent,
    });

    setIsSubmitting(false);
    if (error) { Alert.alert('Error', error.message); return; }
    Alert.alert('Success', `${fullName} has been added to the roster!`, [
      { text: 'OK', onPress: () => router.back() },
    ]);
  };

  const initials = `${firstName.charAt(0)}${lastName.charAt(0)}`.toUpperCase() || '+';

  return (
    <SafeAreaView style={styles.container}>
      <AuroraBackground variant="iris" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Add New Student</Text>
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.formContainer} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Photo */}
          <TouchableOpacity style={styles.photoWrap} onPress={choosePhoto} activeOpacity={0.85}>
            {photoUri ? (
              <Image source={{ uri: photoUri }} style={styles.photo} />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Text style={styles.photoInitials}>{initials}</Text>
              </View>
            )}
            <View style={styles.photoBadge}>
              <Ionicons name="camera" size={14} color={colors.base} />
            </View>
          </TouchableOpacity>
          <Text style={styles.photoHint}>Tap to add a photo</Text>

          {/* Name row */}
          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>First Name</Text>
              <TextInput style={styles.input} placeholder="Ahmad" placeholderTextColor={colors.textGhost} value={firstName} onChangeText={setFirstName} />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Last Name</Text>
              <TextInput style={styles.input} placeholder="M." placeholderTextColor={colors.textGhost} value={lastName} onChangeText={setLastName} />
            </View>
          </View>

          {/* Grade + Birthday row */}
          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Grade Level</Text>
              <TextInput style={styles.input} placeholder="5th Grade" placeholderTextColor={colors.textGhost} value={grade} onChangeText={setGrade} />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Birthday</Text>
              <TextInput style={styles.input} placeholder="MM/DD/YYYY" placeholderTextColor={colors.textGhost} value={birthday} onChangeText={setBirthday} keyboardType="numbers-and-punctuation" />
            </View>
          </View>

          {/* School */}
          <Text style={styles.label}>School</Text>
          <TextInput style={styles.input} placeholder="e.g. Lincoln Elementary" placeholderTextColor={colors.textGhost} value={school} onChangeText={setSchool} />

          {/* Preferred language — important for refugee students */}
          <Text style={styles.label}>Home / Preferred Language</Text>
          <TextInput style={styles.input} placeholder="e.g. Dari, Arabic, Swahili" placeholderTextColor={colors.textGhost} value={language} onChangeText={setLanguage} />

          {/* Gender */}
          <Text style={styles.label}>Gender (optional)</Text>
          <View style={styles.genderRow}>
            {GENDERS.map((g) => (
              <TouchableOpacity
                key={g}
                onPress={() => setGender(gender === g ? '' : g)}
                style={[styles.genderBtn, gender === g && styles.genderBtnActive]}
                activeOpacity={0.85}
              >
                <Text style={[styles.genderTxt, gender === g && styles.genderTxtActive]}>{g}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Guardian */}
          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Guardian Name</Text>
              <TextInput style={styles.input} placeholder="Parent / guardian" placeholderTextColor={colors.textGhost} value={guardianName} onChangeText={setGuardianName} />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Guardian Phone</Text>
              <TextInput style={styles.input} placeholder="(555) 123-4567" placeholderTextColor={colors.textGhost} value={guardianPhone} onChangeText={setGuardianPhone} keyboardType="phone-pad" />
            </View>
          </View>

          <Text style={styles.label}>Guardian Email</Text>
          <TextInput style={styles.input} placeholder="For progress updates home (optional)" placeholderTextColor={colors.textGhost} value={guardianEmail} onChangeText={setGuardianEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />

          {/* Academic */}
          <Text style={styles.label}>Subjects needing help</Text>
          <ChipRow options={SUBJECTS} value={subjectsHelp} onToggle={toggleSubject} />

          <Text style={styles.label}>English proficiency</Text>
          <ChipRow options={ENGLISH_LEVELS} value={englishLevel ? [englishLevel] : []} onToggle={(o) => setEnglishLevel(englishLevel === o ? '' : o)} />

          <TouchableOpacity style={styles.toggleRow} onPress={() => setInterpreter((v) => !v)} activeOpacity={0.85}>
            <View style={[styles.checkbox, interpreter && styles.checkboxOn]}>{interpreter && <Ionicons name="checkmark" size={14} color={colors.base} />}</View>
            <Text style={styles.toggleTxt}>Interpreter needed at sessions</Text>
          </TouchableOpacity>

          {/* Health & Safety */}
          <Text style={styles.label}>Allergies / medical (visible to mentors)</Text>
          <TextInput style={styles.input} placeholder="e.g. peanut allergy, asthma" placeholderTextColor={colors.textGhost} value={allergies} onChangeText={setAllergies} />

          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Emergency contact</Text>
              <TextInput style={styles.input} placeholder="Name" placeholderTextColor={colors.textGhost} value={emName} onChangeText={setEmName} />
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Emergency phone</Text>
              <TextInput style={styles.input} placeholder="(555) 000-0000" placeholderTextColor={colors.textGhost} value={emPhone} onChangeText={setEmPhone} keyboardType="phone-pad" />
            </View>
          </View>

          {/* Logistics & guardian */}
          <Text style={styles.label}>Transportation</Text>
          <ChipRow options={TRANSPORT} value={transport ? [transport] : []} onToggle={(o) => setTransport(transport === o ? '' : o)} />

          <Text style={styles.label}>Guardian relationship</Text>
          <TextInput style={styles.input} placeholder="e.g. Mother, Uncle, Sponsor" placeholderTextColor={colors.textGhost} value={guardianRel} onChangeText={setGuardianRel} />

          {/* Consents (guardian-authorized) */}
          <Text style={styles.label}>Guardian consents</Text>
          <TouchableOpacity style={styles.toggleRow} onPress={() => setPhotoConsent((v) => !v)} activeOpacity={0.85}>
            <View style={[styles.checkbox, photoConsent && styles.checkboxOn]}>{photoConsent && <Ionicons name="checkmark" size={14} color={colors.base} />}</View>
            <Text style={styles.toggleTxt}>Photo / media release granted</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.toggleRow} onPress={() => setMedConsent((v) => !v)} activeOpacity={0.85}>
            <View style={[styles.checkbox, medConsent && styles.checkboxOn]}>{medConsent && <Ionicons name="checkmark" size={14} color={colors.base} />}</View>
            <Text style={styles.toggleTxt}>Emergency medical treatment authorized</Text>
          </TouchableOpacity>

          {/* Notes */}
          <Text style={styles.label}>Notes (accommodations…)</Text>
          <TextInput
            style={[styles.input, styles.notesInput]}
            placeholder="Anything a mentor should know"
            placeholderTextColor={colors.textGhost}
            value={notes}
            onChangeText={setNotes}
            multiline
          />

          <TouchableOpacity style={[styles.submitBtn, isSubmitting && styles.submitBtnDisabled]} onPress={handleAddStudent} disabled={isSubmitting}>
            {isSubmitting ? <ActivityIndicator color={colors.base} /> : <Text style={styles.submitBtnText}>Add to Roster</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.base },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 24, borderBottomWidth: 1, borderBottomColor: colors.hairline },
  headerTitle: { color: colors.text, fontSize: 22, fontFamily: font.black, letterSpacing: -0.5 },
  cancelText: { color: colors.textFaint, fontSize: 16, fontFamily: font.medium },
  formContainer: { padding: 20, paddingBottom: 60 },

  // Photo
  photoWrap: { alignSelf: 'center', width: 96, height: 96, borderRadius: 48, marginTop: 4 },
  photo: { width: 96, height: 96, borderRadius: 48, borderWidth: 1, borderColor: colors.hairlineStrong },
  photoPlaceholder: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surfaceStrong, borderWidth: 1, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  photoInitials: { fontFamily: font.bold, fontSize: 30, color: colors.titanium },
  photoBadge: { position: 'absolute', bottom: 0, right: 0, width: 30, height: 30, borderRadius: 15, backgroundColor: colors.platinum, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.base },
  photoHint: { alignSelf: 'center', fontFamily: font.regular, fontSize: 12, color: colors.textFaint, marginTop: 8, marginBottom: 8 },

  row: { flexDirection: 'row', gap: 12 },
  col: { flex: 1 },
  label: { color: colors.silver, fontSize: 11, fontFamily: font.semibold, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: 16 },
  input: { backgroundColor: colors.surface, color: colors.text, padding: 14, borderRadius: 14, fontSize: 16, fontFamily: font.regular, borderWidth: 1, borderColor: colors.hairline },
  notesInput: { height: 88, textAlignVertical: 'top' },

  genderRow: { flexDirection: 'row', gap: 10 },
  genderBtn: { flex: 1, paddingVertical: 12, borderRadius: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline, alignItems: 'center' },
  genderBtnActive: { backgroundColor: colors.surfaceStrong, borderColor: colors.hairlineStrong },
  genderTxt: { fontFamily: font.semibold, fontSize: 14, color: colors.textFaint },
  genderTxtActive: { color: colors.text },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  chipOn: { backgroundColor: colors.surfaceStrong, borderColor: colors.platinum },
  chipTxt: { fontFamily: font.medium, fontSize: 13, color: colors.textFaint },
  chipTxtOn: { color: colors.text },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  checkbox: { width: 24, height: 24, borderRadius: 7, borderWidth: 2, borderColor: colors.hairlineStrong, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.platinum, borderColor: colors.platinum },
  toggleTxt: { flex: 1, fontFamily: font.medium, fontSize: 14, color: colors.text },

  submitBtn: { backgroundColor: colors.platinum, padding: 16, borderRadius: 16, alignItems: 'center', marginTop: 32 },
  submitBtnDisabled: { opacity: 0.7 },
  submitBtnText: { color: colors.base, fontSize: 16, fontFamily: font.bold },
});
