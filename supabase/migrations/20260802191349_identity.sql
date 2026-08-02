create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  birth_year integer not null,
  age_confirmed_at timestamptz not null,
  terms_version text not null,
  privacy_version text not null,
  responsible_use_version text not null,
  consented_at timestamptz not null,
  onboarding_state text not null default 'NOT_STARTED',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_length_check check (
    display_name is null or char_length(display_name) between 1 and 100
  ),
  constraint profiles_adult_check check (
    birth_year between 1900 and extract(year from age_confirmed_at)::integer - 18
  ),
  constraint profiles_terms_version_check check (char_length(terms_version) between 1 and 100),
  constraint profiles_privacy_version_check check (char_length(privacy_version) between 1 and 100),
  constraint profiles_responsible_use_version_check check (
    char_length(responsible_use_version) between 1 and 100
  ),
  constraint profiles_onboarding_state_check check (
    onboarding_state in ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETE')
  ),
  constraint profiles_timestamps_check check (
    consented_at >= age_confirmed_at and updated_at >= created_at
  )
);

create table private.beta_invitations (
  id uuid primary key default gen_random_uuid(),
  normalized_email_hmac text not null,
  status text not null default 'PENDING',
  expires_at timestamptz not null,
  accepted_user_id uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_invitations_email_hmac_check check (
    normalized_email_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint beta_invitations_status_check check (
    status in ('PENDING', 'ACCEPTED', 'REVOKED')
  ),
  constraint beta_invitations_acceptance_check check (
    (status = 'PENDING' and accepted_user_id is null)
    or (status = 'ACCEPTED' and accepted_user_id is not null)
    or status = 'REVOKED'
  ),
  constraint beta_invitations_expiry_check check (expires_at > created_at),
  constraint beta_invitations_timestamps_check check (updated_at >= created_at)
);

create unique index beta_invitations_active_email_hmac_idx
on private.beta_invitations (normalized_email_hmac)
where status in ('PENDING', 'ACCEPTED');

create unique index beta_invitations_accepted_user_id_idx
on private.beta_invitations (accepted_user_id)
where accepted_user_id is not null;

create index beta_invitations_pending_expires_at_idx
on private.beta_invitations (expires_at)
where status = 'PENDING';

create table private.beta_cohort_state (
  singleton boolean primary key default true,
  accepted_count smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beta_cohort_state_singleton_check check (singleton),
  constraint beta_cohort_state_accepted_count_check check (
    accepted_count between 0 and 25
  ),
  constraint beta_cohort_state_timestamps_check check (updated_at >= created_at)
);

insert into private.beta_cohort_state (singleton, accepted_count)
values (true, 0);

create table private.account_deletions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  user_id_hmac text not null,
  status text not null default 'QUEUED',
  deletion_status_token_hmac text not null unique,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null,
  safe_failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_deletions_user_id_id_key unique (user_id, id),
  constraint account_deletions_user_id_hmac_check check (
    user_id_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint account_deletions_status_token_hmac_check check (
    deletion_status_token_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint account_deletions_status_check check (
    status in ('QUEUED', 'PROCESSING', 'COMPLETE', 'FAILED')
  ),
  constraint account_deletions_completion_check check (
    (status in ('QUEUED', 'PROCESSING') and completed_at is null)
    or (status in ('COMPLETE', 'FAILED') and completed_at is not null)
  ),
  constraint account_deletions_raw_user_check check (
    status <> 'COMPLETE' or user_id is null
  ),
  constraint account_deletions_expiry_check check (
    (completed_at is null and expires_at > requested_at)
    or (completed_at is not null and expires_at = completed_at + interval '30 days')
  ),
  constraint account_deletions_failure_code_check check (
    (status = 'FAILED' and safe_failure_code is not null)
    or (status <> 'FAILED' and safe_failure_code is null)
  ),
  constraint account_deletions_timestamps_check check (updated_at >= created_at)
);

create index account_deletions_work_queue_idx
on private.account_deletions (requested_at, id)
where status in ('QUEUED', 'PROCESSING');

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create function private.enforce_beta_invitation_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  was_accepted boolean;
  is_accepted boolean;
begin
  if tg_op = 'INSERT' then
    was_accepted := false;
    is_accepted := new.status = 'ACCEPTED';
  elsif tg_op = 'DELETE' then
    was_accepted := old.status = 'ACCEPTED';
    is_accepted := false;
  else
    was_accepted := old.status = 'ACCEPTED';
    is_accepted := new.status = 'ACCEPTED';
  end if;

  if is_accepted and not was_accepted then
    update private.beta_cohort_state
    set accepted_count = accepted_count + 1
    where singleton and accepted_count < 25;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'accepted invitation cap of 25 reached';
    end if;
  elsif was_accepted and not is_accepted then
    update private.beta_cohort_state
    set accepted_count = accepted_count - 1
    where singleton and accepted_count > 0;

    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'accepted invitation counter is inconsistent';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger beta_invitations_set_updated_at
before update on private.beta_invitations
for each row execute function private.set_updated_at();

create trigger beta_invitations_enforce_cap
before insert or update of status or delete on private.beta_invitations
for each row execute function private.enforce_beta_invitation_cap();

create trigger beta_cohort_state_set_updated_at
before update on private.beta_cohort_state
for each row execute function private.set_updated_at();

create trigger account_deletions_set_updated_at
before update on private.account_deletions
for each row execute function private.set_updated_at();

alter table public.profiles enable row level security;
alter table private.beta_invitations enable row level security;
alter table private.beta_cohort_state enable row level security;
alter table private.account_deletions enable row level security;

create policy profiles_select_own
on public.profiles
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
grant update (display_name, onboarding_state) on table public.profiles to authenticated;

revoke all on table private.beta_invitations from public, anon, authenticated;
revoke all on table private.beta_cohort_state from public, anon, authenticated;
revoke all on table private.account_deletions from public, anon, authenticated;
grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table private.beta_invitations to service_role;
grant select, update on table private.beta_cohort_state to service_role;
grant select, insert, update, delete on table private.account_deletions to service_role;

revoke execute on function private.set_updated_at() from public, anon, authenticated;
revoke execute on function private.enforce_beta_invitation_cap() from public, anon, authenticated;
