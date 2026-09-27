-- ============================================================================
-- Alloy — Migration 0034: scale + cleanup (from the live-database audit)
-- Run AFTER 0029 and 0033 (neither had been run at audit time). Safe to re-run.
--
--   1. Duplicate push trigger. messages has TWO triggers that both POST to
--      send-push (on_message_insert from 0007, on_message_insert_push from
--      0021), so every DM / group message notifies the recipient twice.
--   2. RLS performance. All 81 public policies call auth.uid() /
--      current_org_id() / current_user_role() / is_leadership() bare, which
--      Postgres re-evaluates for EVERY row scanned. Wrapping each call in
--      (SELECT ...) makes it an initplan evaluated once per query. Same
--      results, much cheaper at scale (Supabase advisor: auth_rls_initplan).
--      Done dynamically from pg_policies so it also covers the policies 0033
--      creates, whatever order things ran in.
--   3. search_path pinned on the 6 functions the advisor flagged.
--   4. is_group_member(group, user) was executable by anonymous callers
--      (lets anyone probe chat membership). RLS only needs it for signed-in
--      users.
--   5. Storage size / type limits so one oversized upload can't eat the free
--      tier's 1 GB. The app now resizes photos to ≤1600px before upload.
-- ============================================================================

-- ── 1. Drop the duplicate push trigger (keep the 0021 one) ──────────────────
do $$
begin
  if exists (select 1 from pg_trigger where tgname = 'on_message_insert_push'
             and tgrelid = 'public.messages'::regclass) then
    drop trigger if exists on_message_insert on public.messages;
  end if;
end $$;

-- ── 2. Wrap per-row auth calls in policies as once-per-query initplans ──────
do $$
declare
  r record;
  pat constant text := '(?<![A-Za-z_.])((?:public\.)?(?:auth\.uid|current_org_id|current_user_role|is_leadership))\(\)';
  q text;
  w text;
  stmt text;
begin
  for r in
    select tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
  loop
    -- Already rewritten (re-run) — Postgres deparses (SELECT f()) as "( SELECT f() AS f)".
    if coalesce(r.qual, '') || coalesce(r.with_check, '')
         ~ 'SELECT (auth\.uid|current_org_id|current_user_role|is_leadership)\(\)' then
      continue;
    end if;
    q := regexp_replace(r.qual,       pat, '(SELECT \1())', 'g');
    w := regexp_replace(r.with_check, pat, '(SELECT \1())', 'g');
    if q is not distinct from r.qual and w is not distinct from r.with_check then
      continue;
    end if;
    stmt := format('alter policy %I on public.%I', r.policyname, r.tablename);
    if q is not null then stmt := stmt || ' using (' || q || ')'; end if;
    if w is not null then stmt := stmt || ' with check (' || w || ')'; end if;
    execute stmt;
  end loop;
end $$;

-- ── 3. Pin search_path on the flagged functions ─────────────────────────────
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('credit_volunteer_hours', 'remove_volunteer_hours', 'set_attendance_org',
                         'get_best_mentor', 'get_best_volunteer', 'get_best_volunteer_v2')
       and p.proconfig is null
  loop
    execute format('alter function %s set search_path = public', f.sig);
  end loop;
end $$;

-- ── 4. is_group_member: signed-in users only ────────────────────────────────
revoke execute on function public.is_group_member(uuid, uuid) from public, anon;
grant  execute on function public.is_group_member(uuid, uuid) to authenticated;

-- ── 5. Storage limits ───────────────────────────────────────────────────────
update storage.buckets
   set file_size_limit = 10 * 1024 * 1024,
       allowed_mime_types = array['image/jpeg','image/png','image/heic','image/heif','image/webp','image/gif']
 where id in ('chat-images', 'student-photos');

update storage.buckets
   set file_size_limit = 25 * 1024 * 1024
 where id = 'resources';
