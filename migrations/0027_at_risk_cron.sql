-- ============================================================================
-- Alloy — Migration 0027: at-risk alerts (student re-engagement)
-- Adds the dedup column the at-risk-alerts edge function relies on, and
-- schedules that function (deploy it first — see supabase/functions/) once
-- daily via pg_cron + pg_net (already enabled by migration 0022). Unlike the
-- RSVP reminder loop this doesn't need to be near-real-time, so it runs once
-- a day rather than every 15 min.
-- Run after 0001–0026.
-- ============================================================================

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS last_at_risk_alert_at timestamptz;

-- Re-running this migration must not create duplicate cron jobs.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'alloy-at-risk-alerts';

SELECT cron.schedule(
  'alloy-at-risk-alerts',
  '0 14 * * *',
  $$
  SELECT net.http_post(
    url := 'https://gcveyqsnllfvnuxurnaq.supabase.co/functions/v1/at-risk-alerts',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
