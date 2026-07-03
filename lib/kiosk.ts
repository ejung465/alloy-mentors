import { supabase } from '@/lib/supabase';

export type SessionRow = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  location?: string | null;
  start_time: string;
  end_time: string;
  created_at: string;
};

export type StudentListItem = {
  id: string;
  full_name: string;
  school: string | null;
};

function dayBoundsUtc(date: Date | string): { start: Date; end: Date } {
  const day = typeof date === 'string' ? new Date(date) : date;
  const start = new Date(day);
  start.setHours(9, 0, 0, 0);
  const end = new Date(day);
  end.setHours(17, 0, 0, 0);
  return { start, end };
}

export async function getNextUpcomingSession() {
  return supabase
    .from('sessions')
    .select('*')
    .gte('end_time', new Date().toISOString())
    .order('start_time', { ascending: true })
    .limit(1)
    .maybeSingle<SessionRow>();
}

export async function listStudents() {
  return supabase
    .from('users')
    .select('id, full_name, school')
    .eq('role', 'student')
    .order('full_name', { ascending: true })
    .returns<StudentListItem[]>();
}

export async function getUserFullName(user_id: string) {
  return supabase
    .from('users')
    .select('full_name')
    .eq('id', user_id)
    .maybeSingle<{ full_name: string }>();
}

export async function undoStudentRouting(student_id: string, event_id: string) {
  return supabase.from('attendance').delete().match({ event_id, user_id: student_id });
}

export async function addStudentToRoster(
  fullName: string,
  school: string,
  orgId: string
) {
  return supabase.rpc('create_student_record', {
    p_full_name: fullName,
    p_school: school,
    p_org_id: orgId,
  });
}

/**
 * Inserts a new session for the kiosk / org calendar.
 * Expects `sessions.location` (run kiosk_attendance.sql ALTER) or falls back to description only.
 */
export async function createSession(
  title: string,
  date: Date | string,
  location: string,
  org_id: string
) {
  const { start, end } = dayBoundsUtc(date);
  const loc = location.trim();

  const row: Record<string, unknown> = {
    title,
    organization_id: org_id,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
  };

  if (loc) {
    row.location = loc;
    row.description = `Location: ${loc}`;
  }

  return supabase.from('sessions').insert(row).select('id').single();
}

/**
 * Mentor marks themselves present for an event.
 * Relies on UNIQUE (event_id, user_id) on `attendance`.
 */
export async function checkInMentor(mentor_id: string, event_id: string) {
  return supabase.from('attendance').upsert(
    {
      event_id,
      user_id: mentor_id,
      status: 'checked_in',
      check_in_time: new Date().toISOString(),
    },
    { onConflict: 'event_id,user_id' }
  );
}

/**
 * Picks the least-loaded checked-in mentor (RPC) and records the student on `attendance`.
 */
export async function routeStudent(student_id: string, event_id: string) {
  const { data: mentorId, error: rpcError } = await supabase.rpc('get_best_mentor', {
    p_event_id: event_id,
  });

  if (rpcError) {
    return { data: null, error: rpcError };
  }

  if (mentorId == null || mentorId === '') {
    return {
      data: null,
      error: new Error('No checked-in mentor available for this event.'),
    };
  }

  const { data, error } = await supabase.from('attendance').upsert(
    {
      event_id,
      user_id: student_id,
      status: 'routed',
      assigned_mentor_id: mentorId as string,
      check_in_time: new Date().toISOString(),
    },
    { onConflict: 'event_id,user_id' }
  );

  return { data, error, mentor_id: mentorId as string };
}
