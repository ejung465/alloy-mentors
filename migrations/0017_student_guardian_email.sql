-- ============================================================================
-- Alloy Tutors — Migration 0017: guardian email on students
-- Lets coordinators send guardian progress digests by email (and, once SMTP is
-- configured, automate them). The digest itself already works via the device
-- share sheet; this just captures the address. Run after 0016. Safe to re-run.
-- ============================================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS guardian_email text;
