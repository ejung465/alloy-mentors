import { supabase } from '@/lib/supabase';

// ── Goals ─────────────────────────────────────────────────────────────────────
export type GoalStatus = 'active' | 'achieved' | 'paused';

export type StudentGoal = {
  id: string;
  student_id: string;
  organization_id: string | null;
  title: string;
  subject: string | null;
  status: GoalStatus;
  target_checkpoints: number;
  completed_checkpoints: number;
  created_at: string;
  achieved_at: string | null;
};

export async function listGoals(studentId: string): Promise<StudentGoal[]> {
  const { data } = await supabase
    .from('student_goals')
    .select('*')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  return (data as StudentGoal[]) ?? [];
}

/** The goal a student is actively working toward (most recent active one). */
export function activeGoal(goals: StudentGoal[]): StudentGoal | null {
  return goals.find((g) => g.status === 'active') ?? null;
}

export async function createGoal(input: {
  studentId: string;
  orgId: string | null;
  title: string;
  subject?: string | null;
  targetCheckpoints?: number;
  createdBy?: string | null;
}) {
  return supabase.from('student_goals').insert({
    student_id: input.studentId,
    organization_id: input.orgId ?? null,
    title: input.title.trim(),
    subject: input.subject?.trim() || null,
    target_checkpoints: Math.max(1, input.targetCheckpoints ?? 10),
    created_by: input.createdBy ?? null,
  }).select('id').single();
}

/** Advance a goal by `delta` checkpoints; auto-marks it achieved at the target. */
export async function bumpGoal(goal: StudentGoal, delta: number) {
  const next = Math.max(0, Math.min(goal.target_checkpoints, goal.completed_checkpoints + delta));
  const achieved = next >= goal.target_checkpoints;
  return supabase
    .from('student_goals')
    .update({
      completed_checkpoints: next,
      status: achieved ? 'achieved' : 'active',
      achieved_at: achieved ? new Date().toISOString() : null,
    })
    .eq('id', goal.id);
}

export async function setGoalStatus(goalId: string, status: GoalStatus) {
  return supabase
    .from('student_goals')
    .update({ status, achieved_at: status === 'achieved' ? new Date().toISOString() : null })
    .eq('id', goalId);
}

// ── Skills ────────────────────────────────────────────────────────────────────
export const SKILL_LEVELS = ['Not started', 'Learning', 'Practicing', 'Mastered'] as const;

export type StudentSkill = {
  id: string;
  student_id: string;
  organization_id: string | null;
  name: string;
  level: number; // 0..3
  updated_at: string;
};

export async function listSkills(studentId: string): Promise<StudentSkill[]> {
  const { data } = await supabase
    .from('student_skills')
    .select('*')
    .eq('student_id', studentId)
    .order('name');
  return (data as StudentSkill[]) ?? [];
}

/** Create or move a skill to a mastery level (upsert on student_id + name). */
export async function upsertSkill(input: {
  studentId: string;
  orgId: string | null;
  name: string;
  level: number;
  updatedBy?: string | null;
}) {
  return supabase.from('student_skills').upsert(
    {
      student_id: input.studentId,
      organization_id: input.orgId ?? null,
      name: input.name.trim(),
      level: Math.max(0, Math.min(3, input.level)),
      updated_by: input.updatedBy ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'student_id,name' }
  );
}

// ── Growth timeline (enriched session notes) ──────────────────────────────────
export type Marker = 'breakthrough' | 'progress' | 'struggled' | 'milestone';

/** A student's self-reported reaction to a timeline entry (student_feedback). */
export type StudentReaction = 'got_it' | 'confused' | 'in_between';

export type TimelineEntry = {
  id: string;
  student_id: string;
  session_id: string | null;
  author_id: string | null;
  author_name: string | null;
  title: string | null;
  content: string;
  marker: Marker | null;
  goal_id: string | null;
  created_at: string;
  student_reaction: StudentReaction | null;
};

export async function listTimeline(studentId: string): Promise<TimelineEntry[]> {
  const { data } = await supabase
    .from('student_notes')
    .select('id, student_id, session_id, author_id, author_name, title, content, marker, goal_id, created_at, student_reaction')
    .eq('student_id', studentId)
    .order('created_at', { ascending: false });
  return (data as TimelineEntry[]) ?? [];
}

/**
 * Record (or clear, with null) the student's reaction to a timeline entry.
 * Goes through a SECURITY DEFINER RPC (migration 0028) because the student is
 * not the note's author and RLS blocks a direct update.
 */
export async function setStudentReaction(noteId: string, reaction: StudentReaction | null) {
  return supabase.rpc('set_student_reaction', { p_note_id: noteId, p_reaction: reaction });
}

/**
 * Record a session's progress: writes a timeline entry and, when the tutor
 * marks a checkpoint, advances the linked goal in the same flow.
 */
export async function logProgress(input: {
  studentId: string;
  content: string;
  title?: string | null;
  marker?: Marker | null;
  goal?: StudentGoal | null;
  advanceGoal?: boolean;
  sessionId?: string | null;
  authorId?: string | null;
  authorName?: string | null;
}) {
  const { error } = await supabase.from('student_notes').insert({
    student_id: input.studentId,
    content: input.content.trim(),
    title: input.title?.trim() || null,
    marker: input.marker ?? null,
    goal_id: input.goal?.id ?? null,
    session_id: input.sessionId ?? null,
    author_id: input.authorId ?? null,
    author_name: input.authorName ?? null,
  });
  if (error) return { error };
  if (input.advanceGoal && input.goal) {
    const { error: gErr } = await bumpGoal(input.goal, 1);
    if (gErr) return { error: gErr };
  }
  return { error: null };
}

// ── Attendance history (for the student self-view) ────────────────────────────
export type AttendanceVisit = { id: string; checked_in_at: string; session_id: string | null };

/** A student's own check-in history, most-recent first (RLS: linked student only). */
export async function listStudentAttendance(studentId: string): Promise<AttendanceVisit[]> {
  const { data } = await supabase
    .from('session_attendance')
    .select('id, checked_in_at, session_id')
    .eq('kind', 'student')
    .eq('student_id', studentId)
    .order('checked_in_at', { ascending: false });
  return (data as AttendanceVisit[]) ?? [];
}

// ── Single student loader ─────────────────────────────────────────────────────
export async function getStudentById(id: string) {
  const { data } = await supabase.from('students').select('*').eq('id', id).maybeSingle();
  return data as any | null;
}

// ── Account ↔ roster linking ──────────────────────────────────────────────────
// A student signs in with the student code (users row, role=student); a
// coordinator then links that account to the roster row so the student sees
// their own progress — and ONLY theirs (RLS keys off students.user_id).
export type StudentAccount = { id: string; full_name: string; email: string };

/** Student-role accounts in the org that aren't linked to any roster row yet. */
export async function listLinkableAccounts(orgId: string | null): Promise<StudentAccount[]> {
  if (!orgId) return [];
  const [{ data: accounts }, { data: linked }] = await Promise.all([
    supabase.from('users').select('id, full_name, email').eq('organization_id', orgId).eq('role', 'student').order('full_name'),
    supabase.from('students').select('user_id').not('user_id', 'is', null),
  ]);
  const taken = new Set(((linked as any[]) ?? []).map((r) => r.user_id));
  return ((accounts as StudentAccount[]) ?? []).filter((a) => !taken.has(a.id));
}

export async function getAccountById(userId: string): Promise<StudentAccount | null> {
  const { data } = await supabase.from('users').select('id, full_name, email').eq('id', userId).maybeSingle();
  return (data as StudentAccount) ?? null;
}

/** Link (or pass null to unlink) an account to a roster row. */
export async function linkStudentAccount(studentId: string, userId: string | null) {
  return supabase.from('students').update({ user_id: userId }).eq('id', studentId);
}

// ── A tutor's students + their active goal (for the home "Your students" strip) ─
export type StudentWithGoal = {
  student: { id: string; full_name: string; photo_url: string | null; grade: string | null; school: string | null };
  goal: { title: string; completed_checkpoints: number; target_checkpoints: number } | null;
};

export async function myStudentsWithGoals(volunteerId: string): Promise<StudentWithGoal[]> {
  const { data: pairs } = await supabase
    .from('session_attendance')
    .select('student:students(id, full_name, photo_url, grade, school)')
    .eq('kind', 'student')
    .eq('paired_volunteer_id', volunteerId);

  const map = new Map<string, StudentWithGoal['student']>();
  ((pairs as any[]) ?? []).forEach((r) => { if (r.student) map.set(r.student.id, r.student); });
  const students = [...map.values()];
  if (!students.length) return [];

  const { data: goals } = await supabase
    .from('student_goals')
    .select('student_id, title, completed_checkpoints, target_checkpoints')
    .in('student_id', students.map((s) => s.id))
    .eq('status', 'active');

  const goalBy = new Map<string, any>();
  ((goals as any[]) ?? []).forEach((g) => { if (!goalBy.has(g.student_id)) goalBy.set(g.student_id, g); });

  return students
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .map((s) => ({ student: s, goal: goalBy.get(s.id) ?? null }));
}
