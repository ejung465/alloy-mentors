import { supabase } from '@/lib/supabase';
import { VOLUNTEER_ROLES } from '@/lib/roles';

export type Student = {
  id: string;
  full_name: string;
  grade: string | null;
  organization_id: string | null;
  school?: string | null;
  birthday?: string | null;
  photo_url?: string | null;
  gender?: string | null;
  language?: string | null;
  guardian_name?: string | null;
  guardian_phone?: string | null;
  guardian_email?: string | null;
  notes?: string | null;
  // 0009 intake fields
  subjects_help?: string[] | null;
  english_level?: string | null;
  interpreter_needed?: boolean | null;
  transportation?: string | null;
  allergies?: string | null;
  medical_notes?: string | null;
  dietary?: string | null;
  emergency_contact_name?: string | null;
  emergency_contact_phone?: string | null;
  guardian_relationship?: string | null;
  guardian_language?: string | null;
  photo_media_consent?: boolean | null;
  med_treatment_consent?: boolean | null;
  country_of_origin?: string | null;
  languages_all?: string[] | null;
};

export type Volunteer = {
  id: string;
  full_name: string;
  role: string;
  school: string | null;
};

export type AttendanceRow = {
  id: string;
  session_id: string;
  kind: 'volunteer' | 'student';
  volunteer_id: string | null;
  student_id: string | null;
  paired_volunteer_id: string | null;
  checked_in_at: string;
};

/** The current/next session (its check-in is "live"). */
export async function getActiveSession() {
  return supabase
    .from('sessions')
    .select('*')
    .gte('end_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle();
}

export async function listStudents(orgId?: string | null): Promise<Student[]> {
  let q = supabase.from('students').select('id, full_name, grade, organization_id, school, birthday, photo_url, gender, language, guardian_name, guardian_phone, notes, subjects_help, english_level, interpreter_needed, transportation, allergies, medical_notes, dietary, emergency_contact_name, emergency_contact_phone, guardian_relationship, guardian_language, photo_media_consent, med_treatment_consent, country_of_origin, languages_all').eq('active', true).order('full_name');
  if (orgId) q = q.eq('organization_id', orgId);
  const { data } = await q;
  return (data as Student[]) ?? [];
}

export async function createStudent(input: {
  fullName: string;
  grade?: string | null;
  orgId?: string | null;
  createdBy?: string | null;
  school?: string | null;
  birthday?: string | null;
  photoUrl?: string | null;
  gender?: string | null;
  language?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  guardianEmail?: string | null;
  notes?: string | null;
  // 0009 intake fields
  subjectsHelp?: string[] | null;
  englishLevel?: string | null;
  interpreterNeeded?: boolean | null;
  transportation?: string | null;
  allergies?: string | null;
  emergencyName?: string | null;
  emergencyPhone?: string | null;
  guardianRelationship?: string | null;
  photoMediaConsent?: boolean | null;
  medTreatmentConsent?: boolean | null;
}) {
  return supabase
    .from('students')
    .insert({
      full_name: input.fullName,
      grade: input.grade ?? null,
      organization_id: input.orgId ?? null,
      created_by: input.createdBy ?? null,
      active: true,
      school: input.school ?? null,
      birthday: input.birthday ?? null,
      photo_url: input.photoUrl ?? null,
      gender: input.gender ?? null,
      language: input.language ?? null,
      guardian_name: input.guardianName ?? null,
      guardian_phone: input.guardianPhone ?? null,
      guardian_email: input.guardianEmail ?? null,
      notes: input.notes ?? null,
      subjects_help: input.subjectsHelp ?? null,
      english_level: input.englishLevel ?? null,
      interpreter_needed: input.interpreterNeeded ?? false,
      transportation: input.transportation ?? null,
      allergies: input.allergies ?? null,
      emergency_contact_name: input.emergencyName ?? null,
      emergency_contact_phone: input.emergencyPhone ?? null,
      guardian_relationship: input.guardianRelationship ?? null,
      photo_media_consent: input.photoMediaConsent ?? false,
      med_treatment_consent: input.medTreatmentConsent ?? false,
    })
    .select('id')
    .single();
}

/** Students currently paired to a given volunteer for a session. */
export async function listMyPairedStudents(sessionId: string, volunteerId: string): Promise<Student[]> {
  const { data } = await supabase
    .from('session_attendance')
    .select('student:students(*)')
    .eq('session_id', sessionId)
    .eq('kind', 'student')
    .eq('paired_volunteer_id', volunteerId);
  return ((data as any[]) ?? []).map((r) => r.student).filter(Boolean) as Student[];
}

// ── Student session notes (progress log) ─────────────────────────────────────
export type StudentNote = {
  id: string;
  student_id: string;
  session_id: string | null;
  author_id: string | null;
  author_name: string | null;
  content: string;
  created_at: string;
};

export async function listStudentNotes(studentId: string): Promise<StudentNote[]> {
  const { data } = await supabase
    .from('student_notes')
    .select('id, student_id, session_id, author_id, author_name, content, created_at')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  return (data as StudentNote[]) ?? [];
}

export async function addStudentNote(input: {
  studentId: string;
  content: string;
  authorId?: string | null;
  authorName?: string | null;
  sessionId?: string | null;
}) {
  return supabase.from('student_notes').insert({
    student_id: input.studentId,
    content: input.content.trim(),
    author_id: input.authorId ?? null,
    author_name: input.authorName ?? null,
    session_id: input.sessionId ?? null,
  }).select('id').single();
}

/** Upload a local image uri to the student-photos bucket; returns public URL. */
export async function uploadStudentPhoto(localUri: string, ownerId: string): Promise<string | null> {
  try {
    const res = await fetch(localUri);
    const arrayBuffer = await res.arrayBuffer();
    const ext = localUri.split('.').pop()?.split('?')[0] || 'jpg';
    const path = `${ownerId}/${ownerId}-${Date.now()}.${ext}`;
    const { error } = await supabase.storage
      .from('student-photos')
      .upload(path, arrayBuffer, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: true });
    if (error) { console.warn('[uploadStudentPhoto]', error.message); return null; }
    return supabase.storage.from('student-photos').getPublicUrl(path).data.publicUrl;
  } catch (e: any) {
    console.warn('[uploadStudentPhoto] failed:', e?.message);
    return null;
  }
}

export async function listVolunteers(orgId?: string | null): Promise<Volunteer[]> {
  let q = supabase.from('users').select('id, full_name, role, school').in('role', VOLUNTEER_ROLES).order('full_name');
  if (orgId) q = q.eq('organization_id', orgId);
  const { data } = await q;
  return (data as Volunteer[]) ?? [];
}

export async function listSessionAttendance(sessionId: string): Promise<AttendanceRow[]> {
  const { data } = await supabase
    .from('session_attendance')
    .select('id, session_id, kind, volunteer_id, student_id, paired_volunteer_id, checked_in_at')
    .eq('session_id', sessionId)
    .order('checked_in_at', { ascending: false });
  return (data as AttendanceRow[]) ?? [];
}

export async function checkInVolunteer(sessionId: string, volunteerId: string, by?: string | null) {
  return supabase.from('session_attendance').upsert(
    { session_id: sessionId, kind: 'volunteer', volunteer_id: volunteerId, checked_in_by: by ?? null },
    { onConflict: 'session_id,volunteer_id' }
  );
}

/**
 * Check a student in and auto-pair them with a checked-in volunteer via smart
 * matching v2: load-balanced across present volunteers, preferring one the
 * student has met before (continuity), otherwise random (meet someone new).
 * Returns the paired volunteer id, a short match reason ("Met 3×" / "New
 * pairing"), or null if no volunteers are checked in yet.
 */
export async function checkInStudentAndPair(
  sessionId: string,
  studentId: string,
  by?: string | null
): Promise<{ pairedVolunteerId: string | null; matchReason: string | null; error: any }> {
  const { data, error: rpcErr } = await supabase.rpc('get_best_volunteer_v2', {
    p_session_id: sessionId,
    p_student_id: studentId,
  });
  if (rpcErr) return { pairedVolunteerId: null, matchReason: null, error: rpcErr };

  const row = Array.isArray(data) ? data[0] : data;
  const pairedVolunteerId = (row?.volunteer_id as string | null) || null;
  const matchReason = (row?.match_reason as string | null) || null;

  const { error } = await supabase.from('session_attendance').upsert(
    {
      session_id: sessionId,
      kind: 'student',
      student_id: studentId,
      paired_volunteer_id: pairedVolunteerId,
      checked_in_by: by ?? null,
    },
    { onConflict: 'session_id,student_id' }
  );
  return { pairedVolunteerId, matchReason, error };
}

export async function undoAttendance(attendanceId: string) {
  return supabase.from('session_attendance').delete().eq('id', attendanceId);
}

/**
 * Consecutive weeks with at least one check-in, counting back from the most
 * recent week the person attended (not necessarily the current calendar
 * week, so a streak doesn't reset just because this week hasn't happened
 * yet). Recognition tied to SHOWING UP, not hours logged.
 */
export async function getAttendanceStreak(userId: string): Promise<number> {
  const { data } = await supabase
    .from('session_attendance')
    .select('checked_in_at')
    .eq('kind', 'volunteer')
    .eq('volunteer_id', userId)
    .order('checked_in_at', { ascending: false });
  if (!data || data.length === 0) return 0;

  const weekStart = (d: Date) => {
    const r = new Date(d);
    r.setHours(0, 0, 0, 0);
    r.setDate(r.getDate() - r.getDay());
    return r.getTime();
  };
  const weeks = [...new Set(data.map((r) => weekStart(new Date(r.checked_in_at))))].sort((a, b) => b - a);

  let streak = 1;
  const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  for (let i = 1; i < weeks.length; i++) {
    if (weeks[i - 1] - weeks[i] === WEEK_MS) streak++;
    else break;
  }
  return streak;
}
