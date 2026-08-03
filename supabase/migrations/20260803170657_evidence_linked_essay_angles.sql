alter table public.essays
add column selected_angle_id uuid,
add column angle_generation_count smallint not null default 0,
add constraint essays_angle_generation_count_check check (
  angle_generation_count between 0 and 2
);

create or replace function private.invalidate_essay_research_dependents(
  requested_user_id uuid,
  requested_essay_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.essays
  set outline = null,
      selected_angle_id = null,
      angle_generation_count = 0
  where user_id = requested_user_id and id = requested_essay_id;

  if pg_catalog.to_regclass('private.ai_proposals') is not null then
    execute 'update private.ai_proposals set status = ''EXPIRED'' where user_id = $1 and essay_id = $2 and status = ''PENDING'''
    using requested_user_id, requested_essay_id;
  end if;

  if pg_catalog.to_regclass('public.essay_angles') is not null then
    execute 'delete from public.essay_angles where user_id = $1 and essay_id = $2'
    using requested_user_id, requested_essay_id;
  end if;
end;
$$;

alter table public.school_dossier_sources
add constraint school_dossier_sources_owner_dossier_id_key
unique (user_id, dossier_id, id);

create table public.essay_angles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  dossier_id uuid not null,
  operation_id uuid not null references private.ai_operations (id) on delete restrict,
  position smallint not null,
  title text not null,
  thesis text not null,
  prompt_fit text not null,
  risk text not null,
  selected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint essay_angles_owner_essay_fk foreign key (user_id, essay_id)
    references public.essays (user_id, id) on delete cascade,
  constraint essay_angles_owner_dossier_fk foreign key (user_id, dossier_id)
    references public.school_dossiers (user_id, id) on delete cascade,
  constraint essay_angles_user_essay_id_key unique (user_id, essay_id, id),
  constraint essay_angles_user_essay_dossier_id_key unique (user_id, essay_id, dossier_id, id),
  constraint essay_angles_operation_position_key unique (operation_id, position),
  constraint essay_angles_essay_position_key unique (essay_id, position),
  constraint essay_angles_position_check check (position between 1 and 3),
  constraint essay_angles_title_check check (char_length(title) between 1 and 160),
  constraint essay_angles_thesis_check check (char_length(thesis) between 1 and 800),
  constraint essay_angles_prompt_fit_check check (char_length(prompt_fit) between 1 and 600),
  constraint essay_angles_risk_check check (char_length(risk) between 1 and 400),
  constraint essay_angles_timestamps_check check (updated_at >= created_at)
);

create unique index essay_angles_distinct_title_idx
on public.essay_angles (essay_id, lower(title));
create index essay_angles_owner_essay_idx
on public.essay_angles (user_id, essay_id, position);

create table public.angle_story_facts (
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  angle_id uuid not null,
  story_fact_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (angle_id, story_fact_id),
  constraint angle_story_facts_angle_owner_fk foreign key (user_id, essay_id, angle_id)
    references public.essay_angles (user_id, essay_id, id) on delete cascade,
  constraint angle_story_facts_fact_owner_fk foreign key (user_id, story_fact_id)
    references public.story_facts (user_id, id) on delete cascade
);

create table public.angle_school_sources (
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  dossier_id uuid not null,
  angle_id uuid not null,
  school_source_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (angle_id, school_source_id),
  constraint angle_school_sources_angle_owner_fk foreign key (
    user_id, essay_id, dossier_id, angle_id
  ) references public.essay_angles (user_id, essay_id, dossier_id, id) on delete cascade,
  constraint angle_school_sources_source_owner_fk foreign key (
    user_id, dossier_id, school_source_id
  ) references public.school_dossier_sources (user_id, dossier_id, id) on delete cascade
);

alter table public.essays
add constraint essays_selected_angle_owner_fk foreign key (
  user_id, id, selected_angle_id
) references public.essay_angles (user_id, essay_id, id) on delete set null (selected_angle_id);

create trigger essay_angles_set_updated_at
before update on public.essay_angles
for each row execute function private.set_updated_at();

create function private.validate_angle_story_fact()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.story_facts facts
    where facts.user_id = new.user_id
      and facts.id = new.story_fact_id
      and facts.verification_status = 'VERIFIED'
      and facts.suppressed_at is null
  ) then
    raise exception using errcode = '23514', message = 'angle fact is not active verified evidence';
  end if;
  return new;
end;
$$;

create function private.validate_angle_school_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.essays essays
    where essays.user_id = new.user_id
      and essays.id = new.essay_id
      and essays.dossier_id = new.dossier_id
  ) then
    raise exception using errcode = '23514', message = 'angle source is not from the active dossier';
  end if;
  return new;
end;
$$;

create trigger angle_story_facts_validate
before insert or update on public.angle_story_facts
for each row execute function private.validate_angle_story_fact();
create trigger angle_school_sources_validate
before insert or update on public.angle_school_sources
for each row execute function private.validate_angle_school_source();

alter table public.essay_angles enable row level security;
alter table public.angle_story_facts enable row level security;
alter table public.angle_school_sources enable row level security;

create policy essay_angles_select_own on public.essay_angles
for select to authenticated using ((select auth.uid()) = user_id);
create policy angle_story_facts_select_own on public.angle_story_facts
for select to authenticated using ((select auth.uid()) = user_id);
create policy angle_school_sources_select_own on public.angle_school_sources
for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.essay_angles from anon, authenticated;
revoke all on table public.angle_story_facts from anon, authenticated;
revoke all on table public.angle_school_sources from anon, authenticated;
grant select on table public.essay_angles to authenticated;
grant select on table public.angle_story_facts to authenticated;
grant select on table public.angle_school_sources to authenticated;
grant select, insert, update, delete on table public.essay_angles to service_role;
grant select, insert, update, delete on table public.angle_story_facts to service_role;
grant select, insert, update, delete on table public.angle_school_sources to service_role;

create function private.get_essay_angles(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_operation_id uuid default null
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', angles.id,
    'user_id', angles.user_id,
    'essay_id', angles.essay_id,
    'dossier_id', angles.dossier_id,
    'position', angles.position,
    'title', angles.title,
    'thesis', angles.thesis,
    'prompt_fit', angles.prompt_fit,
    'risk', angles.risk,
    'selected_at', angles.selected_at,
    'created_at', angles.created_at,
    'updated_at', angles.updated_at,
    'story_fact_ids', coalesce((
      select jsonb_agg(links.story_fact_id order by links.story_fact_id)
      from public.angle_story_facts links
      where links.user_id = angles.user_id and links.angle_id = angles.id
    ), '[]'::jsonb),
    'school_source_ids', coalesce((
      select jsonb_agg(links.school_source_id order by links.school_source_id)
      from public.angle_school_sources links
      where links.user_id = angles.user_id and links.angle_id = angles.id
    ), '[]'::jsonb)
  ) order by angles.position), '[]'::jsonb)
  from public.essay_angles angles
  where angles.user_id = requested_user_id
    and angles.essay_id = requested_essay_id
    and (requested_operation_id is null or angles.operation_id = requested_operation_id);
$$;

create function private.commit_essay_angles(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_dossier_id uuid,
  requested_operation_id uuid,
  requested_regenerate boolean,
  requested_angles jsonb,
  requested_provider_request_id text,
  requested_model_id text,
  requested_input_tokens integer,
  requested_output_tokens integer,
  requested_latency_ms integer,
  requested_final_cost_cents integer,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  angle jsonb;
  angle_id uuid;
  current_essay public.essays%rowtype;
  current_operation private.ai_operations%rowtype;
  evidence_id text;
  position integer := 0;
begin
  if exists (
    select 1 from public.essay_angles where operation_id = requested_operation_id
  ) then
    return jsonb_build_object(
      'decision', 'REPLAY',
      'angles', private.get_essay_angles(
        requested_user_id, requested_essay_id, requested_operation_id
      )
    );
  end if;

  if jsonb_typeof(requested_angles) is distinct from 'array'
    or jsonb_array_length(requested_angles) <> 3
  then
    raise exception using errcode = '22023', message = 'exactly three angles are required';
  end if;

  select * into current_essay
  from public.essays
  where user_id = requested_user_id and id = requested_essay_id
  for update;
  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND', 'angles', null);
  end if;
  if current_essay.dossier_id is distinct from requested_dossier_id then
    return jsonb_build_object('decision', 'DOSSIER_CHANGED', 'angles', null);
  end if;
  if current_essay.selected_angle_id is not null then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'angles', null);
  end if;
  if requested_regenerate then
    if current_essay.angle_generation_count >= 2 then
      return jsonb_build_object('decision', 'REGENERATION_USED', 'angles', null);
    end if;
    if current_essay.angle_generation_count <> 1 then
      return jsonb_build_object('decision', 'STATE_CONFLICT', 'angles', null);
    end if;
  elsif current_essay.angle_generation_count <> 0 then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'angles', null);
  end if;

  select * into current_operation
  from private.ai_operations
  where id = requested_operation_id
    and user_id = requested_user_id
    and essay_id = requested_essay_id
    and purpose = 'ANGLE_GENERATION'
  for update;
  if not found or current_operation.status <> 'STARTED' then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'angles', null);
  end if;

  for angle in select value from jsonb_array_elements(requested_angles)
  loop
    if jsonb_typeof(angle -> 'storyFactIds') is distinct from 'array'
      or jsonb_array_length(angle -> 'storyFactIds') < 1
      or jsonb_typeof(angle -> 'schoolSourceIds') is distinct from 'array'
      or jsonb_array_length(angle -> 'schoolSourceIds') < 1
      or (
        select count(distinct value #>> '{}')
        from jsonb_array_elements(angle -> 'storyFactIds')
      ) <> jsonb_array_length(angle -> 'storyFactIds')
      or (
        select count(distinct value #>> '{}')
        from jsonb_array_elements(angle -> 'schoolSourceIds')
      ) <> jsonb_array_length(angle -> 'schoolSourceIds')
      or (
        select count(*)
        from public.story_facts facts
        where facts.user_id = requested_user_id
          and facts.id in (
            select (value #>> '{}')::uuid
            from jsonb_array_elements(angle -> 'storyFactIds')
          )
          and facts.verification_status = 'VERIFIED'
          and facts.suppressed_at is null
      ) <> jsonb_array_length(angle -> 'storyFactIds')
      or (
        select count(*)
        from public.school_dossier_sources sources
        where sources.user_id = requested_user_id
          and sources.dossier_id = requested_dossier_id
          and sources.id in (
            select (value #>> '{}')::uuid
            from jsonb_array_elements(angle -> 'schoolSourceIds')
          )
      ) <> jsonb_array_length(angle -> 'schoolSourceIds')
    then
      return jsonb_build_object('decision', 'EVIDENCE_INVALID', 'angles', null);
    end if;
  end loop;

  if requested_regenerate then
    delete from public.essay_angles
    where user_id = requested_user_id and essay_id = requested_essay_id;
  end if;

  for angle in select value from jsonb_array_elements(requested_angles)
  loop
    position := position + 1;
    insert into public.essay_angles (
      user_id, essay_id, dossier_id, operation_id, position,
      title, thesis, prompt_fit, risk, created_at, updated_at
    ) values (
      requested_user_id, requested_essay_id, requested_dossier_id,
      requested_operation_id, position, angle ->> 'title', angle ->> 'thesis',
      angle ->> 'promptFit', angle ->> 'risk', requested_at, requested_at
    ) returning id into angle_id;

    for evidence_id in
      select value #>> '{}' from jsonb_array_elements(angle -> 'storyFactIds')
    loop
      insert into public.angle_story_facts (
        user_id, essay_id, angle_id, story_fact_id, created_at
      ) values (
        requested_user_id, requested_essay_id, angle_id,
        evidence_id::uuid, requested_at
      );
    end loop;

    for evidence_id in
      select value #>> '{}' from jsonb_array_elements(angle -> 'schoolSourceIds')
    loop
      insert into public.angle_school_sources (
        user_id, essay_id, dossier_id, angle_id, school_source_id, created_at
      ) values (
        requested_user_id, requested_essay_id, requested_dossier_id, angle_id,
        evidence_id::uuid, requested_at
      );
    end loop;
  end loop;

  if not private.finalize_ai_operation(
    requested_operation_id, 'SUCCEEDED', 201, requested_provider_request_id,
    requested_model_id, requested_input_tokens, requested_output_tokens,
    requested_latency_ms, requested_final_cost_cents, 'ESSAY_ANGLE_SET',
    requested_essay_id, null, requested_at
  ) then
    raise exception using errcode = '40001', message = 'AI operation could not be finalized';
  end if;

  update public.essays
  set angle_generation_count = angle_generation_count + 1, updated_at = requested_at
  where user_id = requested_user_id and id = requested_essay_id;

  return jsonb_build_object(
    'decision', 'CREATED',
    'angles', private.get_essay_angles(
      requested_user_id, requested_essay_id, requested_operation_id
    )
  );
end;
$$;

revoke execute on function private.validate_angle_story_fact() from public, anon, authenticated;
revoke execute on function private.validate_angle_school_source() from public, anon, authenticated;
revoke execute on function private.get_essay_angles(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function private.commit_essay_angles(
  uuid, uuid, uuid, uuid, boolean, jsonb, text, text, integer, integer, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function private.get_essay_angles(uuid, uuid, uuid) to service_role;
grant execute on function private.commit_essay_angles(
  uuid, uuid, uuid, uuid, boolean, jsonb, text, text, integer, integer, integer, integer, timestamptz
) to service_role;
