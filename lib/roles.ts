import { colors } from '@/lib/theme';

/**
 * Alloy role model.
 * - admin      → founder / app owner, full control
 * - president  → org leadership
 * - vp         → org leadership
 * - director   → board director for a subject (director_subject)
 * - member     → regular volunteer (legacy value 'mentor' is treated the same)
 * - student    → tutored student
 */
export type UserRole =
  | 'admin'
  | 'president'
  | 'vp'
  | 'director'
  | 'member'
  | 'mentor' // legacy alias for member
  | 'student';

/** Can manage the org: promote roles, broadcast, see org-wide overview. */
export const LEADERSHIP: UserRole[] = ['admin', 'president', 'vp'];

/** Can create events, announcements, and run check-in. */
export const ELEVATED: UserRole[] = ['admin', 'president', 'vp', 'director'];

/** Volunteer-side roles (everyone who isn't a student). */
export const VOLUNTEER_ROLES: UserRole[] = [
  'admin',
  'president',
  'vp',
  'director',
  'member',
  'mentor',
];

export function isLeadership(role?: string | null): boolean {
  return !!role && LEADERSHIP.includes(role as UserRole);
}

export function canManageOrg(role?: string | null): boolean {
  return isLeadership(role);
}

/** Create events / announcements / run check-in. */
export function canCreateEvents(role?: string | null): boolean {
  return !!role && ELEVATED.includes(role as UserRole);
}

export function isVolunteer(role?: string | null): boolean {
  return !!role && VOLUNTEER_ROLES.includes(role as UserRole);
}

export function isStudent(role?: string | null): boolean {
  return role === 'student';
}

/**
 * Human label for a role (board directors include their subject).
 * `memberNoun` is the org's word for a tutor (Tutor / Volunteer / Mentor);
 * pass `org.memberNoun` from context. Defaults to "Tutor".
 */
export function roleLabel(role?: string | null, subject?: string | null, memberNoun?: string | null): string {
  switch (role) {
    case 'admin':
      return 'Admin';
    case 'president':
      return 'President';
    case 'vp':
      return 'Vice President';
    case 'director':
      return subject ? `${subject} Director` : 'Board Director';
    case 'member':
    case 'mentor':
      return memberNoun || 'Tutor';
    case 'student':
      return 'Student';
    default:
      return memberNoun || 'Member';
  }
}

/** Accent colour used for role chips/badges. */
export function roleColor(role?: string | null): string {
  switch (role) {
    case 'admin':
    case 'president':
    case 'vp':
      return colors.gold; // leadership
    case 'director':
      return colors.titanium;
    case 'student':
      return colors.iris;
    default:
      return colors.silver; // member / volunteer
  }
}

/** Roles a leader is allowed to assign from the admin panel. */
export const ASSIGNABLE_ROLES: UserRole[] = ['member', 'director', 'vp', 'president', 'admin', 'student'];
