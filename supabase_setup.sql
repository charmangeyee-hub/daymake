-- Daymark — Supabase setup
-- Run this once in your Supabase project:
--   Dashboard → SQL Editor → New query → paste → Run
--
-- Creates one row of JSON data per user, protected by Row-Level Security
-- so each account can only read and write its own row.

create table if not exists public.user_data (
  user_id    uuid primary key references auth.users on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

-- Drop old policies if re-running, then recreate.
drop policy if exists "user_data_select_own" on public.user_data;
drop policy if exists "user_data_insert_own" on public.user_data;
drop policy if exists "user_data_update_own" on public.user_data;

create policy "user_data_select_own" on public.user_data
  for select using (auth.uid() = user_id);

create policy "user_data_insert_own" on public.user_data
  for insert with check (auth.uid() = user_id);

create policy "user_data_update_own" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- keep updated_at fresh on every write
create or replace function public.touch_user_data()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_touch_user_data on public.user_data;
create trigger trg_touch_user_data
  before update on public.user_data
  for each row execute function public.touch_user_data();
