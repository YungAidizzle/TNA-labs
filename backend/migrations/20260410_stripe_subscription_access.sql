create extension if not exists pgcrypto;
create extension if not exists citext;

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email citext,
  full_name text,
  avatar_url text,
  stripe_customer_id text,
  access_state text not null default 'pending_setup'
    check (access_state in ('pending_setup', 'trialing', 'active', 'inactive', 'past_due', 'canceled')),
  onboarding_state text not null default 'account_created'
    check (onboarding_state in ('account_created', 'email_verification_pending', 'access_pending', 'billing_ready', 'complete')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles
  add column if not exists email citext,
  add column if not exists full_name text,
  add column if not exists avatar_url text,
  add column if not exists stripe_customer_id text,
  add column if not exists access_state text not null default 'pending_setup',
  add column if not exists onboarding_state text not null default 'account_created',
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_access_state_check'
  ) then
    alter table public.profiles
      add constraint profiles_access_state_check
      check (access_state in ('pending_setup', 'trialing', 'active', 'inactive', 'past_due', 'canceled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_onboarding_state_check'
  ) then
    alter table public.profiles
      add constraint profiles_onboarding_state_check
      check (onboarding_state in ('account_created', 'email_verification_pending', 'access_pending', 'billing_ready', 'complete'));
  end if;
end
$$;

create unique index if not exists profiles_email_key
  on public.profiles (email)
  where email is not null;

create unique index if not exists profiles_stripe_customer_id_key
  on public.profiles (stripe_customer_id)
  where stripe_customer_id is not null;

create index if not exists profiles_access_state_idx
  on public.profiles (access_state);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row
execute function public.set_current_timestamp_updated_at();

create or replace function public.handle_auth_user_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    access_state,
    onboarding_state
  )
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), ''),
    'pending_setup',
    case
      when new.email_confirmed_at is null then 'email_verification_pending'
      else 'account_created'
    end
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
    updated_at = timezone('utc', now());

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_auth_user_created();

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null unique,
  stripe_price_id text,
  status text not null default 'inactive'
    check (status in ('inactive', 'trialing', 'active', 'past_due', 'canceled')),
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.subscriptions
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text,
  add column if not exists status text not null default 'inactive',
  add column if not exists current_period_end timestamptz,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists created_at timestamptz not null default timezone('utc', now()),
  add column if not exists updated_at timestamptz not null default timezone('utc', now());

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_status_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_status_check
      check (status in ('inactive', 'trialing', 'active', 'past_due', 'canceled'));
  end if;
end
$$;

create unique index if not exists subscriptions_stripe_subscription_id_key
  on public.subscriptions (stripe_subscription_id);

create index if not exists subscriptions_user_id_idx
  on public.subscriptions (user_id);

create index if not exists subscriptions_status_idx
  on public.subscriptions (status);

create index if not exists subscriptions_stripe_customer_id_idx
  on public.subscriptions (stripe_customer_id);

drop trigger if exists set_subscriptions_updated_at on public.subscriptions;
create trigger set_subscriptions_updated_at
before update on public.subscriptions
for each row
execute function public.set_current_timestamp_updated_at();

alter table public.profiles enable row level security;
alter table public.subscriptions enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "subscriptions_select_own" on public.subscriptions;
create policy "subscriptions_select_own"
on public.subscriptions
for select
to authenticated
using (auth.uid() = user_id);
