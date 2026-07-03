import type { Org } from '@/contexts/UserContext';

/**
 * The platform's three layers:
 *   1. BASE (every org, not listed here): accounts, roles, join codes,
 *      announcements, chat, calendar/sessions, profiles.
 *   2. FEATURE MODULES (below): admins toggle these per org.
 *   3. VOCABULARY: what the org calls its people (member/student nouns).
 *
 * Gate UI with `featureEnabled(org, key)` — never hardcode a module surface.
 */

export type FeatureKey =
  | 'hours'            // hour logging + director approval + verification PDF
  | 'checkin'          // QR check-in kiosk + rotating member QR
  | 'progress'         // student goals / skills / growth timeline
  | 'session_notes'    // per-student session notes
  | 'guardian_digests' // "how your child is doing" updates home
  | 'gamification';    // ranks, tiers, streak flair

export const FEATURES: Record<FeatureKey, { label: string; description: string; icon: string; default: boolean }> = {
  hours: {
    label: 'Hour tracking',
    description: 'Members log hours; leadership reviews and approves them. Includes the signed verification PDF.',
    icon: 'time-outline',
    default: true,
  },
  checkin: {
    label: 'QR check-in',
    description: 'Session attendance via each member’s rotating QR code and the door kiosk.',
    icon: 'qr-code-outline',
    default: true,
  },
  progress: {
    label: 'Progress tracking',
    description: 'Goals, skill mastery, and a growth timeline for every student.',
    icon: 'trending-up-outline',
    default: true,
  },
  session_notes: {
    label: 'Session notes',
    description: 'Members record what each session covered — the raw material of the growth timeline.',
    icon: 'reader-outline',
    default: true,
  },
  guardian_digests: {
    label: 'Guardian updates',
    description: 'Plain-language progress summaries to send home to parents and guardians.',
    icon: 'mail-outline',
    default: true,
  },
  gamification: {
    label: 'Ranks & streaks',
    description: 'Leaderboard ranks and tier badges to keep members motivated.',
    icon: 'trophy-outline',
    default: true,
  },
};

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/** Org templates — one tap fills vocabulary + modules; everything stays editable. */
export type OrgType = 'volunteer' | 'paid_tutoring' | 'sports' | 'other';

export const ORG_PRESETS: Record<OrgType, {
  label: string;
  blurb: string;
  icon: string;
  memberNoun: string; memberNounPlural: string;
  studentNoun: string; studentNounPlural: string;
  features: Record<FeatureKey, boolean>;
}> = {
  volunteer: {
    label: 'Volunteer tutoring',
    blurb: 'Track volunteer hours, attendance, and student growth.',
    icon: 'heart-outline',
    memberNoun: 'Tutor', memberNounPlural: 'Tutors',
    studentNoun: 'Student', studentNounPlural: 'Students',
    features: { hours: true, checkin: true, progress: true, session_notes: true, guardian_digests: true, gamification: true },
  },
  paid_tutoring: {
    label: 'Tutoring business',
    blurb: 'Client progress and parent updates — no volunteer-hour approvals.',
    icon: 'briefcase-outline',
    memberNoun: 'Tutor', memberNounPlural: 'Tutors',
    studentNoun: 'Student', studentNounPlural: 'Students',
    features: { hours: false, checkin: true, progress: true, session_notes: true, guardian_digests: true, gamification: false },
  },
  sports: {
    label: 'Sports coaching',
    blurb: 'Practice attendance and athlete skill development.',
    icon: 'basketball-outline',
    memberNoun: 'Coach', memberNounPlural: 'Coaches',
    studentNoun: 'Athlete', studentNounPlural: 'Athletes',
    features: { hours: false, checkin: true, progress: true, session_notes: true, guardian_digests: false, gamification: true },
  },
  other: {
    label: 'Something else',
    blurb: 'Start with the essentials and switch on what you need.',
    icon: 'sparkles-outline',
    memberNoun: 'Mentor', memberNounPlural: 'Mentors',
    studentNoun: 'Mentee', studentNounPlural: 'Mentees',
    features: { hours: false, checkin: false, progress: true, session_notes: true, guardian_digests: false, gamification: false },
  },
};

/**
 * Is a module on for this org? Null org / null features (pre-0019 rows or
 * still loading) fall back to ON so nothing existing disappears.
 */
export function featureEnabled(org: Org | null | undefined, key: FeatureKey): boolean {
  if (!org || !org.features) return true;
  const v = org.features[key];
  return typeof v === 'boolean' ? v : FEATURES[key].default;
}
