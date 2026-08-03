create function private.invalidate_essay_research_dependents(
  requested_user_id uuid,
  requested_essay_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.essays'::regclass
      and attname = 'selected_angle_id'
      and not attisdropped
  ) then
    execute 'update public.essays set outline = null, selected_angle_id = null where user_id = $1 and id = $2'
    using requested_user_id, requested_essay_id;
  else
    update public.essays
    set outline = null
    where user_id = requested_user_id and id = requested_essay_id;
  end if;

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

create or replace function private.commit_school_dossier(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_operation_id uuid,
  requested_draft jsonb,
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
  current_dossier public.school_dossiers%rowtype;
  current_essay public.essays%rowtype;
  current_operation private.ai_operations%rowtype;
  source jsonb;
begin
  select * into current_dossier
  from public.school_dossiers
  where operation_id = requested_operation_id;
  if found then
    if current_dossier.user_id = requested_user_id and current_dossier.essay_id = requested_essay_id then
      select * into current_essay
      from public.essays
      where user_id = requested_user_id and id = requested_essay_id;
      return jsonb_build_object(
        'decision', 'REPLAY',
        'dossier', private.get_school_dossier(requested_user_id, current_dossier.id),
        'essay_revision', current_essay.revision
      );
    end if;
    return jsonb_build_object(
      'decision', 'STATE_CONFLICT', 'dossier', null, 'essay_revision', null
    );
  end if;

  if jsonb_typeof(requested_draft) is distinct from 'object'
    or requested_draft ->> 'schemaVersion' is distinct from '1'
    or jsonb_typeof(requested_draft -> 'summary') is distinct from 'string'
    or jsonb_typeof(requested_draft -> 'sources') is distinct from 'array'
    or jsonb_array_length(requested_draft -> 'sources') not between 1 and 20
  then
    raise exception using errcode = '22023', message = 'invalid school dossier';
  end if;

  select * into current_essay
  from public.essays
  where user_id = requested_user_id and id = requested_essay_id
  for update;
  if not found then
    return jsonb_build_object(
      'decision', 'NOT_FOUND', 'dossier', null, 'essay_revision', null
    );
  end if;
  if current_essay.dossier_id is not null then
    return jsonb_build_object(
      'decision', 'STATE_CONFLICT', 'dossier', null, 'essay_revision', null
    );
  end if;

  select * into current_operation
  from private.ai_operations
  where id = requested_operation_id
    and user_id = requested_user_id
    and essay_id = requested_essay_id
    and purpose = 'SCHOOL_RESEARCH'
  for update;
  if not found or current_operation.status <> 'STARTED' then
    return jsonb_build_object(
      'decision', 'STATE_CONFLICT', 'dossier', null, 'essay_revision', null
    );
  end if;

  insert into public.school_dossiers (
    user_id, essay_id, school_id, operation_id, schema_version,
    summary, created_at, updated_at
  ) values (
    requested_user_id, requested_essay_id, current_essay.school_id,
    requested_operation_id, requested_draft ->> 'schemaVersion',
    requested_draft ->> 'summary', requested_at, requested_at
  ) returning * into current_dossier;

  for source in select value from jsonb_array_elements(requested_draft -> 'sources')
  loop
    insert into public.school_dossier_sources (
      user_id, dossier_id, category, claim, title, supporting_excerpt,
      normalized_url, retrieved_at, created_at
    ) values (
      requested_user_id, current_dossier.id, source ->> 'category',
      source ->> 'claim', source ->> 'title', source ->> 'supportingExcerpt',
      source ->> 'normalizedUrl', (source ->> 'retrievedAt')::timestamptz, requested_at
    );
  end loop;

  if not private.finalize_ai_operation(
    requested_operation_id, 'SUCCEEDED', 201, requested_provider_request_id,
    requested_model_id, requested_input_tokens, requested_output_tokens,
    requested_latency_ms, requested_final_cost_cents, 'SCHOOL_DOSSIER',
    current_dossier.id, null, requested_at
  ) then
    raise exception using errcode = '40001', message = 'AI operation could not be finalized';
  end if;

  update public.essays
  set dossier_id = current_dossier.id, revision = revision + 1, updated_at = requested_at
  where user_id = requested_user_id and id = requested_essay_id
  returning * into current_essay;

  return jsonb_build_object(
    'decision', 'CREATED',
    'dossier', private.get_school_dossier(requested_user_id, current_dossier.id),
    'essay_revision', current_essay.revision
  );
end;
$$;

create function private.refresh_school_dossier(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_expected_revision integer,
  requested_operation_id uuid,
  requested_draft jsonb,
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
  current_dossier public.school_dossiers%rowtype;
  current_essay public.essays%rowtype;
  current_operation private.ai_operations%rowtype;
  source jsonb;
begin
  select * into current_dossier
  from public.school_dossiers
  where operation_id = requested_operation_id;
  if found then
    if current_dossier.user_id = requested_user_id and current_dossier.essay_id = requested_essay_id then
      select * into current_essay
      from public.essays
      where user_id = requested_user_id and id = requested_essay_id;
      return jsonb_build_object(
        'decision', 'REPLAY',
        'dossier', private.get_school_dossier(requested_user_id, current_dossier.id),
        'essay_revision', current_essay.revision
      );
    end if;
    return jsonb_build_object(
      'decision', 'STATE_CONFLICT', 'dossier', null, 'essay_revision', null
    );
  end if;

  if jsonb_typeof(requested_draft) is distinct from 'object'
    or requested_draft ->> 'schemaVersion' is distinct from '1'
    or jsonb_typeof(requested_draft -> 'summary') is distinct from 'string'
    or jsonb_typeof(requested_draft -> 'sources') is distinct from 'array'
    or jsonb_array_length(requested_draft -> 'sources') not between 1 and 20
  then
    raise exception using errcode = '22023', message = 'invalid school dossier';
  end if;

  select * into current_essay
  from public.essays
  where user_id = requested_user_id and id = requested_essay_id
  for update;
  if not found then
    return jsonb_build_object(
      'decision', 'NOT_FOUND', 'dossier', null, 'essay_revision', null
    );
  end if;
  if current_essay.revision <> requested_expected_revision then
    return jsonb_build_object(
      'decision', 'REVISION_MISMATCH', 'dossier', null,
      'essay_revision', current_essay.revision
    );
  end if;
  if current_essay.dossier_id is null then
    return jsonb_build_object(
      'decision', 'STATE_CONFLICT', 'dossier', null, 'essay_revision', null
    );
  end if;

  select * into current_operation
  from private.ai_operations
  where id = requested_operation_id
    and user_id = requested_user_id
    and essay_id = requested_essay_id
    and purpose = 'SCHOOL_RESEARCH'
  for update;
  if not found or current_operation.status <> 'STARTED' then
    return jsonb_build_object(
      'decision', 'STATE_CONFLICT', 'dossier', null, 'essay_revision', null
    );
  end if;

  insert into public.school_dossiers (
    user_id, essay_id, school_id, operation_id, schema_version,
    summary, created_at, updated_at
  ) values (
    requested_user_id, requested_essay_id, current_essay.school_id,
    requested_operation_id, requested_draft ->> 'schemaVersion',
    requested_draft ->> 'summary', requested_at, requested_at
  ) returning * into current_dossier;

  for source in select value from jsonb_array_elements(requested_draft -> 'sources')
  loop
    insert into public.school_dossier_sources (
      user_id, dossier_id, category, claim, title, supporting_excerpt,
      normalized_url, retrieved_at, created_at
    ) values (
      requested_user_id, current_dossier.id, source ->> 'category',
      source ->> 'claim', source ->> 'title', source ->> 'supportingExcerpt',
      source ->> 'normalizedUrl', (source ->> 'retrievedAt')::timestamptz, requested_at
    );
  end loop;

  perform private.invalidate_essay_research_dependents(
    requested_user_id, requested_essay_id
  );

  if not private.finalize_ai_operation(
    requested_operation_id, 'SUCCEEDED', 201, requested_provider_request_id,
    requested_model_id, requested_input_tokens, requested_output_tokens,
    requested_latency_ms, requested_final_cost_cents, 'SCHOOL_DOSSIER',
    current_dossier.id, null, requested_at
  ) then
    raise exception using errcode = '40001', message = 'AI operation could not be finalized';
  end if;

  update public.essays
  set dossier_id = current_dossier.id, revision = revision + 1, updated_at = requested_at
  where user_id = requested_user_id and id = requested_essay_id
  returning * into current_essay;

  return jsonb_build_object(
    'decision', 'CREATED',
    'dossier', private.get_school_dossier(requested_user_id, current_dossier.id),
    'essay_revision', current_essay.revision
  );
end;
$$;

revoke execute on function private.invalidate_essay_research_dependents(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.refresh_school_dossier(
  uuid, uuid, integer, uuid, jsonb, text, text, integer, integer, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function private.invalidate_essay_research_dependents(uuid, uuid)
to service_role;
grant execute on function private.refresh_school_dossier(
  uuid, uuid, integer, uuid, jsonb, text, text, integer, integer, integer, integer, timestamptz
) to service_role;
