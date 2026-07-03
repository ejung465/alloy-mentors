-- ============================================================================
-- Alloy — Migration 0013: Scope announcements to an organization
-- Without this, every org's broadcast shows to every user (multi-org leak).
-- Run after 0001–0012. Safe to re-run.
-- ============================================================================

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_announcements_org ON public.announcements (organization_id);

-- Backfill existing rows to the launch org (ITB) so they keep showing.
UPDATE public.announcements
SET organization_id = (SELECT id FROM public.organizations WHERE access_code = 'ITB' LIMIT 1)
WHERE organization_id IS NULL;
