-- ============================================================================
-- Alloy — Migration 0029: resources storage bucket + badge award plumbing
--
-- Two concerns, both required by the resources screen and the badge logic:
--   1. A public Storage bucket ('resources') for lesson materials, plus RLS on
--      storage.objects so authenticated members can upload and anyone can read.
--   2. Badge awarding: the 0025 user_badges table has a SELECT policy only, so
--      neither self-service auto-awards nor leadership hand-awards can write.
--      We add (a) a self-insert policy so checkAndAwardBadges() can award the
--      calling user their own earned badges, and (b) a SECURITY DEFINER
--      function so leadership can award a manual badge to another org member.
-- Run after 0001–0025. Safe to re-run.
-- ============================================================================

-- ── 1. Resources storage bucket ─────────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('resources', 'resources', true)
on conflict (id) do nothing;

-- Any authenticated user may upload into the resources bucket. (The resources
-- METADATA row insert is separately gated to non-students by the resources
-- table RLS from migration 0025, so students can't actually publish a resource.)
drop policy if exists "resources_bucket_upload" on storage.objects;
create policy "resources_bucket_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'resources');

-- Public read (bucket is public; matching object policy keeps signed reads working too).
drop policy if exists "resources_bucket_read" on storage.objects;
create policy "resources_bucket_read" on storage.objects
  for select to public
  using (bucket_id = 'resources');

-- Uploader may replace/remove their own object.
drop policy if exists "resources_bucket_modify_own" on storage.objects;
create policy "resources_bucket_modify_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'resources' and owner = auth.uid())
  with check (bucket_id = 'resources' and owner = auth.uid());

drop policy if exists "resources_bucket_delete_own" on storage.objects;
create policy "resources_bucket_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'resources' and owner = auth.uid());

-- ── 2a. user_badges: let a user insert their OWN earned badges ───────────────
-- checkAndAwardBadges() runs client-side and inserts the caller's newly-earned
-- badges. 0025 only defined a SELECT policy; without an INSERT policy every
-- auto-award would be silently denied by RLS.
drop policy if exists user_badges_insert_self on public.user_badges;
create policy user_badges_insert_self on public.user_badges
  for insert to authenticated
  with check (user_id = auth.uid());

-- ── 2b. Leadership hands a manual badge to ANOTHER org member ────────────────
-- Non-owners can't (and shouldn't) insert into someone else's user_badges via
-- RLS, so this SECURITY DEFINER function is the one sanctioned path. It enforces
-- that the caller is leadership and the target is in the caller's org.
create or replace function public.award_manual_badge(p_user_id uuid, p_badge_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_leadership() then
    raise exception 'only leadership may award badges';
  end if;

  if not exists (
    select 1 from public.users u
    where u.id = p_user_id and u.organization_id = public.current_org_id()
  ) then
    raise exception 'target user is not in your organization';
  end if;

  insert into public.user_badges (user_id, badge_key)
  values (p_user_id, p_badge_key)
  on conflict (user_id, badge_key) do nothing;
end $$;

grant execute on function public.award_manual_badge(uuid, text) to authenticated;
