-- ============================================================================
-- Alloy — Migration 0024: make the notification toggle actually do something
-- Profile → Notifications was writing to AsyncStorage only; neither push
-- function (send-push, send-rsvp-reminders) ever checked it, so muting
-- notifications in the app had zero server-side effect. Run after 0023.
-- ============================================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS notifications_enabled boolean NOT NULL DEFAULT true;
