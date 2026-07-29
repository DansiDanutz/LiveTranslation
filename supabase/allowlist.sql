-- LiveTranslation — owner-managed access allowlist
-- The owner (semebitcoin@gmail.com) can add/remove which emails are allowed to
-- spend (translate / summarize / ask) directly from the app. Run once in the
-- Supabase SQL editor (or `supabase db push`).

create table if not exists public.app_allowlist (
  email text primary key,
  added_by text,
  created_at timestamptz not null default now()
);

alter table public.app_allowlist enable row level security;

-- Owner management goes through /api/allowlist, which authenticates the
-- configured OWNER_EMAIL server-side and uses the service-role key. No browser
-- policy can safely depend on a Vercel environment variable.
drop policy if exists "allowlist readable" on public.app_allowlist;
drop policy if exists "allowlist owner read" on public.app_allowlist;
drop policy if exists "allowlist owner insert" on public.app_allowlist;
drop policy if exists "allowlist owner delete" on public.app_allowlist;

-- Registry of accounts that signed in, so the owner can approve them from
-- inside the app (Menu → Access → "Signed in — waiting for approval").
create table if not exists public.app_signins (
  email text primary key,
  name text,
  last_seen timestamptz not null default now()
);

alter table public.app_signins enable row level security;

-- Any signed-in user may record/refresh THEIR OWN sign-in row.
drop policy if exists "signins self insert" on public.app_signins;
create policy "signins self insert"
  on public.app_signins for insert
  with check (lower(auth.jwt() ->> 'email') = email);

drop policy if exists "signins self update" on public.app_signins;
create policy "signins self update"
  on public.app_signins for update
  using (lower(auth.jwt() ->> 'email') = email)
  with check (lower(auth.jwt() ->> 'email') = email);

-- Only the server-side owner endpoint may read the registry.
drop policy if exists "signins owner read" on public.app_signins;
