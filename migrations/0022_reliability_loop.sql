-- ============================================================================
-- Alloy — Migration 0022: reliability loop (RSVP reminders)
-- Solves the "<half show up" problem: a push nudge ~90-150 min before a
-- session to anyone who hasn't RSVP'd. Schedules the send-rsvp-reminders
-- edge function (deploy it first — see supabase/functions/) every 15 min via
-- pg_cron + pg_net, both of which ship on Supabase and just need enabling.
-- Run after 0001–0021.
-- ============================================================================

ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Re-running this migration must not create duplicate cron jobs.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'alloy-rsvp-reminders';

SELECT cron.schedule(
  'alloy-rsvp-reminders',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://gcveyqsnllfvnuxurnaq.supabase.co/functions/v1/send-rsvp-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
