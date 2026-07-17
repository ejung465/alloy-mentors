import AsyncStorage from '@react-native-async-storage/async-storage';
import type { UserRole } from '@/lib/roles';

/**
 * Alloy — first-run coachmark tours.
 *
 * A tiny, dependency-free tour model: a short ordered list of steps per role,
 * introducing the concepts that role actually touches. `<TourOverlay>` reads
 * these and steps through them the first time a given role opens the app.
 *
 * "Seen" state is tracked per-role in AsyncStorage (same storage the app uses
 * elsewhere, e.g. the notification toggle in profile.tsx) so each role's tour
 * is remembered independently — an admin who later views the student side, or a
 * shared demo device, each get the right first-run experience.
 */

export type TourAudience = 'admin' | 'mentor' | 'student';

export type TourStep = {
  title: string;
  body: string;
};

/**
 * Map any concrete UserRole onto one of the three tour audiences.
 * Leadership + directors get the "admin" tour (they run the org);
 * members/mentors get the "mentor" tour; students get their own.
 */
export function tourAudienceForRole(role?: string | null): TourAudience {
  switch (role) {
    case 'admin':
    case 'president':
    case 'vp':
    case 'director':
      return 'admin';
    case 'student':
      return 'student';
    default:
      return 'mentor';
  }
}

export const TOUR_STEPS: Record<TourAudience, TourStep[]> = {
  admin: [
    {
      title: 'Welcome to Alloy',
      body: 'You run this organization. This quick tour points out the few places admins spend most of their time. You can skip it anytime.',
    },
    {
      title: 'Invite your people',
      body: 'Open Org Settings to find your join codes — one for mentors, one for students. Share a code and anyone who enters it lands straight in your org with the right role.',
    },
    {
      title: 'Turn features on or off',
      body: 'Every org is different. In Org Settings, feature toggles let you switch modules like hour tracking, QR check-in, progress, and guardian updates on or off for your whole org.',
    },
    {
      title: 'The director panel',
      body: 'Promote leaders and subject directors from the admin panel. Directors can approve hours and run check-in for their area, so you are not the only bottleneck.',
    },
    {
      title: 'Keep an eye on growth',
      body: 'The home dashboard rolls up sessions, hours, and at-risk students across the org. Tap into any student to see their full progress timeline.',
    },
  ],
  mentor: [
    {
      title: 'Welcome to Alloy',
      body: 'Alloy keeps the busywork out of mentoring so you can focus on your students. Here is the 30-second version — skip whenever you like.',
    },
    {
      title: 'Check in with your QR',
      body: 'Your personal check-in QR lives on the home screen. Show it at the door kiosk to be marked present. It re-signs itself every few seconds, so screenshots will not work.',
    },
    {
      title: 'Log your hours',
      body: 'After a session, log your hours in a couple of taps. Leadership reviews and approves them, and approved hours roll up into a signed verification PDF you can export.',
    },
    {
      title: 'Track student progress',
      body: 'Open a student to record session notes and update goals and skills. Those notes build the growth timeline that shows how far your student has come.',
    },
    {
      title: 'Stay in the loop',
      body: 'Chat, the calendar, and announcements keep you connected to your org. RSVP to upcoming sessions so everyone knows who is coming.',
    },
  ],
  student: [
    {
      title: 'Welcome to Alloy',
      body: 'This is your space to see how you are doing and stay on top of your sessions. Quick tour — feel free to skip.',
    },
    {
      title: 'See your progress',
      body: 'Your progress screen shows your goals, the skills you are building, and a timeline of everything you have worked on with your mentor.',
    },
    {
      title: 'Know what is next',
      body: 'The calendar shows your upcoming sessions. Tap a session to RSVP so your mentor knows to expect you.',
    },
    {
      title: 'Stay connected',
      body: 'Use chat to message your mentor, and watch for announcements from your organization about schedule changes and events.',
    },
  ],
};

/** Storage key namespace — one entry per role audience. */
const TOUR_SEEN_PREFIX = 'alloy.tourSeen.';

function keyFor(role: string | null | undefined): string {
  return `${TOUR_SEEN_PREFIX}${tourAudienceForRole(role)}`;
}

/** Has this role already completed (or skipped) its tour on this device? */
export async function hasSeenTour(role?: UserRole | string | null): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(keyFor(role));
    return v === '1';
  } catch {
    // If storage is unavailable, fail "seen" so we never trap a user in a
    // tour we cannot dismiss.
    return true;
  }
}

/** Mark this role's tour as seen so it does not show again. */
export async function markTourSeen(role?: UserRole | string | null): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(role), '1');
  } catch {
    // Best-effort — a failed write just means the tour may show again later.
  }
}

/** Test/dev helper: clear a role's seen flag so its tour shows again. */
export async function resetTourSeen(role?: UserRole | string | null): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(role));
  } catch {
    // no-op
  }
}
