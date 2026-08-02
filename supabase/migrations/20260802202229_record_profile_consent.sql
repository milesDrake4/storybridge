create function private.record_profile_consent(
  requested_user_id uuid,
  requested_birth_year integer,
  requested_terms_version text,
  requested_privacy_version text,
  requested_responsible_use_version text,
  requested_at timestamptz default now()
)
returns setof public.profiles
language plpgsql
set search_path = ''
as $$
begin
  perform 1
  from private.beta_invitations
  where accepted_user_id = requested_user_id
    and status = 'ACCEPTED'
  for update;

  if not found then
    return;
  end if;

  return query
  insert into public.profiles (
    user_id,
    birth_year,
    age_confirmed_at,
    terms_version,
    privacy_version,
    responsible_use_version,
    consented_at
  )
  values (
    requested_user_id,
    requested_birth_year,
    requested_at,
    requested_terms_version,
    requested_privacy_version,
    requested_responsible_use_version,
    requested_at
  )
  on conflict (user_id)
  do update set
    birth_year = excluded.birth_year,
    age_confirmed_at = excluded.age_confirmed_at,
    terms_version = excluded.terms_version,
    privacy_version = excluded.privacy_version,
    responsible_use_version = excluded.responsible_use_version,
    consented_at = excluded.consented_at
  returning *;
end;
$$;

revoke execute on function private.record_profile_consent(
  uuid,
  integer,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function private.record_profile_consent(
  uuid,
  integer,
  text,
  text,
  text,
  timestamptz
) to service_role;
