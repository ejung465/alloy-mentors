// Supabase Edge Function — invoked on a schedule (pg_cron, once daily; see
// migrations/0027_at_risk_cron.sql) rather than by a table webhook.
//
// For every organization with at-risk alerts enabled (organizations.at_risk_weeks
// > 0), finds active students who haven't attended a session in at least
// at_risk_weeks * 7 days (or have never attended at all) and notifies:
//   (a) the student, if they have a linked account, and
//   (b) every admin/president/vp in the org,
// via an in-app notifications row + push (when the recipient has a token and
// notifications enabled).
//
// Dedup ("once per at-risk episode"): a student is skipped if they were
// already alerted since their last attendance (last_at_risk_alert_at more
// recent than their last check-in), or if they were alerted within the last
// 7 days — this second check specifically caps re-alert frequency for
// students who have never attended at all (no attendance timestamp to reset
// the episode against), and also acts as a general safety net.
//
// Deploy: npx supabase functions deploy at-risk-alerts --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const DAY_MS = 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * DAY_MS;

type PushMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: string;
};

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const now = new Date();

  const { data: orgs } = await supabase
    .from('organizations')
    .select('id, at_risk_weeks')
    .gt('at_risk_weeks', 0);

  if (!orgs || orgs.length === 0) {
    return new Response(JSON.stringify({ orgsChecked: 0, studentsAlerted: 0 }), { status: 200 });
  }

  const pushMessages: PushMessage[] = [];
  let studentsAlerted = 0;

  for (const org of orgs) {
    const cutoffMs = org.at_risk_weeks * 7 * DAY_MS;

    const { data: students } = await supabase
      .from('students')
      .select('id, full_name, user_id, last_at_risk_alert_at')
      .eq('organization_id', org.id)
      .eq('active', true);

    if (!students || students.length === 0) continue;

    const studentIds = students.map((s: any) => s.id);

    // Most recent attendance per student — one query, reduced in JS. Sorted
    // desc so the first row seen for a given student_id is their latest.
    const { data: attendance } = await supabase
      .from('session_attendance')
      .select('student_id, checked_in_at')
      .eq('kind', 'student')
      .in('student_id', studentIds)
      .order('checked_in_at', { ascending: false });

    const lastAttendanceByStudent = new Map<string, Date>();
    for (const row of attendance ?? []) {
      if (!lastAttendanceByStudent.has(row.student_id)) {
        lastAttendanceByStudent.set(row.student_id, new Date(row.checked_in_at));
      }
    }

    // Students that are genuinely at risk AND pass the dedup check.
    const atRiskStudents: Array<{
      id: string;
      full_name: string;
      user_id: string | null;
      lastAttendance: Date | null;
    }> = [];

    for (const student of students as any[]) {
      const lastAttendance = lastAttendanceByStudent.get(student.id) ?? null;
      const isAtRisk = !lastAttendance || (now.getTime() - lastAttendance.getTime()) > cutoffMs;
      if (!isAtRisk) continue;

      const alertedAt = student.last_at_risk_alert_at ? new Date(student.last_at_risk_alert_at) : null;
      const alreadyAlertedSinceAttendance =
        !!alertedAt && !!lastAttendance && alertedAt.getTime() > lastAttendance.getTime();
      const alertedRecently = !!alertedAt && (now.getTime() - alertedAt.getTime()) < SEVEN_DAYS_MS;
      if (alreadyAlertedSinceAttendance || alertedRecently) continue;

      atRiskStudents.push({
        id: student.id,
        full_name: student.full_name,
        user_id: student.user_id,
        lastAttendance,
      });
    }

    if (atRiskStudents.length === 0) continue;

    // Org admins — fetched once per org, reused for every at-risk student.
    const { data: admins } = await supabase
      .from('users')
      .select('id, expo_push_token, notifications_enabled')
      .eq('organization_id', org.id)
      .in('role', ['admin', 'president', 'vp']);

    // Push/notification-enabled lookup for at-risk students who have their
    // own linked account.
    const linkedUserIds = atRiskStudents
      .map((s) => s.user_id)
      .filter((id): id is string => !!id);
    const linkedUsersById = new Map<string, { expo_push_token: string | null; notifications_enabled: boolean }>();
    if (linkedUserIds.length > 0) {
      const { data: linkedUsers } = await supabase
        .from('users')
        .select('id, expo_push_token, notifications_enabled')
        .in('id', linkedUserIds);
      for (const u of (linkedUsers ?? []) as any[]) {
        linkedUsersById.set(u.id, {
          expo_push_token: u.expo_push_token,
          notifications_enabled: u.notifications_enabled,
        });
      }
    }

    const notificationRows: Array<Record<string, unknown>> = [];

    for (const student of atRiskStudents) {
      const weeksSince = student.lastAttendance
        ? Math.floor((now.getTime() - student.lastAttendance.getTime()) / (7 * DAY_MS))
        : null;

      const studentTimeDesc = weeksSince === null
        ? "you haven't checked in yet"
        : `it's been ${weeksSince} week${weeksSince === 1 ? '' : 's'} since your last session`;
      const studentTitle = 'We miss you!';
      const studentBody = `Hey ${student.full_name.split(' ')[0]}, ${studentTimeDesc}. We'd love to see you back soon!`;

      // (a) notify the student, if they have a linked account
      if (student.user_id) {
        notificationRows.push({
          user_id: student.user_id,
          organization_id: org.id,
          type: 'at_risk',
          title: studentTitle,
          body: studentBody,
          data: { studentId: student.id },
        });

        const linked = linkedUsersById.get(student.user_id);
        if (linked?.notifications_enabled && linked.expo_push_token) {
          pushMessages.push({
            to: linked.expo_push_token,
            title: studentTitle,
            body: studentBody,
            data: { studentId: student.id },
            sound: 'default',
          });
        }
      }

      // (b) notify every admin/president/vp in the org
      const adminTimeDesc = weeksSince === null
        ? 'has never checked in'
        : `hasn't checked in for ${weeksSince} week${weeksSince === 1 ? '' : 's'}`;
      const adminTitle = `${student.full_name} may be at risk`;
      const adminBody = `${student.full_name} ${adminTimeDesc}.`;

      for (const admin of (admins ?? []) as any[]) {
        notificationRows.push({
          user_id: admin.id,
          organization_id: org.id,
          type: 'at_risk',
          title: adminTitle,
          body: adminBody,
          data: { studentId: student.id },
        });

        if (admin.notifications_enabled && admin.expo_push_token) {
          pushMessages.push({
            to: admin.expo_push_token,
            title: adminTitle,
            body: adminBody,
            data: { studentId: student.id },
            sound: 'default',
          });
        }
      }

      studentsAlerted++;
    }

    if (notificationRows.length > 0) {
      await supabase.from('notifications').insert(notificationRows);
    }

    // (c) mark each alerted student so they aren't re-alerted until they
    // either attend again or the 7-day cooldown passes.
    await supabase
      .from('students')
      .update({ last_at_risk_alert_at: now.toISOString() })
      .in('id', atRiskStudents.map((s) => s.id));
  }

  if (pushMessages.length > 0) {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(pushMessages),
    });
  }

  return new Response(JSON.stringify({ orgsChecked: orgs.length, studentsAlerted }), { status: 200 });
});
