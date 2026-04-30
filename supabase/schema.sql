-- PureGrid Outreach Hub schema for Supabase
-- Run this in Supabase SQL Editor after creating your project.

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  niche text,
  service_offer text,
  demo_link text,
  tone text,
  email_template text,
  whatsapp_template text,
  daily_limit integer default 50,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  business_name text,
  email text,
  all_emails text,
  phone text,
  whatsapp text,
  website text,
  domain text,
  city text,
  country text,
  facebook text,
  instagram text,
  linkedin text,
  contact_form text,
  human_angle text,
  notes text,
  status text default 'New',
  last_contacted date,
  replies integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.outreach_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  type text,
  message text,
  provider text,
  provider_message_id text,
  created_at timestamptz default now()
);

create table if not exists public.suppressions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  email text,
  reason text,
  created_at timestamptz default now(),
  unique(user_id, email)
);

alter table public.campaigns enable row level security;
alter table public.leads enable row level security;
alter table public.outreach_logs enable row level security;
alter table public.suppressions enable row level security;

do $$ begin
  create policy "campaigns owner" on public.campaigns for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "leads owner" on public.leads for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "logs owner" on public.outreach_logs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "suppressions owner" on public.suppressions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
