-- ============================================================================
-- Alloy — Migration 0030: support_requests table
--
-- Backs the in-app Contact Support form (app/contact-support.tsx). Any
-- authenticated user can file a request tied to their own user_id; only
-- leadership (reusing public.is_leadership() from migration 0001/0006) or
-- the service role can read the queue. Run after 0001–0029. Safe to re-run.
-- ============================================================================

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  name text not null,
  email text not null,
  phone text,
  message text not null,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

alter table public.support_requests enable row level security;

-- Any authenticated user may file their own support request.
drop policy if exists support_requests_insert_self on public.support_requests;
create policy support_requests_insert_self on public.support_requests
  for insert to authenticated
  with check (user_id = auth.uid());

-- Users may read back their own requests; leadership may read the full queue.
drop policy if exists support_requests_select on public.support_requests;
create policy support_requests_select on public.support_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_leadership());

-- Leadership may update status (e.g. triage to 'resolved'). Service role
-- bypasses RLS entirely for any backend/admin tooling.
drop policy if exists support_requests_update_leadership on public.support_requests;
create policy support_requests_update_leadership on public.support_requests
  for update to authenticated
  using (public.is_leadership())
  with check (public.is_leadership());
