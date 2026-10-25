-- Property Maintenance: cloud sync table.
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
--
-- One row per user holds that user's whole app data as JSON.
-- "version" lets the app detect when two devices edited at the same time.

create table if not exists public.app_data (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    data       jsonb       not null,
    version    bigint      not null default 1,
    updated_at timestamptz not null default now()
);

-- Row Level Security: each signed-in user can only touch their own row.
alter table public.app_data enable row level security;

drop policy if exists "app_data select own" on public.app_data;
drop policy if exists "app_data insert own" on public.app_data;
drop policy if exists "app_data update own" on public.app_data;

create policy "app_data select own" on public.app_data
    for select to authenticated
    using (auth.uid() = user_id);

create policy "app_data insert own" on public.app_data
    for insert to authenticated
    with check (auth.uid() = user_id);

create policy "app_data update own" on public.app_data
    for update to authenticated
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

-- No delete policy on purpose: the app never deletes the cloud row.
