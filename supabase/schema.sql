-- LiveTranslation — Supabase schema
-- Run this in the Supabase SQL editor (Dashboard → SQL → New query).
-- Stores per-user translation session transcripts. Auth is handled by
-- Supabase Auth (Google provider); this table links rows to auth.users.

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_text text,
  target_text text,
  target_language text,
  duration_seconds integer default 0,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_id_created_at_idx
  on public.sessions (user_id, created_at desc);

-- Row-level security: users can only see and manage their own sessions.
alter table public.sessions enable row level security;

drop policy if exists "sessions are readable by owner" on public.sessions;
create policy "sessions are readable by owner"
  on public.sessions for select
  using (auth.uid() = user_id);

drop policy if exists "sessions are insertable by owner" on public.sessions;
create policy "sessions are insertable by owner"
  on public.sessions for insert
  with check (auth.uid() = user_id);

drop policy if exists "sessions are deletable by owner" on public.sessions;
create policy "sessions are deletable by owner"
  on public.sessions for delete
  using (auth.uid() = user_id);

-- Note: the server persists sessions using the service-role key, which
-- bypasses RLS. The policies above protect direct client access.
