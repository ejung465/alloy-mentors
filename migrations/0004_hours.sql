-- ============================================================================
-- Alloy — Migration 0004: Hours auto-credit + override + policies
-- Run as ONE block (after 0001–0003). Safe to re-run.
-- ============================================================================

-- 1) Track the source of an hours entry --------------------------------------
ALTER TABLE public.hours_logs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
ALTER TABLE public.hours_logs ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.sessions(id) ON DELETE SET NULL;

-- 2) Auto-credit a volunteer's hours when they're checked in -----------------
CREATE OR REPLACE FUNCTION public.credit_volunteer_hours()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE s record; dur numeric;
BEGIN
  IF NEW.kind = 'volunteer' AND NEW.volunteer_id IS NOT NULL THEN
    SELECT * INTO s FROM public.sessions WHERE id = NEW.session_id;
    IF FOUND THEN
      dur := round(EXTRACT(EPOCH FROM (s.end_time - s.start_time)) / 3600.0, 2);
      IF NOT EXISTS (
        SELECT 1 FROM public.hours_logs
        WHERE session_id = s.id AND mentor_id = NEW.volunteer_id AND source = 'auto'
      ) THEN
        INSERT INTO public.hours_logs
          (mentor_id, organization_id, hours, date_worked, description, status, source, session_id, approved_by)
        VALUES
          (NEW.volunteer_id, s.organization_id, GREATEST(dur, 0), s.start_time::date,
           'Auto: ' || s.title, 'approved', 'auto', s.id, NEW.checked_in_by);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_credit_hours ON public.session_attendance;
CREATE TRIGGER trg_credit_hours AFTER INSERT ON public.session_attendance
  FOR EACH ROW EXECUTE FUNCTION public.credit_volunteer_hours();

-- Remove the auto entry if a volunteer check-in is undone
CREATE OR REPLACE FUNCTION public.remove_volunteer_hours()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.kind = 'volunteer' AND OLD.volunteer_id IS NOT NULL THEN
    DELETE FROM public.hours_logs
    WHERE session_id = OLD.session_id AND mentor_id = OLD.volunteer_id AND source = 'auto';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS trg_remove_hours ON public.session_attendance;
CREATE TRIGGER trg_remove_hours AFTER DELETE ON public.session_attendance
  FOR EACH ROW EXECUTE FUNCTION public.remove_volunteer_hours();

-- 3) hours_logs RLS: own rows visible; leadership sees & edits all ----------
DROP POLICY IF EXISTS hours_select ON public.hours_logs;
CREATE POLICY hours_select ON public.hours_logs
  FOR SELECT TO authenticated USING (mentor_id = auth.uid() OR public.is_leadership());

DROP POLICY IF EXISTS hours_insert ON public.hours_logs;
CREATE POLICY hours_insert ON public.hours_logs
  FOR INSERT TO authenticated WITH CHECK (mentor_id = auth.uid() OR public.is_leadership());

DROP POLICY IF EXISTS hours_update ON public.hours_logs;
CREATE POLICY hours_update ON public.hours_logs
  FOR UPDATE TO authenticated USING (public.is_leadership());

DROP POLICY IF EXISTS hours_delete ON public.hours_logs;
CREATE POLICY hours_delete ON public.hours_logs
  FOR DELETE TO authenticated USING (public.is_leadership());
