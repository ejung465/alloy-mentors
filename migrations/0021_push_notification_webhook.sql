-- ============================================================================
-- Alloy — Migration 0021: wire the message push notification webhook
-- The send-push edge function (deployed) was written but never triggered —
-- this creates the DB trigger Supabase's own "Database Webhooks" UI would
-- generate, so it's declarative/repeatable instead of a manual dashboard
-- click. supabase_functions.http_request ships on every Supabase project;
-- no extension needed. Run after 0001–0020.
-- ============================================================================

DROP TRIGGER IF EXISTS on_message_insert_push ON public.messages;

CREATE TRIGGER on_message_insert_push
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION supabase_functions.http_request(
    'https://gcveyqsnllfvnuxurnaq.supabase.co/functions/v1/send-push',
    'POST',
    '{"Content-type":"application/json"}',
    '{}',
    '5000'
  );
