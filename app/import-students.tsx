import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { AuroraBackground } from '@/components/ui/AuroraBackground';
import { colors, font } from '@/lib/theme';
import { useUser } from '@/contexts/UserContext';
import { canManageOrg } from '@/lib/roles';
import { supabase } from '@/lib/supabase';

const PINE = '#165B74';
const PINE_MID = '#2C7C96';
const INK = '#22271F';

// Roster fields we accept from a CSV column header (case-insensitive, some
// forgiving aliases). full_name is the only required field.
const FIELD_ALIASES: Record<string, string> = {
  full_name: 'full_name', fullname: 'full_name', name: 'full_name', 'student name': 'full_name', 'student_name': 'full_name',
  grade: 'grade',
  school: 'school',
  guardian_name: 'guardian_name', 'guardian name': 'guardian_name', parent: 'guardian_name', 'parent name': 'guardian_name', 'parent_name': 'guardian_name',
  guardian_phone: 'guardian_phone', 'guardian phone': 'guardian_phone', phone: 'guardian_phone',
  guardian_email: 'guardian_email', 'guardian email': 'guardian_email', email: 'guardian_email',
  allergies: 'allergies',
};

type ParsedRow = Record<string, string>;

/** A small, dependency-free CSV line splitter that handles quoted fields
 * (including embedded commas and escaped "" quotes). Operates on the whole
 * file text and returns rows of raw string cells. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Normalize line endings so \r\n and \r both behave like \n.
  const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  // Flush the trailing field/row (files without a final newline).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // Drop fully-empty trailing rows (e.g. a blank final line).
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

function rowsToStudents(rows: string[][]): { parsed: ParsedRow[]; skipped: number } {
  if (rows.length === 0) return { parsed: [], skipped: 0 };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const fieldForCol = header.map((h) => FIELD_ALIASES[h] ?? null);

  const parsed: ParsedRow[] = [];
  let skipped = 0;
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    const obj: ParsedRow = {};
    for (let c = 0; c < cells.length; c++) {
      const field = fieldForCol[c];
      if (field) obj[field] = (cells[c] ?? '').trim();
    }
    if (!obj.full_name) { skipped++; continue; }
    parsed.push(obj);
  }
  return { parsed, skipped };
}

export default function ImportStudentsScreen() {
  const router = useRouter();
  const { profile, org } = useUser();

  const [picking, setPicking] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parseSkipped, setParseSkipped] = useState(0);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ succeeded: number; skipped: number } | null>(null);

  if (!canManageOrg(profile?.role)) {
    return (
      <SafeAreaView style={styles.screen}>
        <AuroraBackground />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Ionicons name="lock-closed-outline" size={40} color={colors.textFaint} />
          <Text style={styles.lockedTxt}>Roster import is for admins and leadership.</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.lockedBack}>
            <Text style={styles.lockedBackTxt}>Go back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const reset = () => {
    setFileName(null); setRows([]); setParseSkipped(0); setResult(null);
  };

  const pickFile = async () => {
    setPicking(true);
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'public.comma-separated-values-text', 'application/vnd.ms-excel', '*/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.[0]) { setPicking(false); return; }
      const asset = res.assets[0];
      const text = await new File(asset.uri).text();
      const parsedRows = parseCsv(text);
      const { parsed, skipped } = rowsToStudents(parsedRows);
      if (parsed.length === 0 && skipped === 0) {
        Alert.alert('Empty file', 'That CSV had no data rows to import.');
        setPicking(false);
        return;
      }
      setFileName(asset.name);
      setRows(parsed);
      setParseSkipped(skipped);
      setResult(null);
    } catch (e: any) {
      Alert.alert("Couldn't read file", e?.message ?? 'Try a different CSV file.');
    } finally {
      setPicking(false);
    }
  };

  const confirmImport = async () => {
    if (!org?.id || rows.length === 0) return;
    setImporting(true);
    let succeeded = 0;
    let skipped = parseSkipped;

    const payload = rows
      .filter((r) => !!r.full_name?.trim())
      .map((r) => ({
        full_name: r.full_name.trim(),
        grade: r.grade?.trim() || null,
        school: r.school?.trim() || null,
        guardian_name: r.guardian_name?.trim() || null,
        guardian_phone: r.guardian_phone?.trim() || null,
        guardian_email: r.guardian_email?.trim() || null,
        allergies: r.allergies?.trim() || null,
        organization_id: org.id,
        created_by: profile?.id ?? null,
        active: true,
      }));
    skipped += rows.length - payload.length;

    // Batch in chunks so one bad row / large roster doesn't blow a single request.
    const CHUNK = 200;
    for (let i = 0; i < payload.length; i += CHUNK) {
      const chunk = payload.slice(i, i + CHUNK);
      const { error, data } = await supabase.from('students').insert(chunk).select('id');
      if (error) {
        // Fall back to one-by-one so a single bad row doesn't sink the whole chunk.
        for (const row of chunk) {
          const { error: rowErr } = await supabase.from('students').insert(row);
          if (rowErr) skipped++; else succeeded++;
        }
      } else {
        succeeded += data?.length ?? chunk.length;
      }
    }

    setImporting(false);
    setResult({ succeeded, skipped });
    setRows([]);
  };

  const preview = rows.slice(0, 10);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <AuroraBackground />
      <View style={styles.topbar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={22} color={INK} />
        </TouchableOpacity>
        <Text style={styles.eyebrow}>IMPORT ROSTER</Text>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
        <Text style={styles.title}>Import students from CSV</Text>
        <Text style={styles.subtitle}>
          One row per student. The header row needs a "full_name" column — grade, school, guardian_name,
          guardian_phone, guardian_email, and allergies are optional and can be in any order.
        </Text>

        {result ? (
          <View style={styles.resultCard}>
            <Ionicons name="checkmark-circle" size={28} color={PINE_MID} />
            <Text style={styles.resultTitle}>Import complete</Text>
            <Text style={styles.resultLine}>{result.succeeded} added{result.skipped > 0 ? ` · ${result.skipped} skipped` : ''}</Text>
            {result.skipped > 0 && (
              <Text style={styles.resultSub}>Skipped rows were missing a full_name or failed to save.</Text>
            )}
            <TouchableOpacity style={styles.secondaryBtn} onPress={reset} activeOpacity={0.85}>
              <Text style={styles.secondaryBtnTxt}>Import another file</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.doneBtn} onPress={() => router.back()} activeOpacity={0.9}>
              <Text style={styles.doneBtnTxt}>Done</Text>
            </TouchableOpacity>
          </View>
        ) : rows.length === 0 ? (
          <TouchableOpacity style={styles.pickBtn} onPress={pickFile} activeOpacity={0.85} disabled={picking}>
            {picking ? (
              <ActivityIndicator color={PINE} />
            ) : (
              <>
                <Ionicons name="document-attach-outline" size={22} color={PINE} />
                <Text style={styles.pickBtnTxt}>Choose a CSV file</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <>
            <View style={styles.fileRow}>
              <Ionicons name="document-text-outline" size={18} color={PINE_MID} />
              <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
            </View>

            <View style={styles.countRow}>
              <Text style={styles.countTxt}>{rows.length} student{rows.length === 1 ? '' : 's'} ready to import</Text>
              {parseSkipped > 0 && <Text style={styles.countSkip}>{parseSkipped} row{parseSkipped === 1 ? '' : 's'} skipped (no name)</Text>}
            </View>

            <Text style={styles.previewLabel}>PREVIEW · FIRST {preview.length} OF {rows.length}</Text>
            <View style={styles.previewCard}>
              {preview.map((r, i) => (
                <View key={i} style={[styles.previewRow, i > 0 && styles.previewDivider]}>
                  <Text style={styles.previewName}>{r.full_name}</Text>
                  <Text style={styles.previewMeta} numberOfLines={1}>
                    {[r.grade, r.school].filter(Boolean).join(' · ') || '—'}
                  </Text>
                  {(r.guardian_name || r.guardian_phone || r.guardian_email) ? (
                    <Text style={styles.previewMeta} numberOfLines={1}>
                      {[r.guardian_name, r.guardian_phone || r.guardian_email].filter(Boolean).join(' · ')}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>

            <TouchableOpacity
              style={[styles.confirmBtn, importing && { opacity: 0.6 }]}
              onPress={confirmImport}
              disabled={importing}
              activeOpacity={0.9}
            >
              <Text style={styles.confirmBtnTxt}>{importing ? 'Importing…' : `Import ${rows.length} student${rows.length === 1 ? '' : 's'}`}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={reset} disabled={importing} activeOpacity={0.85}>
              <Text style={styles.secondaryBtnTxt}>Choose a different file</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: font.bold, fontSize: 11, color: PINE_MID, letterSpacing: 2 },

  title: { fontFamily: font.black, fontSize: 24, color: INK, letterSpacing: -0.6, marginTop: 4, marginBottom: 8 },
  subtitle: { fontFamily: font.regular, fontSize: 13.5, color: 'rgba(34,39,31,0.55)', lineHeight: 20, marginBottom: 22 },

  pickBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: 'rgba(22,91,116,0.3)', borderStyle: 'dashed', borderRadius: 18, paddingVertical: 32 },
  pickBtnTxt: { fontFamily: font.semibold, fontSize: 15, color: PINE },

  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.16)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 14 },
  fileName: { flex: 1, fontFamily: font.medium, fontSize: 13.5, color: INK },

  countRow: { marginBottom: 18 },
  countTxt: { fontFamily: font.semibold, fontSize: 14.5, color: INK },
  countSkip: { fontFamily: font.regular, fontSize: 12.5, color: 'rgba(177,90,78,0.85)', marginTop: 2 },

  previewLabel: { fontFamily: font.semibold, fontSize: 11, color: 'rgba(34,39,31,0.4)', letterSpacing: 1, marginBottom: 10 },
  previewCard: { backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 16, paddingHorizontal: 14, marginBottom: 22 },
  previewRow: { paddingVertical: 11 },
  previewDivider: { borderTopWidth: 1, borderTopColor: 'rgba(196,196,196,0.12)' },
  previewName: { fontFamily: font.semibold, fontSize: 14.5, color: INK },
  previewMeta: { fontFamily: font.regular, fontSize: 12.5, color: 'rgba(34,39,31,0.5)', marginTop: 2 },

  confirmBtn: { backgroundColor: PINE, borderRadius: 16, paddingVertical: 16, alignItems: 'center', marginBottom: 10 },
  confirmBtnTxt: { fontFamily: font.bold, fontSize: 15, color: '#F4F6F6' },
  secondaryBtn: { alignItems: 'center', paddingVertical: 14 },
  secondaryBtnTxt: { fontFamily: font.semibold, fontSize: 14, color: 'rgba(34,39,31,0.55)' },

  resultCard: { alignItems: 'center', backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(196,196,196,0.14)', borderRadius: 20, padding: 26, marginTop: 10 },
  resultTitle: { fontFamily: font.bold, fontSize: 18, color: INK, marginTop: 10 },
  resultLine: { fontFamily: font.semibold, fontSize: 15, color: PINE_MID, marginTop: 6 },
  resultSub: { fontFamily: font.regular, fontSize: 12.5, color: 'rgba(34,39,31,0.5)', marginTop: 6, textAlign: 'center' },
  doneBtn: { backgroundColor: PINE, borderRadius: 16, paddingVertical: 15, paddingHorizontal: 40, alignItems: 'center', marginTop: 8 },
  doneBtnTxt: { fontFamily: font.bold, fontSize: 15, color: '#F4F6F6' },

  lockedTxt: { fontFamily: font.medium, fontSize: 14, color: colors.textFaint, textAlign: 'center', marginTop: 14, marginBottom: 20 },
  lockedBack: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.hairline },
  lockedBackTxt: { fontFamily: font.semibold, fontSize: 13, color: INK },
});
