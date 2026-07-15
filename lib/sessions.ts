import { supabase } from '@/lib/supabase';

/** Row shape from `public.sessions` (see `supabase_schema.sql`). */
export type SessionRow = {
  id: string;
  organization_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_time: string;
  end_time: string;
  created_at: string;
};

export type RsvpStatus = 'none' | 'going' | 'not_going';

/** UI-facing session (matches previous mock-driven screens). */
export type SessionListItem = {
  id: string;
  isoDate: string;
  title: string;
  time: string;
  location: string | null;
  tag: 'UPCOMING' | 'OPTIONAL' | 'NEW';
  description?: string;
  start_time: string;
  end_time: string;
  startMs: number;
  endMs: number;
};

function formatTime(d: Date) {
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function toLocalYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function mapSessionRow(row: SessionRow): SessionListItem {
  const start = new Date(row.start_time);
  const end = new Date(row.end_time);
  const created = new Date(row.created_at);
  const now = Date.now();
  const isoDate = toLocalYMD(start);
  const time = `${formatTime(start)} – ${formatTime(end)}`;

  let tag: SessionListItem['tag'] = 'UPCOMING';
  if (end.getTime() < now) tag = 'OPTIONAL';
  else if (
    start.getTime() > now &&
    now - created.getTime() < 14 * 24 * 60 * 60 * 1000
  ) {
    tag = 'NEW';
  }

  return {
    id: row.id,
    isoDate,
    title: row.title,
    time,
    location: row.location ?? null,
    tag,
    description: row.description ?? undefined,
    start_time: row.start_time,
    end_time: row.end_time,
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

export async function fetchSessionsOrdered(): Promise<SessionListItem[]> {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .order('start_time', { ascending: true });

  if (error) {
    console.warn('[sessions] fetch failed:', error.message);
    return [];
  }

  return (data as SessionRow[] | null)?.map(mapSessionRow) ?? [];
}

const WEEKDAY_FULL = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

export function formatSessionLongDate(isoStart: string) {
  const d = new Date(isoStart);
  return `${WEEKDAY_FULL[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

export function formatSessionTimeRange(isoStart: string, isoEnd: string) {
  return `${formatTime(new Date(isoStart))} – ${formatTime(new Date(isoEnd))}`;
}

/** Insert a new session/event. Returns the new id or an error. */
export async function createSession(input: {
  title: string;
  description?: string | null;
  location?: string | null;
  startISO: string;
  endISO: string;
  organizationId?: string | null;
  createdBy?: string | null;
}) {
  const row: Record<string, unknown> = {
    title: input.title,
    description: input.description ?? null,
    location: input.location ?? null,
    start_time: input.startISO,
    end_time: input.endISO,
  };
  if (input.organizationId) row.organization_id = input.organizationId;
  if (input.createdBy) row.created_by = input.createdBy;
  return supabase.from('sessions').insert(row).select('id').single();
}

// ── RSVP ────────────────────────────────────────────────────────────────────

export async function getMyRsvp(sessionId: string, userId: string): Promise<RsvpStatus> {
  const { data } = await supabase
    .from('session_rsvps')
    .select('status')
    .eq('session_id', sessionId)
    .eq('user_id', userId)
    .maybeSingle<{ status: 'going' | 'not_going' }>();
  return data?.status ?? 'none';
}

export async function setMyRsvp(sessionId: string, userId: string, status: 'going' | 'not_going') {
  return supabase
    .from('session_rsvps')
    .upsert(
      { session_id: sessionId, user_id: userId, status, updated_at: new Date().toISOString() },
      { onConflict: 'session_id,user_id' }
    );
}

export type RsvpCoverage = { going: number; notGoing: number; noResponse: number; total: number };

/**
 * Staffing coverage for a session — "4 of 7 confirmed". Scoped to members+
 * (not students, who RSVP separately as attendees, not staff) in the org.
 */
export async function getRsvpCoverage(sessionId: string, orgId: string | null): Promise<RsvpCoverage> {
  if (!orgId) return { going: 0, notGoing: 0, noResponse: 0, total: 0 };
  const [{ data: members }, { data: rsvps }] = await Promise.all([
    supabase.from('users').select('id').eq('organization_id', orgId).neq('role', 'student'),
    supabase.from('session_rsvps').select('user_id, status').eq('session_id', sessionId),
  ]);
  const memberIds = new Set((members ?? []).map((m: any) => m.id));
  const total = memberIds.size;
  let going = 0, notGoing = 0;
  (rsvps ?? []).forEach((r: any) => {
    if (!memberIds.has(r.user_id)) return;
    if (r.status === 'going') going++;
    else if (r.status === 'not_going') notGoing++;
  });
  return { going, notGoing, noResponse: Math.max(0, total - going - notGoing), total };
}
