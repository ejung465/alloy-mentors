-- ============================================================================
-- Alloy — Migration 0031: push_tokens table
--
-- lib/notifications.ts's registerForPushNotificationsAsync() has fetched a
-- real Expo push token since 1.3.2, but nothing persisted it — this table is
-- where it lands. A user can have multiple tokens (multiple devices), so it's
-- keyed by (user_id, token), not a single column on public.users. Any backend
-- job that actually sends pushes (e.g. a future send-push edge function) runs
-- as service role and bypasses RLS entirely. Run after 0001–0030. Safe to re-run.
-- ============================================================================

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  token text not null,
  platform text not null default 'unknown',
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);

alter table public.push_tokens enable row level security;

-- A user may register/refresh their own token(s).
drop policy if exists push_tokens_upsert_self on public.push_tokens;
create policy push_tokens_upsert_self on public.push_tokens
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists push_tokens_update_self on public.push_tokens;
create policy push_tokens_update_self on public.push_tokens
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A user may read/remove their own token rows (e.g. on notification toggle-off).
drop policy if exists push_tokens_select_self on public.push_tokens;
create policy push_tokens_select_self on public.push_tokens
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists push_tokens_delete_self on public.push_tokens;
create policy push_tokens_delete_self on public.push_tokens
  for delete to authenticated
  using (user_id = auth.uid());
