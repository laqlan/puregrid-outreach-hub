-- PureGrid Outreach Hub Supabase sync schema
-- Run this in Supabase → SQL Editor → New query → Run.

create extension if not exists pgcrypto;

create table if not exists public.crm_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table public.crm_states enable row level security;

drop policy if exists "Users can view their own CRM state" on public.crm_states;
create policy "Users can view their own CRM state"
  on public.crm_states for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert their own CRM state" on public.crm_states;
create policy "Users can insert their own CRM state"
  on public.crm_states for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update their own CRM state" on public.crm_states;
create policy "Users can update their own CRM state"
  on public.crm_states for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_crm_states_updated_at on public.crm_states;
create trigger set_crm_states_updated_at
before update on public.crm_states
for each row execute function public.set_updated_at();
