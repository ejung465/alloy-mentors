import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

/** Matches `user_role` in Supabase (see `migrations/0001_roles_and_org.sql`). */
import type { UserRole } from '@/lib/roles';
export type { UserRole };

export type UserProfile = {
  id: string;
  organization_id: string | null;
  email: string;
  full_name: string;
  role: UserRole;
  director_subject: string | null;
  school: string | null;
  birthday: string | null;
  phone: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  location: string | null;
  created_at: string;
  expo_push_token?: string | null;
};

/** The signed-in user's organization — identity, vocabulary, and modules. */
export type Org = {
  id: string;
  name: string;
  orgType: string;                            // volunteer | paid_tutoring | sports | other
  memberNoun: string;                         // singular, e.g. "Mentor" / "Tutor" / "Coach"
  memberNounPlural: string;                   // plural, e.g. "Mentors"
  studentNoun: string;                        // e.g. "Student" / "Athlete" / "Mentee"
  studentNounPlural: string;
  features: Record<string, boolean> | null;   // module toggles (see lib/features)
};

/** Fallback label before the org row loads / for orgs with no custom noun. */
export const DEFAULT_MEMBER_NOUN = 'Tutor';
export const DEFAULT_MEMBER_NOUN_PLURAL = 'Tutors';

type UserContextValue = {
  user: User | null;
  profile: UserProfile | null;
  org: Org | null;
  isLoading: boolean;
  /** Re-pull profile + org (after org creation or settings changes). */
  refresh: () => Promise<void>;
};

const UserContext = createContext<UserContextValue | undefined>(undefined);

function mapProfileRow(row: Record<string, unknown> | null): UserProfile | null {
  if (!row || typeof row.id !== 'string') return null;
  return row as unknown as UserProfile;
}

async function registerPushToken(userId: string) {
  if (!Device.isDevice) return;
  const { status: existing } = await Notifications.getPermissionsAsync();
  const { status } = existing === 'granted' ? { status: existing } : await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return;
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? (Constants as any).easConfig?.projectId;
  if (!projectId) { console.warn('[push] no EAS projectId — token not registered'); return; }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  if (token) await supabase.from('users').update({ expo_push_token: token }).eq('id', userId);
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: false,
    shouldShowBanner: true, shouldShowList: true,
  }),
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [org, setOrg] = useState<Org | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const syncFromSession = useCallback(async (sessionUser: User | null) => {
    if (!sessionUser) {
      setUser(null);
      setProfile(null);
      setOrg(null);
      setIsLoading(false);
      return;
    }

    setUser(sessionUser);

    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', sessionUser.id)
      .maybeSingle();

    if (error) {
      console.warn('[UserContext] profile fetch failed:', error.message);
      setProfile(null);
      setOrg(null);
    } else {
      const p = mapProfileRow(data as Record<string, unknown> | null);
      setProfile(p);
      // Fetch the org (name + tutor label) so screens can render the right copy.
      if (p?.organization_id) {
        const { data: o } = await supabase
          .from('organizations')
          .select('id, name, org_type, member_noun, member_noun_plural, student_noun, student_noun_plural, features')
          .eq('id', p.organization_id)
          .maybeSingle();
        setOrg(
          o
            ? {
                id: o.id as string,
                name: (o.name as string) ?? '',
                orgType: (o.org_type as string) || 'volunteer',
                memberNoun: (o.member_noun as string) || DEFAULT_MEMBER_NOUN,
                memberNounPlural: (o.member_noun_plural as string) || DEFAULT_MEMBER_NOUN_PLURAL,
                studentNoun: (o.student_noun as string) || 'Student',
                studentNounPlural: (o.student_noun_plural as string) || 'Students',
                features: (o.features as Record<string, boolean> | null) ?? null,
              }
            : null
        );
      } else {
        setOrg(null);
      }
      // Register push token in background — non-blocking
      registerPushToken(sessionUser.id).catch(() => {});
    }

    setIsLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      // Defer async work so the Supabase client does not deadlock inside the callback.
      setTimeout(() => {
        if (cancelled) return;
        void (async () => {
          setIsLoading(true);
          await syncFromSession(session?.user ?? null);
        })();
      }, 0);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [syncFromSession]);

  const refresh = useCallback(async () => {
    const { data: { user: current } } = await supabase.auth.getUser();
    await syncFromSession(current ?? null);
  }, [syncFromSession]);

  const value = useMemo(
    () => ({ user, profile, org, isLoading, refresh }),
    [user, profile, org, isLoading, refresh]
  );

  return (
    <UserContext.Provider value={value}>{children}</UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (ctx === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return ctx;
}
