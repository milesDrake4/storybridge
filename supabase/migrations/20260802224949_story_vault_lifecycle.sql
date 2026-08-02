create function private.update_story_profile(
  requested_user_id uuid,
  requested_profile_id uuid,
  requested_expected_revision integer,
  requested_voice_profile jsonb,
  requested_excluded_topics jsonb,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_profile public.story_profiles%rowtype;
begin
  select * into current_profile
  from public.story_profiles
  where user_id = requested_user_id and id = requested_profile_id
  for update;

  if not found then return jsonb_build_object('decision', 'NOT_FOUND', 'profile', null); end if;
  if current_profile.revision <> requested_expected_revision then
    return jsonb_build_object('decision', 'REVISION_MISMATCH', 'profile', null);
  end if;
  if requested_voice_profile is null and requested_excluded_topics is null then
    raise exception using errcode = '22023', message = 'empty story profile update';
  end if;
  if requested_voice_profile is not null
    and jsonb_typeof(requested_voice_profile) <> 'object' then
    raise exception using errcode = '22023', message = 'invalid voice profile';
  end if;
  if requested_excluded_topics is not null and (
    jsonb_typeof(requested_excluded_topics) <> 'array'
    or jsonb_array_length(requested_excluded_topics) > 20
    or exists (
      select 1 from jsonb_array_elements(requested_excluded_topics) topic
      where jsonb_typeof(topic) <> 'string'
        or char_length(topic #>> '{}') not between 1 and 200
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid excluded topics';
  end if;

  update public.story_profiles
  set
    voice_profile = coalesce(requested_voice_profile, voice_profile),
    excluded_topics = coalesce(requested_excluded_topics, excluded_topics),
    revision = revision + 1,
    updated_at = requested_at
  where id = current_profile.id
  returning * into current_profile;

  return jsonb_build_object('decision', 'UPDATED', 'profile', to_jsonb(current_profile));
end;
$$;

create function private.update_story_fact(
  requested_user_id uuid,
  requested_fact_id uuid,
  requested_expected_revision integer,
  requested_summary text,
  requested_details jsonb,
  requested_content_hmac text,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_fact public.story_facts%rowtype;
begin
  select * into current_fact
  from public.story_facts
  where user_id = requested_user_id and id = requested_fact_id
  for update;

  if not found then return jsonb_build_object('decision', 'NOT_FOUND', 'fact', null); end if;
  if current_fact.revision <> requested_expected_revision then
    return jsonb_build_object('decision', 'REVISION_MISMATCH', 'fact', null);
  end if;
  if char_length(requested_summary) not between 1 and 500
    or jsonb_typeof(requested_details) <> 'array'
    or jsonb_array_length(requested_details) not between 1 and 10
    or exists (
      select 1 from jsonb_array_elements(requested_details) detail
      where jsonb_typeof(detail) <> 'string'
        or char_length(detail #>> '{}') not between 1 and 500
    )
    or requested_content_hmac !~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$' then
    raise exception using errcode = '22023', message = 'invalid story fact update';
  end if;

  update public.story_facts
  set
    summary = requested_summary,
    details = requested_details,
    content_hmac = requested_content_hmac,
    revision = revision + 1,
    verification_status = 'UNVERIFIED',
    verified_at = null,
    updated_at = requested_at
  where id = current_fact.id
  returning * into current_fact;

  return jsonb_build_object('decision', 'UPDATED', 'fact', to_jsonb(current_fact));
end;
$$;

create function private.set_story_fact_verification(
  requested_user_id uuid,
  requested_fact_id uuid,
  requested_expected_revision integer,
  requested_content_hmac text,
  requested_decision text,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_fact public.story_facts%rowtype;
begin
  select * into current_fact
  from public.story_facts
  where user_id = requested_user_id and id = requested_fact_id
  for update;

  if not found then return jsonb_build_object('decision', 'NOT_FOUND', 'fact', null); end if;
  if current_fact.revision <> requested_expected_revision
    or current_fact.content_hmac <> requested_content_hmac then
    return jsonb_build_object('decision', 'REVISION_MISMATCH', 'fact', null);
  end if;
  if requested_decision not in ('VERIFY', 'REJECT') then
    raise exception using errcode = '22023', message = 'invalid verification decision';
  end if;

  update public.story_facts
  set
    verification_status = case requested_decision when 'VERIFY' then 'VERIFIED' else 'REJECTED' end,
    verified_at = case requested_decision when 'VERIFY' then requested_at else null end,
    revision = revision + 1,
    updated_at = requested_at
  where id = current_fact.id
  returning * into current_fact;

  return jsonb_build_object('decision', 'UPDATED', 'fact', to_jsonb(current_fact));
end;
$$;

create function private.set_story_fact_suppression(
  requested_user_id uuid,
  requested_fact_id uuid,
  requested_suppressed boolean,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_fact public.story_facts%rowtype;
  next_suppressed_at timestamptz;
begin
  select * into current_fact
  from public.story_facts
  where user_id = requested_user_id and id = requested_fact_id
  for update;

  if not found then return jsonb_build_object('decision', 'NOT_FOUND', 'fact', null); end if;
  next_suppressed_at := case when requested_suppressed then requested_at else null end;
  if (requested_suppressed and current_fact.suppressed_at is not null)
    or (not requested_suppressed and current_fact.suppressed_at is null) then
    return jsonb_build_object('decision', 'REPLAY', 'fact', to_jsonb(current_fact));
  end if;

  update public.story_facts
  set
    suppressed_at = next_suppressed_at,
    revision = revision + 1,
    updated_at = requested_at
  where id = current_fact.id
  returning * into current_fact;

  return jsonb_build_object('decision', 'UPDATED', 'fact', to_jsonb(current_fact));
end;
$$;

create function private.delete_story_fact(
  requested_user_id uuid,
  requested_fact_id uuid
)
returns boolean
language sql
set search_path = ''
as $$
  with deleted as (
    delete from public.story_facts
    where user_id = requested_user_id and id = requested_fact_id
    returning 1
  )
  select exists(select 1 from deleted);
$$;

create function private.get_story_facts_for_ai(requested_user_id uuid)
returns setof public.story_facts
language sql
stable
set search_path = ''
as $$
  select facts.*
  from public.story_facts facts
  join public.story_profiles profiles
    on profiles.user_id = facts.user_id and profiles.id = facts.profile_id
  where facts.user_id = requested_user_id
    and facts.suppressed_at is null
    and facts.verification_status = 'VERIFIED'
    and profiles.status = 'ACTIVE';
$$;

revoke execute on function private.update_story_profile(uuid, uuid, integer, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function private.update_story_fact(uuid, uuid, integer, text, jsonb, text, timestamptz) from public, anon, authenticated;
revoke execute on function private.set_story_fact_verification(uuid, uuid, integer, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function private.set_story_fact_suppression(uuid, uuid, boolean, timestamptz) from public, anon, authenticated;
revoke execute on function private.delete_story_fact(uuid, uuid) from public, anon, authenticated;
revoke execute on function private.get_story_facts_for_ai(uuid) from public, anon, authenticated;

grant execute on function private.update_story_profile(uuid, uuid, integer, jsonb, jsonb, timestamptz) to service_role;
grant execute on function private.update_story_fact(uuid, uuid, integer, text, jsonb, text, timestamptz) to service_role;
grant execute on function private.set_story_fact_verification(uuid, uuid, integer, text, text, timestamptz) to service_role;
grant execute on function private.set_story_fact_suppression(uuid, uuid, boolean, timestamptz) to service_role;
grant execute on function private.delete_story_fact(uuid, uuid) to service_role;
grant execute on function private.get_story_facts_for_ai(uuid) to service_role;
