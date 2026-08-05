-- Daymark — serverless push reminders setup
-- Run in Supabase → SQL Editor AFTER you've deployed the send-reminders Edge Function.

-- 1) Table: one push subscription + reminder schedule per user, row-level secured.
create table if not exists public.push_subscriptions (
  user_id      uuid primary key references auth.users on delete cascade,
  subscription jsonb not null,
  reminders    jsonb not null default '[]'::jsonb,
  timezone     text not null default 'UTC',
  last_sent    jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_select_own" on public.push_subscriptions;
drop policy if exists "push_insert_own" on public.push_subscriptions;
drop policy if exists "push_update_own" on public.push_subscriptions;

create policy "push_select_own" on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy "push_insert_own" on public.push_subscriptions
  for insert with check (auth.uid() = user_id);
create policy "push_update_own" on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2) Extensions needed to call the Edge Function on a schedule.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3) Every minute, ping the Edge Function. It decides what (if anything) to send.
--    The CRON_SECRET below MUST match the CRON_SECRET secret you set on the function.
do $$ begin
  perform cron.unschedule('daymark-reminders');
exception when others then null;   -- ignore if it wasn't scheduled yet
end $$;

select cron.schedule(
  'daymark-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://ohruurnsxzmzsqyvqskt.supabase.co/functions/v1/send-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer PASTE_YOUR_CRON_SECRET_HERE'
    ),
    body := '{}'::jsonb
  );
  $$
);
