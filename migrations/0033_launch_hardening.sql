-- ============================================================================
-- Alloy — Migration 0033: pre-launch hardening
--
-- Five independent fixes found during the final pre-launch audit. Each is
-- idempotent and safe to re-run. Run after 0001-0032.
--
--   1. group_chats SELECT policy — fixes group creation, which is currently
--      broken for EVERY user (see below).
--   2. blocks UPDATE policy — fixes re-blocking an already-blocked user.
--   3. message_reactions REPLICA IDENTITY — makes reaction REMOVALS sync.
--   4. Realtime publication membership for announcements + messages.
--   5. Indexes on the columns every hot query filters by.
-- ============================================================================

-- ── 1. Group chat creation is structurally blocked ──────────────────────────
-- app/(tabs)/chat.tsx's createGroup() does:
--     .from('group_chats').insert({...}).select().single()
-- The .select() makes PostgREST send Prefer: return=representation, i.e.
-- INSERT ... RETURNING. Postgres applies the SELECT policy to RETURNING rows.
-- The 0007 policy only grants SELECT to existing members of the group — but at
-- INSERT time the creator is not a member yet (members are inserted on the NEXT
-- statement). So the RETURNING check fails, the insert aborts, and the member
-- insert never runs. Net effect: "New Group" fails 100% of the time.
--
-- Fix: let the creator see their own group. This is also just correct on its
-- own terms — the person who made the group should be able to read it.
drop policy if exists group_chats_select on public.group_chats;
create policy group_chats_select on public.group_chats
  for select to authenticated
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.group_chat_members
      where group_chat_id = id and user_id = auth.uid()
    )
  );

-- ── 2. Re-blocking an already-blocked user fails ────────────────────────────
-- chat.tsx upserts into `blocks` with onConflict but without ignoreDuplicates,
-- so PostgREST emits INSERT ... ON CONFLICT DO UPDATE, which needs an UPDATE
-- policy. `blocks` has INSERT/DELETE/SELECT policies but no UPDATE one, so the
-- user gets a raw error alert instead of a silent no-op.
drop policy if exists blocks_update_self on public.blocks;
create policy blocks_update_self on public.blocks
  for update to authenticated
  using (blocker_id = auth.uid())
  with check (blocker_id = auth.uid());

-- ── 3. Reaction removals never reach other devices ──────────────────────────
-- The realtime handler reads payload.old.message_id on DELETE. With the default
-- REPLICA IDENTITY, payload.old carries ONLY the primary key, so message_id is
-- undefined and the handler bails — a removed tapback stays visible on everyone
-- else's screen until they reload.
alter table public.message_reactions replica identity full;

-- ── 4. Realtime publication membership ──────────────────────────────────────
-- Announcements are fetched once on mount but never arrive live, because the
-- table was never added to the realtime publication. Same risk for `messages`
-- if chat_schema.sql was applied outside the numbered migration set.
-- Both adds are guarded so this migration is safe to re-run.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'announcements'
  ) then
    alter publication supabase_realtime add table public.announcements;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ── 5. Indexes for the hot paths ────────────────────────────────────────────
-- Every home/profile/analytics/admin load currently sequential-scans these
-- multi-tenant tables (including other orgs' rows, which RLS then discards).
-- On the Nano-tier instance this is the dominant cost and it degrades
-- superlinearly as paying orgs are added. Indexes change no results.
create index if not exists idx_users_organization_id
  on public.users (organization_id);

create index if not exists idx_sessions_org_start
  on public.sessions (organization_id, start_time desc);

create index if not exists idx_session_attendance_volunteer
  on public.session_attendance (volunteer_id);

create index if not exists idx_session_attendance_paired_volunteer
  on public.session_attendance (paired_volunteer_id);

create index if not exists idx_session_rsvps_user
  on public.session_rsvps (user_id);

create index if not exists idx_hours_logs_mentor
  on public.hours_logs (mentor_id);

create index if not exists idx_hours_logs_org_status
  on public.hours_logs (organization_id, status);

create index if not exists idx_students_organization_id
  on public.students (organization_id);

create index if not exists idx_messages_group_chat
  on public.messages (group_chat_id, created_at desc);

create index if not exists idx_messages_org_created
  on public.messages (organization_id, created_at desc);

create index if not exists idx_message_reactions_message
  on public.message_reactions (message_id);

create index if not exists idx_announcements_org_created
  on public.announcements (organization_id, created_at desc);

create index if not exists idx_resources_organization_id
  on public.resources (organization_id);

create index if not exists idx_audit_log_org_created
  on public.audit_log (organization_id, created_at desc);

create index if not exists idx_student_goals_student
  on public.student_goals (student_id);

create index if not exists idx_student_skills_student
  on public.student_skills (student_id);

create index if not exists idx_push_tokens_user
  on public.push_tokens (user_id);
