-- ============================================================================
-- Alloy — Migration 0032: user location field
--
-- The RV-14 notes asked for location to be collected at sign-up alongside
-- school/contact info — it wasn't. Adds a simple free-text column (city/area,
-- not a structured address) to public.users. Run after 0001-0031. Safe to re-run.
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS location text;
