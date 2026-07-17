import { supabase } from '@/lib/supabase';
import { getAttendanceStreak } from '@/lib/checkin';

/**
 * Badge-awarding logic (pure logic module — no UI).
 *
 * Badge definitions live in `public.badge_definitions` (seeded in migration
 * 0025). A user earns a badge when a stat crosses the definition's threshold.
 * `criteria_type` maps to a stat:
 *   - 'session_count' → sessions the member has been checked in to
 *   - 'streak_weeks'  → consecutive-week attendance streak
 *   - 'hours_total'   → total APPROVED hours logged
 *   - 'goal_completed'→ achieved learning goals (student-facing; see note below)
 *   - 'manual'        → admin hands these out by hand (never auto-checked)
 *
 * Auto-award inserts rely on the `user_badges` self-insert RLS policy added in
 * migration 0029 (user_id = auth.uid()); the insert uses ignoreDuplicates so
 * this is safe to call as often as you like (after every check-in, every hours
 * approval, etc.) without erroring or duplicating rows.
 */

/** criteria_type values that are NEVER auto-awarded — leadership hands these out. */
export const MANUAL_CRITERIA_TYPE = 'manual';

/** The manual-only badge keys from the 0025 seed data. */
export const MANUAL_BADGE_KEYS = ['founding_member', 'mvp'] as const;

export type BadgeDefinition = {
  key: string;
  label: string;
  description: string;
  icon: string;
  color: string;
  criteria_type: 'session_count' | 'streak_weeks' | 'hours_total' | 'goal_completed' | 'manual';
  criteria_value: number | null;
};

type UserStats = {
  sessionCount: number;
  streakWeeks: number;
  hoursTotal: number;
  goalsAchieved: number;
};

/** Gather every stat the auto-checked criteria types compare against. */
async function getUserStats(userId: string): Promise<UserStats> {
  const [sessionsRes, streak, hoursRes, goalsRes] = await Promise.all([
    // Sessions attended as a volunteer/member.
    supabase
      .from('session_attendance')
      .select('id', { count: 'exact', head: true })
      .eq('kind', 'volunteer')
      .eq('volunteer_id', userId),
    // Consecutive-week attendance streak (existing helper).
    getAttendanceStreak(userId),
    // Total APPROVED hours.
    supabase
      .from('hours_logs')
      .select('hours')
      .eq('mentor_id', userId)
      .eq('status', 'approved'),
    // Achieved goals. Goals are keyed by student_id (students, not member users),
    // so for member users this typically returns 0 — goal badges only auto-award
    // for a user whose id matches a student record. We don't hard-block it, per
    // spec, so a student who somehow has a user id could still qualify.
    supabase
      .from('student_goals')
      .select('id', { count: 'exact', head: true })
      .eq('student_id', userId)
      .eq('status', 'achieved'),
  ]);

  const hoursTotal = (hoursRes.data ?? []).reduce(
    (acc: number, r: { hours: number | string }) => acc + Number(r.hours || 0),
    0
  );

  return {
    sessionCount: sessionsRes.count ?? 0,
    streakWeeks: streak ?? 0,
    hoursTotal,
    goalsAchieved: goalsRes.count ?? 0,
  };
}

/** True if the user's stats satisfy a (non-manual) badge definition. */
function criteriaMet(def: BadgeDefinition, stats: UserStats): boolean {
  const threshold = def.criteria_value ?? 0;
  switch (def.criteria_type) {
    case 'session_count':
      return stats.sessionCount >= threshold;
    case 'streak_weeks':
      return stats.streakWeeks >= threshold;
    case 'hours_total':
      return stats.hoursTotal >= threshold;
    case 'goal_completed':
      return stats.goalsAchieved >= threshold;
    default:
      return false; // 'manual' and anything unknown are never auto-awarded
  }
}

/**
 * Check the user's current stats against every auto-checkable badge definition
 * and award any newly-earned ones. Safe to call frequently — repeat calls are
 * idempotent (self-insert RLS + ignoreDuplicates upsert).
 *
 * @returns the badge keys that were newly awarded on THIS call (so a caller can
 *          show a celebratory toast). Empty array if nothing new.
 */
export async function checkAndAwardBadges(userId: string): Promise<string[]> {
  if (!userId) return [];

  const [defsRes, ownedRes, stats] = await Promise.all([
    supabase
      .from('badge_definitions')
      .select('key, label, description, icon, color, criteria_type, criteria_value'),
    supabase.from('user_badges').select('badge_key').eq('user_id', userId),
    getUserStats(userId),
  ]);

  const defs = (defsRes.data as BadgeDefinition[] | null) ?? [];
  const owned = new Set(((ownedRes.data as { badge_key: string }[] | null) ?? []).map((r) => r.badge_key));

  const toAward = defs
    .filter((d) => d.criteria_type !== MANUAL_CRITERIA_TYPE) // never auto-award manual badges
    .filter((d) => !owned.has(d.key)) // skip badges the user already has
    .filter((d) => criteriaMet(d, stats))
    .map((d) => d.key);

  if (toAward.length === 0) return [];

  const rows = toAward.map((badge_key) => ({ user_id: userId, badge_key }));
  const { error } = await supabase
    .from('user_badges')
    .upsert(rows, { onConflict: 'user_id,badge_key', ignoreDuplicates: true });

  if (error) {
    console.warn('[checkAndAwardBadges]', error.message);
    return [];
  }
  return toAward;
}

/**
 * Leadership hands out a manual badge (e.g. "MVP", "Founding Member") to another
 * org member. `user_badges` has no client INSERT-on-behalf-of-others policy, so
 * this routes through the `award_manual_badge` SECURITY DEFINER function added
 * in migration 0029, which enforces is_leadership() + same-org membership.
 *
 * @param awardedBy purely informational for callers/audit; the DB derives the
 *                  authorising actor from auth.uid() server-side.
 */
export async function awardManualBadge(
  userId: string,
  badgeKey: string,
  awardedBy: string
): Promise<{ ok: boolean; error?: string }> {
  void awardedBy; // actor is enforced server-side via is_leadership()
  const { error } = await supabase.rpc('award_manual_badge', {
    p_user_id: userId,
    p_badge_key: badgeKey,
  });
  if (error) {
    console.warn('[awardManualBadge]', error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
