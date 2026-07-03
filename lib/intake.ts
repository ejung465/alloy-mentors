import { supabase } from '@/lib/supabase';

// ── Option sets ──────────────────────────────────────────────────────────────
export const SUBJECTS = ['Math', 'English / Reading', 'ESL', 'Science', 'Music', 'History', 'Computers / Coding', 'Test Prep'];
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const TIMES = ['Morning', 'Afternoon', 'Evening'];
export const TSHIRTS = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'];
export const ENGLISH_LEVELS = ['Newcomer', 'Beginner', 'Intermediate', 'Advanced', 'Fluent'];
export const TRANSPORT = ['Own car', 'Gets a ride', 'Public transit', 'Walks / bikes', 'Needs a ride'];

// ── Consent documents (from legal research — SAMPLE TEMPLATE TEXT ONLY) ──────
export const CONSENT_DISCLAIMER =
  'These are sample acknowledgments for planning only — not legal advice, and not final binding text. Your organization must have a licensed attorney review and approve all consent wording before relying on it.';

export type ConsentDoc = {
  key: string;
  name: string;
  sample: string;
  required: boolean;
  defaultGranted: boolean;   // media release defaults OFF
  guardianRequiredIfMinor: boolean;
};

export const VOLUNTEER_CONSENTS: ConsentDoc[] = [
  { key: 'liability_waiver', name: 'Liability Waiver & Release', required: true, defaultGranted: false, guardianRequiredIfMinor: true,
    sample: 'I understand and voluntarily accept the risks of participating, and, to the extent permitted by law, release the organization from liability arising from my participation. [TEMPLATE — attorney review required]' },
  { key: 'code_of_conduct', name: 'Code of Conduct & No One-on-One Policy', required: true, defaultGranted: false, guardianRequiredIfMinor: true,
    sample: 'I agree to follow the Code of Conduct, including child-safety rules: no unsupervised one-on-one contact (in person or in chat) with students. [TEMPLATE]' },
  { key: 'mandatory_reporter', name: 'Mandatory-Reporter / Child-Safety Acknowledgment', required: true, defaultGranted: false, guardianRequiredIfMinor: false,
    sample: 'I understand my responsibility to recognize and promptly report suspected child abuse or neglect. [TEMPLATE]' },
  { key: 'background_check', name: 'Background-Check Authorization (adults)', required: false, defaultGranted: false, guardianRequiredIfMinor: false,
    sample: 'I authorize the organization to obtain a background check to evaluate my volunteer eligibility. [TEMPLATE — adults only]' },
  { key: 'data_privacy', name: 'Data Privacy & In-App Messaging Consent', required: true, defaultGranted: false, guardianRequiredIfMinor: true,
    sample: 'I have read the Privacy Notice and consent to the collection and use of my data and to the in-app messaging terms. [TEMPLATE]' },
  { key: 'photo_media', name: 'Photo / Media Release (optional)', required: false, defaultGranted: false, guardianRequiredIfMinor: true,
    sample: 'I grant permission to use photos or video of me in the organization’s communications. (Leave off to decline — declining will not affect participation.) [TEMPLATE]' },
];

// ── OTP (6-digit email code) ─────────────────────────────────────────────────
export async function sendEmailOtp(email: string) {
  return supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true },
  });
}

export async function verifyEmailOtp(email: string, token: string) {
  return supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email',
  });
}

// ── Age helper ───────────────────────────────────────────────────────────────
export function ageFromBirthday(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// ── Look up an org id by display name (from the remembered org) ──────────────
async function orgIdByName(orgName: string): Promise<string | null> {
  // Two parameterized .eq() lookups — avoids unescaped values in a PostgREST .or() string.
  const byName = await supabase
    .from('organizations').select('id').eq('name', orgName).limit(1).maybeSingle<{ id: string }>();
  if (byName.data?.id) return byName.data.id;
  const byCode = await supabase
    .from('organizations').select('id').eq('access_code', orgName).limit(1).maybeSingle<{ id: string }>();
  return byCode.data?.id ?? null;
}

export type VolunteerIntake = {
  fullName: string;
  preferredName?: string | null;
  email: string;
  phone: string;
  birthday: string | null;        // ISO yyyy-mm-dd
  school?: string | null;
  gradeOrOccupation?: string | null;
  subjects: string[];
  languages: string[];
  availableDays: string[];
  availableTimes: string[];
  tutoringExperience?: string | null;
  transportation?: string | null;
  tshirtSize?: string | null;
  emergencyName: string;
  emergencyPhone: string;
  // guardian (minors)
  isMinor: boolean;
  guardianName?: string | null;
  guardianPhone?: string | null;
  guardianEmail?: string | null;
  orgId?: string | null;          // resolved org id (preferred; from the join code)
  orgName: string;                // display name, used only as a fallback lookup
  role: 'member' | 'student';
  consents: Record<string, boolean>;
};

/** Write the full volunteer profile into public.users + record consents. */
export async function completeVolunteerIntake(intake: VolunteerIntake) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: { message: 'Not authenticated.' } };

  // Prefer the org id resolved from the join code; fall back to a name lookup.
  const organization_id = intake.orgId || (await orgIdByName(intake.orgName));
  if (!organization_id) {
    return { error: { message: `Could not find your organization. Check your org code and try again.` } };
  }
  const signerRole = intake.isMinor ? 'guardian' : 'self';
  const signerIdentity = intake.isMinor ? (intake.guardianName || 'guardian') : intake.fullName;

  const { error } = await supabase.from('users').upsert({
    id: user.id,
    email: intake.email.trim().toLowerCase(),
    full_name: intake.fullName.trim(),
    preferred_name: intake.preferredName?.trim() || null,
    role: intake.role === 'student' ? 'student' : 'member',
    organization_id,
    phone: intake.phone.trim() || null,
    birthday: intake.birthday,
    school: intake.school?.trim() || null,
    grade_or_occupation: intake.gradeOrOccupation?.trim() || null,
    subjects: intake.subjects,
    languages: intake.languages,
    available_days: intake.availableDays,
    available_times: intake.availableTimes,
    tutoring_experience: intake.tutoringExperience?.trim() || null,
    transportation: intake.transportation || null,
    tshirt_size: intake.tshirtSize || null,
    emergency_contact_name: intake.emergencyName.trim() || null,
    emergency_contact_phone: intake.emergencyPhone.trim() || null,
    is_minor: intake.isMinor,
    guardian_name: intake.guardianName?.trim() || null,
    guardian_phone: intake.guardianPhone?.trim() || null,
    guardian_email: intake.guardianEmail?.trim() || null,
    intake_completed: true,
  });
  if (error) return { error };

  // Record each consent discretely
  const rows = VOLUNTEER_CONSENTS.map((doc) => ({
    user_id: user.id,
    document_name: doc.name,
    doc_version: 'v1',
    granted: !!intake.consents[doc.key],
    signer_identity: signerIdentity,
    signer_role: signerRole,
    method: 'in_app_checkbox',
  }));
  const { error: consentErr } = await supabase.from('user_consents').insert(rows);
  if (consentErr) return { error: consentErr };

  return { error: null };
}
