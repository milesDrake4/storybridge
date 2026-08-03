create table public.school_dossiers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  school_id uuid not null references private.schools (id) on delete restrict,
  operation_id uuid not null unique references private.ai_operations (id) on delete restrict,
  schema_version text not null default '1',
  summary text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint school_dossiers_user_id_id_key unique (user_id, id),
  constraint school_dossiers_essay_owner_fk foreign key (user_id, essay_id)
    references public.essays (user_id, id) on delete cascade,
  constraint school_dossiers_schema_version_check check (schema_version = '1'),
  constraint school_dossiers_summary_check check (char_length(summary) between 1 and 1500),
  constraint school_dossiers_timestamps_check check (updated_at >= created_at)
);

create index school_dossiers_owner_essay_created_idx
on public.school_dossiers (user_id, essay_id, created_at desc, id desc);
create index school_dossiers_school_id_idx on public.school_dossiers (school_id);

create table public.school_dossier_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  dossier_id uuid not null,
  category text not null,
  claim text not null,
  title text not null,
  supporting_excerpt text not null,
  normalized_url text not null,
  retrieved_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint school_dossier_sources_owner_fk foreign key (user_id, dossier_id)
    references public.school_dossiers (user_id, id) on delete cascade,
  constraint school_dossier_sources_category_check check (
    category in ('ACADEMICS', 'PROGRAMS', 'CULTURE', 'COMMUNITY', 'OPPORTUNITIES', 'VALUES', 'ADMISSIONS')
  ),
  constraint school_dossier_sources_claim_check check (char_length(claim) between 1 and 500),
  constraint school_dossier_sources_title_check check (char_length(title) between 1 and 300),
  constraint school_dossier_sources_excerpt_check check (char_length(supporting_excerpt) between 1 and 300),
  constraint school_dossier_sources_url_check check (
    normalized_url ~ '^https://[^[:space:]]+$' and char_length(normalized_url) <= 2048
  ),
  constraint school_dossier_sources_unique_evidence unique (dossier_id, normalized_url, claim)
);

create index school_dossier_sources_owner_dossier_idx
on public.school_dossier_sources (user_id, dossier_id, id);

alter table public.essays
add constraint essays_dossier_owner_fk foreign key (user_id, dossier_id)
references public.school_dossiers (user_id, id) on delete set null (dossier_id);

create trigger school_dossiers_set_updated_at
before update on public.school_dossiers
for each row execute function private.set_updated_at();

alter table public.school_dossiers enable row level security;
alter table public.school_dossier_sources enable row level security;

create policy school_dossiers_select_own on public.school_dossiers
for select to authenticated using ((select auth.uid()) = user_id);
create policy school_dossier_sources_select_own on public.school_dossier_sources
for select to authenticated using ((select auth.uid()) = user_id);

revoke all on table public.school_dossiers from anon, authenticated;
revoke all on table public.school_dossier_sources from anon, authenticated;
grant select on table public.school_dossiers to authenticated;
grant select on table public.school_dossier_sources to authenticated;
grant select, insert, update, delete on table public.school_dossiers to service_role;
grant select, insert, update, delete on table public.school_dossier_sources to service_role;

create function private.get_school_dossier(
  requested_user_id uuid,
  requested_dossier_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', dossiers.id,
    'user_id', dossiers.user_id,
    'essay_id', dossiers.essay_id,
    'school_id', dossiers.school_id,
    'schema_version', dossiers.schema_version,
    'summary', dossiers.summary,
    'created_at', dossiers.created_at,
    'updated_at', dossiers.updated_at,
    'sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', sources.id,
        'category', sources.category,
        'claim', sources.claim,
        'title', sources.title,
        'supporting_excerpt', sources.supporting_excerpt,
        'normalized_url', sources.normalized_url,
        'retrieved_at', sources.retrieved_at
      ) order by sources.id)
      from public.school_dossier_sources sources
      where sources.user_id = dossiers.user_id and sources.dossier_id = dossiers.id
    ), '[]'::jsonb)
  )
  from public.school_dossiers dossiers
  where dossiers.user_id = requested_user_id and dossiers.id = requested_dossier_id;
$$;

create function private.get_school_dossier_for_essay(
  requested_user_id uuid,
  requested_essay_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select private.get_school_dossier(essays.user_id, essays.dossier_id)
  from public.essays essays
  where essays.user_id = requested_user_id
    and essays.id = requested_essay_id
    and essays.dossier_id is not null;
$$;

create function private.commit_school_dossier(
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
  if jsonb_typeof(requested_draft) is distinct from 'object'
    or requested_draft ->> 'schemaVersion' is distinct from '1'
    or jsonb_typeof(requested_draft -> 'summary') is distinct from 'string'
    or jsonb_typeof(requested_draft -> 'sources') is distinct from 'array'
    or jsonb_array_length(requested_draft -> 'sources') not between 1 and 20
  then
    raise exception using errcode = '22023', message = 'invalid school dossier';
  end if;

  select * into current_dossier
  from public.school_dossiers
  where operation_id = requested_operation_id;
  if found then
    if current_dossier.user_id = requested_user_id and current_dossier.essay_id = requested_essay_id then
      return jsonb_build_object(
        'decision', 'REPLAY',
        'dossier', private.get_school_dossier(requested_user_id, current_dossier.id)
      );
    end if;
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'dossier', null);
  end if;

  select * into current_essay
  from public.essays
  where user_id = requested_user_id and id = requested_essay_id
  for update;
  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND', 'dossier', null);
  end if;
  if current_essay.dossier_id is not null then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'dossier', null);
  end if;

  select * into current_operation
  from private.ai_operations
  where id = requested_operation_id
    and user_id = requested_user_id
    and essay_id = requested_essay_id
    and purpose = 'SCHOOL_RESEARCH'
  for update;
  if not found or current_operation.status <> 'STARTED' then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'dossier', null);
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
  where user_id = requested_user_id and id = requested_essay_id;

  return jsonb_build_object(
    'decision', 'CREATED',
    'dossier', private.get_school_dossier(requested_user_id, current_dossier.id)
  );
end;
$$;

revoke execute on function private.get_school_dossier(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.get_school_dossier_for_essay(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.commit_school_dossier(
  uuid, uuid, uuid, jsonb, text, text, integer, integer, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function private.get_school_dossier(uuid, uuid) to service_role;
grant execute on function private.get_school_dossier_for_essay(uuid, uuid) to service_role;
grant execute on function private.commit_school_dossier(
  uuid, uuid, uuid, jsonb, text, text, integer, integer, integer, integer, timestamptz
) to service_role;
