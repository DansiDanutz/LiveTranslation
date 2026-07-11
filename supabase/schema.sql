-- LiveTranslation — Supabase schema
-- Stores per-user translation session transcripts + summaries so history and
-- summaries can sync across devices. The browser writes/reads these directly
-- using the signed-in user's JWT; Row-Level Security keeps each user to their
-- own rows. Run this in the Supabase SQL editor (or `supabase db push`).

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text,                 -- local entry id, for cross-device de-duplication
  source_text text,
  target_text text,
  summary text,
  romanian_text text,          -- per-session Romanian transcript (auto-generated)
  target_language text,
  duration_seconds integer default 0,
  created_at timestamptz not null default now()
);

-- One row per (user, client_id) so re-syncing the same session upserts.
create unique index if not exists sessions_user_client_idx
  on public.sessions (user_id, client_id);

create index if not exists sessions_user_created_idx
  on public.sessions (user_id, created_at desc);

alter table public.sessions enable row level security;

drop policy if exists "sessions readable by owner" on public.sessions;
create policy "sessions readable by owner"
  on public.sessions for select using (auth.uid() = user_id);

drop policy if exists "sessions insertable by owner" on public.sessions;
create policy "sessions insertable by owner"
  on public.sessions for insert with check (auth.uid() = user_id);

drop policy if exists "sessions updatable by owner" on public.sessions;
create policy "sessions updatable by owner"
  on public.sessions for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "sessions deletable by owner" on public.sessions;
create policy "sessions deletable by owner"
  on public.sessions for delete using (auth.uid() = user_id);
