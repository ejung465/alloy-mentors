-- ============================================================================
-- Alloy — Migration 0009: Rich volunteer + student intake, consents
-- Run after 0001–0008. Safe to re-run.
--
-- NOTE on sensitive fields: several student columns below (country_of_origin,
-- medical_notes, etc.) are sensitive. True column-level security needs a view
-- split; for now they live on `students` (RLS already restricts to authed
-- users). Gating these to admins-only is a documented follow-up.
-- ============================================================================

-- 1) Volunteer (users) intake columns ----------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS preferred_name        text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS languages             text[];     -- languages spoken
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS subjects              text[];     -- tutoring subjects offered
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS available_days        text[];     -- Mon..Sun
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS available_times       text[];     -- Morning/Afternoon/Evening
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tutoring_experience   text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS grade_or_occupation   text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS transportation        text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS tshirt_size           text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS background_check_status text NOT NULL DEFAULT 'not_started'; -- admin-managed
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS youth_protection_trained boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS is_minor              boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guardian_name         text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guardian_phone        text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS guardian_email        text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS intake_completed      boolean NOT NULL DEFAULT false;
-- (phone, birthday, emergency_contact_name, emergency_contact_phone already exist)

-- 2) Student intake columns --------------------------------------------------
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS subjects_help        text[];
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS english_level        text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS interpreter_needed   boolean NOT NULL DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS transportation       text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS allergies            text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS medical_notes        text;        -- sensitive
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS dietary              text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS emergency_contact_name  text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS emergency_contact_phone text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS guardian_relationship text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS guardian_language    text;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS photo_media_consent  boolean NOT NULL DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS med_treatment_consent boolean NOT NULL DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS guardian_consent_signed boolean NOT NULL DEFAULT false;
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS country_of_origin    text;        -- sensitive, optional
ALTER TABLE public.students ADD COLUMN IF NOT EXISTS languages_all        text[];

-- 3) Consents table — one row per granted/declined document ------------------
--    Stored discretely (not one bundled "agree all") with version + signer.
CREATE TABLE IF NOT EXISTS public.user_consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  document_name  text NOT NULL,
  doc_version    text NOT NULL DEFAULT 'v1',
  granted        boolean NOT NULL,
  signer_identity text,                 -- who affirmed (self, or guardian name)
  signer_role    text,                  -- 'self' | 'guardian'
  method         text NOT NULL DEFAULT 'in_app_checkbox',
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_user_consents_user ON public.user_consents (user_id);

ALTER TABLE public.user_consents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consents_select_self ON public.user_consents;
CREATE POLICY consents_select_self ON public.user_consents
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_leadership());

DROP POLICY IF EXISTS consents_insert_self ON public.user_consents;
CREATE POLICY consents_insert_self ON public.user_consents
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
