create function private.update_essay_outline(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_expected_revision integer,
  requested_outline jsonb,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_essay public.essays%rowtype;
  evidence_id text;
  section jsonb;
  total_words integer := 0;
begin
  if jsonb_typeof(requested_outline) is distinct from 'object'
    or requested_outline ->> 'schemaVersion' is distinct from '1'
    or jsonb_typeof(requested_outline -> 'sections') is distinct from 'array'
    or jsonb_array_length(requested_outline -> 'sections') not between 3 and 6
    or (
      select count(distinct value ->> 'id')
      from jsonb_array_elements(requested_outline -> 'sections')
    ) <> jsonb_array_length(requested_outline -> 'sections')
  then
    raise exception using errcode = '22023', message = 'invalid essay outline';
  end if;

  select * into current_essay
  from public.essays
  where user_id = requested_user_id and id = requested_essay_id
  for update;
  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND', 'essay', null);
  end if;
  if current_essay.revision <> requested_expected_revision then
    return jsonb_build_object('decision', 'REVISION_MISMATCH', 'essay', null);
  end if;
  if current_essay.selected_angle_id is null then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
  end if;

  for section in select value from jsonb_array_elements(requested_outline -> 'sections')
  loop
    total_words := total_words + (section ->> 'targetWords')::integer;
    if jsonb_typeof(section -> 'storyFactIds') is distinct from 'array'
      or jsonb_array_length(section -> 'storyFactIds') < 1
      or jsonb_typeof(section -> 'schoolSourceIds') is distinct from 'array'
      or jsonb_array_length(section -> 'schoolSourceIds') < 1
    then
      return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
    end if;
    for evidence_id in
      select value #>> '{}' from jsonb_array_elements(section -> 'storyFactIds')
    loop
      if not exists (
        select 1 from public.angle_story_facts links
        join public.story_facts facts
          on facts.user_id = links.user_id and facts.id = links.story_fact_id
        where links.user_id = requested_user_id
          and links.essay_id = requested_essay_id
          and links.angle_id = current_essay.selected_angle_id
          and links.story_fact_id = evidence_id::uuid
          and facts.verification_status = 'VERIFIED'
          and facts.suppressed_at is null
      ) then
        return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
      end if;
    end loop;
    for evidence_id in
      select value #>> '{}' from jsonb_array_elements(section -> 'schoolSourceIds')
    loop
      if not exists (
        select 1 from public.angle_school_sources links
        where links.user_id = requested_user_id
          and links.essay_id = requested_essay_id
          and links.dossier_id = current_essay.dossier_id
          and links.angle_id = current_essay.selected_angle_id
          and links.school_source_id = evidence_id::uuid
      ) then
        return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
      end if;
    end loop;
  end loop;

  if total_words < pg_catalog.ceil(current_essay.word_limit * 0.9)
    or total_words > pg_catalog.floor(current_essay.word_limit * 1.1)
  then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'essay', null);
  end if;

  update public.essays
  set outline = requested_outline,
      status = 'DRAFTING',
      revision = revision + 1,
      updated_at = requested_at
  where user_id = requested_user_id and id = requested_essay_id
  returning * into current_essay;
  return jsonb_build_object(
    'decision', 'UPDATED', 'essay', to_jsonb(current_essay)
  );
end;
$$;

revoke execute on function private.update_essay_outline(
  uuid, uuid, integer, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function private.update_essay_outline(
  uuid, uuid, integer, jsonb, timestamptz
) to service_role;
