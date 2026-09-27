-- ============================================================================
-- Alloy — Migration 0035: turn the original test org into a neutral demo org
-- OPTIONAL. The first tenant was a real organization used for testing; this
-- detaches the production data from it so nothing in the live app (org name,
-- join codes, seeded session text) points back to that organization.
--
--   • Renames the org to "Alloy Demo" and gives it DEMO codes.
--   • Rewrites the seeded session titles/descriptions/locations to generic text.
--   • Leaves members, students (seeded, fictional), hours, and chat intact,
--     so your test accounts keep working and it doubles as the App Review
--     demo org.
--
-- AFTER RUNNING: join codes become DEMO-M (members) / DEMO-S (students).
-- Anyone already signed in stays signed in (the app remembers the org by id),
-- but update any App Review notes or docs that mention the old codes.
-- Safe to re-run (matches either the old or the new access code).
-- ============================================================================

do $$
declare
  v_org uuid;
begin
  select id into v_org from public.organizations
   where access_code in ('ITB', 'DEMO') order by created_at limit 1;
  if v_org is null then
    raise notice 'No test org found — nothing to do.';
    return;
  end if;

  update public.organizations
     set name         = 'Alloy Demo',
         access_code  = 'DEMO',
         member_code  = 'DEMO-M',
         student_code = 'DEMO-S'
   where id = v_org;

  update public.sessions
     set title       = case when title ilike '%riverside%' or title ilike 'saturday%'
                            then 'Saturday Tutoring' else title end,
         description = case when description ilike '%refugee%'
                            then 'Weekly tutoring session. Volunteers check in by QR; students check in by name.'
                            else description end,
         location    = case when location ilike '%riverside%'
                            then 'Community Center, Main Hall' else location end
   where organization_id = v_org;

  update public.announcements
     set title   = regexp_replace(title,   '\mITB\M', 'Alloy Demo', 'g'),
         message = regexp_replace(message, '\mITB\M', 'Alloy Demo', 'g')
   where organization_id = v_org and (title ~ '\mITB\M' or message ~ '\mITB\M');
end $$;
