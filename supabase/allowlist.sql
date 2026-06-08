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

-- Anyone may READ the list (it's just a set of permitted emails; the server
-- needs to read it to enforce access).
drop policy if exists "allowlist readable" on public.app_allowlist;
create policy "allowlist readable"
  on public.app_allowlist for select using (true);

-- Only the OWNER may modify the list.
drop policy if exists "allowlist owner insert" on public.app_allowlist;
create policy "allowlist owner insert"
  on public.app_allowlist for insert
  with check ((auth.jwt() ->> 'email') = 'semebitcoin@gmail.com');

drop policy if exists "allowlist owner delete" on public.app_allowlist;
create policy "allowlist owner delete"
  on public.app_allowlist for delete
  using ((auth.jwt() ->> 'email') = 'semebitcoin@gmail.com');
