-- ============================================================================
-- Alloy — Migration 0005: let leadership & directors broadcast announcements
-- (the original policy only allowed 'admin'). Run after 0001. Safe to re-run.
-- ============================================================================

DROP POLICY IF EXISTS "Allow only admins to insert announcements" ON public.announcements;
DROP POLICY IF EXISTS announcements_insert_elevated ON public.announcements;
CREATE POLICY announcements_insert_elevated ON public.announcements
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin','president','vp','director')
    )
  );

DROP POLICY IF EXISTS "Allow only admins to update announcements" ON public.announcements;
DROP POLICY IF EXISTS announcements_update_elevated ON public.announcements;
CREATE POLICY announcements_update_elevated ON public.announcements
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role IN ('admin','president','vp','director')
    )
  );
