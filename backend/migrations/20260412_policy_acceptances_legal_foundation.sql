create table if not exists public.policy_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  policy_type text not null
    check (policy_type in ('terms', 'privacy', 'billing', 'risk')),
  policy_version text not null,
  accepted_at timestamptz not null default timezone('utc', now()),
  ip_address text,
  user_agent text,
  context text,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists policy_acceptances_user_policy_idx
  on public.policy_acceptances (user_id, policy_type, accepted_at desc);

create index if not exists policy_acceptances_policy_version_idx
  on public.policy_acceptances (policy_type, policy_version);

create or replace function public.capture_policy_acceptances_from_auth_user(
  target_user_id uuid,
  metadata jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if metadata is null or jsonb_typeof(metadata -> 'accepted_policies') <> 'array' then
    return;
  end if;

  insert into public.policy_acceptances (
    user_id,
    policy_type,
    policy_version,
    context,
    user_agent
  )
  select
    target_user_id,
    lower(trim(item ->> 'policy_type')),
    trim(item ->> 'policy_version'),
    nullif(trim(item ->> 'context'), ''),
    nullif(trim(item ->> 'user_agent'), '')
  from jsonb_array_elements(metadata -> 'accepted_policies') as item
  where lower(trim(coalesce(item ->> 'policy_type', ''))) in ('terms', 'privacy', 'billing', 'risk')
    and nullif(trim(item ->> 'policy_version'), '') is not null;
end;
$$;

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

  perform public.capture_policy_acceptances_from_auth_user(new.id, new.raw_user_meta_data);

  return new;
end;
$$;

alter table public.policy_acceptances enable row level security;

drop policy if exists "policy_acceptances_select_own" on public.policy_acceptances;
create policy "policy_acceptances_select_own"
on public.policy_acceptances
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "policy_acceptances_insert_own" on public.policy_acceptances;
create policy "policy_acceptances_insert_own"
on public.policy_acceptances
for insert
to authenticated
with check (auth.uid() = user_id);
