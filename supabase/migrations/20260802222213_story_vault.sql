create table public.story_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source_session_id uuid not null,
  version integer not null,
  revision integer not null default 1,
  status text not null default 'REVIEW_REQUIRED',
  voice_profile jsonb not null,
  excluded_topics jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint story_profiles_user_id_id_key unique (user_id, id),
  constraint story_profiles_owner_id_session_key unique (user_id, id, source_session_id),
  constraint story_profiles_user_version_key unique (user_id, version),
  constraint story_profiles_source_session_key unique (user_id, source_session_id),
  constraint story_profiles_session_owner_fkey foreign key (user_id, source_session_id)
    references public.interview_sessions (user_id, id) on delete cascade,
  constraint story_profiles_version_check check (version >= 1),
  constraint story_profiles_revision_check check (revision >= 1),
  constraint story_profiles_status_check check (
    status in ('REVIEW_REQUIRED', 'ACTIVE')
  ),
  constraint story_profiles_voice_check check (
    jsonb_typeof(voice_profile) = 'object'
  ),
  constraint story_profiles_excluded_check check (
    jsonb_typeof(excluded_topics) = 'array'
    and jsonb_array_length(excluded_topics) <= 20
  ),
  constraint story_profiles_timestamps_check check (updated_at >= created_at)
);

create table public.story_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_id uuid not null,
  category text not null,
  summary text not null,
  details jsonb not null,
  revision integer not null default 1,
  content_hmac text not null,
  verification_status text not null default 'UNVERIFIED',
  verified_at timestamptz,
  suppressed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint story_facts_user_id_id_key unique (user_id, id),
  constraint story_facts_owner_profile_id_key unique (user_id, profile_id, id),
  constraint story_facts_profile_owner_fkey foreign key (user_id, profile_id)
    references public.story_profiles (user_id, id) on delete cascade,
  constraint story_facts_category_check check (
    category in (
      'ACADEMICS',
      'ACTIVITIES',
      'RESPONSIBILITIES',
      'EXPERIENCES',
      'VALUES',
      'GOALS',
      'VOICE'
    )
  ),
  constraint story_facts_summary_check check (char_length(summary) between 1 and 500),
  constraint story_facts_details_check check (
    jsonb_typeof(details) = 'array' and jsonb_array_length(details) between 1 and 10
  ),
  constraint story_facts_revision_check check (revision >= 1),
  constraint story_facts_content_hmac_check check (
    content_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint story_facts_verification_check check (
    verification_status in ('UNVERIFIED', 'VERIFIED', 'REJECTED')
  ),
  constraint story_facts_verified_at_check check (
    (verification_status = 'VERIFIED' and verified_at is not null)
    or (verification_status <> 'VERIFIED' and verified_at is null)
  ),
  constraint story_facts_timestamps_check check (updated_at >= created_at)
);

alter table public.interview_messages
add constraint interview_messages_owner_session_id_key
unique (user_id, session_id, id);

create table public.story_fact_sources (
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_id uuid not null,
  fact_id uuid not null,
  session_id uuid not null,
  message_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (fact_id, message_id),
  constraint story_fact_sources_fact_owner_fkey foreign key (user_id, profile_id, fact_id)
    references public.story_facts (user_id, profile_id, id) on delete cascade,
  constraint story_fact_sources_profile_session_fkey foreign key (user_id, profile_id, session_id)
    references public.story_profiles (user_id, id, source_session_id) on delete cascade,
  constraint story_fact_sources_message_owner_fkey foreign key (user_id, session_id, message_id)
    references public.interview_messages (user_id, session_id, id) on delete cascade
);

create index story_facts_owner_profile_idx
on public.story_facts (user_id, profile_id, created_at, id);

create index story_fact_sources_owner_profile_idx
on public.story_fact_sources (user_id, profile_id, fact_id);

create trigger story_profiles_set_updated_at
before update on public.story_profiles
for each row execute function private.set_updated_at();

create trigger story_facts_set_updated_at
before update on public.story_facts
for each row execute function private.set_updated_at();

alter table public.story_profiles enable row level security;
alter table public.story_facts enable row level security;
alter table public.story_fact_sources enable row level security;

create policy story_profiles_select_own
on public.story_profiles for select to authenticated
using ((select auth.uid()) = user_id);

create policy story_facts_select_own
on public.story_facts for select to authenticated
using ((select auth.uid()) = user_id);

create policy story_fact_sources_select_own
on public.story_fact_sources for select to authenticated
using ((select auth.uid()) = user_id);

revoke all on table public.story_profiles from anon, authenticated;
revoke all on table public.story_facts from anon, authenticated;
revoke all on table public.story_fact_sources from anon, authenticated;
grant select on table public.story_profiles to authenticated;
grant select on table public.story_facts to authenticated;
grant select on table public.story_fact_sources to authenticated;
grant select, insert, update, delete on table public.story_profiles to service_role;
grant select, insert, update, delete on table public.story_facts to service_role;
grant select, insert, update, delete on table public.story_fact_sources to service_role;

create function private.create_story_profile(
  requested_user_id uuid,
  requested_session_id uuid,
  requested_extraction jsonb,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_session public.interview_sessions%rowtype;
  existing_profile public.story_profiles%rowtype;
  fact_count integer;
  fact_id uuid;
  fact_value jsonb;
  next_version integer;
  profile_row public.story_profiles%rowtype;
  source_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('storybridge:story-profile:' || requested_user_id::text, 0)
  );

  select * into existing_profile
  from public.story_profiles
  where user_id = requested_user_id and source_session_id = requested_session_id;

  if found then
    return jsonb_build_object(
      'decision', 'REPLAY',
      'profile', to_jsonb(existing_profile)
    );
  end if;

  select * into current_session
  from public.interview_sessions
  where user_id = requested_user_id and id = requested_session_id
  for update;

  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND', 'profile', null);
  end if;
  if current_session.status <> 'COMPLETE' then
    return jsonb_build_object('decision', 'INCOMPLETE', 'profile', null);
  end if;
  if not (
    (current_session.coverage ->> 'academicInterests')::boolean
    and (current_session.coverage ->> 'experiences')::integer >= 2
    and (current_session.coverage ->> 'values')::boolean
    and (current_session.coverage ->> 'goals')::boolean
    and (current_session.coverage ->> 'voice')::boolean
  ) then
    return jsonb_build_object('decision', 'INSUFFICIENT_COVERAGE', 'profile', null);
  end if;

  if jsonb_typeof(requested_extraction) <> 'object'
    or requested_extraction - array['voiceProfile', 'facts']::text[] <> '{}'::jsonb
    or jsonb_typeof(requested_extraction -> 'voiceProfile') <> 'object'
    or jsonb_typeof(requested_extraction -> 'facts') <> 'array' then
    raise exception using errcode = '22023', message = 'invalid story extraction';
  end if;

  fact_count := jsonb_array_length(requested_extraction -> 'facts');
  if fact_count not between 1 and 30 then
    raise exception using errcode = '22023', message = 'invalid story fact count';
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.story_profiles
  where user_id = requested_user_id;

  insert into public.story_profiles (
    user_id, source_session_id, version, voice_profile, created_at, updated_at
  ) values (
    requested_user_id,
    requested_session_id,
    next_version,
    requested_extraction -> 'voiceProfile',
    requested_at,
    requested_at
  ) returning * into profile_row;

  for fact_value in
    select value from jsonb_array_elements(requested_extraction -> 'facts')
  loop
    if jsonb_typeof(fact_value) <> 'object'
      or fact_value - array[
        'category', 'summary', 'details', 'contentHmac', 'sourceMessageIds'
      ]::text[] <> '{}'::jsonb
      or fact_value ->> 'category' not in (
        'ACADEMICS', 'ACTIVITIES', 'RESPONSIBILITIES', 'EXPERIENCES',
        'VALUES', 'GOALS', 'VOICE'
      )
      or char_length(fact_value ->> 'summary') not between 1 and 500
      or jsonb_typeof(fact_value -> 'details') <> 'array'
      or jsonb_array_length(fact_value -> 'details') not between 1 and 10
      or exists (
        select 1 from jsonb_array_elements(fact_value -> 'details') detail
        where jsonb_typeof(detail) <> 'string'
          or char_length(detail #>> '{}') not between 1 and 500
      )
      or coalesce(fact_value ->> 'contentHmac', '')
        !~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
      or jsonb_typeof(fact_value -> 'sourceMessageIds') <> 'array'
      or jsonb_array_length(fact_value -> 'sourceMessageIds') not between 1 and 18 then
      raise exception using errcode = '22023', message = 'invalid story fact';
    end if;

    select count(distinct messages.id) into source_count
    from jsonb_array_elements_text(fact_value -> 'sourceMessageIds') source_id
    join public.interview_messages messages
      on messages.id = source_id::uuid
      and messages.user_id = requested_user_id
      and messages.session_id = requested_session_id
      and messages.role = 'USER';

    if source_count <> jsonb_array_length(fact_value -> 'sourceMessageIds') then
      raise exception using errcode = '22023', message = 'invalid story fact source';
    end if;

    insert into public.story_facts (
      user_id, profile_id, category, summary, details, content_hmac,
      created_at, updated_at
    ) values (
      requested_user_id,
      profile_row.id,
      fact_value ->> 'category',
      fact_value ->> 'summary',
      fact_value -> 'details',
      fact_value ->> 'contentHmac',
      requested_at,
      requested_at
    ) returning id into fact_id;

    insert into public.story_fact_sources (
      user_id, profile_id, fact_id, session_id, message_id, created_at
    )
    select
      requested_user_id,
      profile_row.id,
      fact_id,
      requested_session_id,
      source_id::uuid,
      requested_at
    from jsonb_array_elements_text(fact_value -> 'sourceMessageIds') source_id;
  end loop;

  return jsonb_build_object(
    'decision', 'CREATED',
    'profile', to_jsonb(profile_row)
  );
end;
$$;

revoke execute on function private.create_story_profile(uuid, uuid, jsonb, timestamptz)
from public, anon, authenticated;
grant execute on function private.create_story_profile(uuid, uuid, jsonb, timestamptz)
to service_role;
