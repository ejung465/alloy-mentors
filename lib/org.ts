import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/lib/supabase';

const LAST_ORG_KEY = 'alloy.lastOrg';

export type RememberedOrg = {
  /** The access code the user entered, e.g. "ITB-M". */
  code: string;
  /** The resolved organization id (UUID). */
  orgId: string;
  /** Display name of the organization, e.g. "ITB". */
  orgName: string;
  /** The role this code grants. */
  role: 'member' | 'student';
  /** What this org calls its tutors — singular, e.g. "Mentor". */
  memberNoun: string;
  /** Plural form, e.g. "Mentors". */
  memberNounPlural: string;
};

/**
 * Resolve an entered access code to an organization + role by looking it up in
 * Supabase (the `resolve_org_code` RPC, migration 0015). Each licensed org owns
 * its own member/student codes, so this works for any org — not just ITB.
 * Returns null if the code matches no organization.
 */
export async function resolveOrgCode(input: string): Promise<RememberedOrg | null> {
  const code = input.trim();
  if (!code) return null;
  const { data, error } = await supabase.rpc('resolve_org_code', { p_code: code });
  if (error) { console.warn('[resolveOrgCode]', error.message); return null; }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.org_id) return null;
  return {
    code: code.toUpperCase(),
    orgId: row.org_id,
    orgName: row.org_name,
    role: row.role === 'student' ? 'student' : 'member',
    memberNoun: row.member_noun || 'Tutor',
    memberNounPlural: row.member_noun_plural || 'Tutors',
  };
}

export async function getLastOrg(): Promise<RememberedOrg | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_ORG_KEY);
    return raw ? (JSON.parse(raw) as RememberedOrg) : null;
  } catch {
    return null;
  }
}

export async function setLastOrg(org: RememberedOrg): Promise<void> {
  try {
    await AsyncStorage.setItem(LAST_ORG_KEY, JSON.stringify(org));
  } catch {
    /* ignore */
  }
}

export async function clearLastOrg(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LAST_ORG_KEY);
  } catch {
    /* ignore */
  }
}
