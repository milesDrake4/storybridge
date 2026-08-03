alter table private.ai_proposals
  add column acknowledgment_version text;

alter table private.ai_proposals
  add constraint ai_proposals_reference_acknowledgment_check check (
    (kind = 'REFERENCE_DRAFT' and acknowledgment_version = 'reference-draft-2026-08-02')
    or (kind <> 'REFERENCE_DRAFT' and acknowledgment_version is null)
  );

alter table public.school_dossier_sources
  add constraint school_dossier_sources_user_id_id_key unique (user_id, id);

create table private.proposal_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  proposal_id uuid not null,
  position integer not null,
  claim_text text not null,
  start_offset integer not null,
  end_offset integer not null,
  status text not null,
  content_hmac text not null,
  created_at timestamptz not null default now(),
  constraint proposal_claims_owner_proposal_fk foreign key (
    user_id, essay_id, proposal_id
  ) references private.ai_proposals (user_id, essay_id, id) on delete cascade,
  constraint proposal_claims_user_id_id_key unique (user_id, id),
  constraint proposal_claims_owner_essay_id_key unique (user_id, essay_id, id),
  constraint proposal_claims_position_key unique (proposal_id, position),
  constraint proposal_claims_position_check check (position between 1 and 50),
  constraint proposal_claims_text_check check (char_length(claim_text) between 1 and 1000),
  constraint proposal_claims_span_check check (
    start_offset >= 0 and end_offset > start_offset and end_offset <= 20000
  ),
  constraint proposal_claims_status_check check (status in ('SUPPORTED', 'UNSUPPORTED')),
  constraint proposal_claims_content_hmac_check check (
    content_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  )
);

create index proposal_claims_owner_proposal_idx
on private.proposal_claims (user_id, proposal_id, position);

create table private.proposal_claim_story_facts (
  user_id uuid not null,
  essay_id uuid not null,
  proposal_claim_id uuid not null,
  story_fact_id uuid not null,
  primary key (proposal_claim_id, story_fact_id),
  constraint proposal_claim_story_facts_claim_fk foreign key (
    user_id, essay_id, proposal_claim_id
  ) references private.proposal_claims (user_id, essay_id, id) on delete cascade,
  constraint proposal_claim_story_facts_fact_fk foreign key (user_id, story_fact_id)
    references public.story_facts (user_id, id) on delete restrict
);

create index proposal_claim_story_facts_owner_fact_idx
on private.proposal_claim_story_facts (user_id, story_fact_id);

create table private.proposal_claim_school_sources (
  user_id uuid not null,
  essay_id uuid not null,
  proposal_claim_id uuid not null,
  school_source_id uuid not null,
  primary key (proposal_claim_id, school_source_id),
  constraint proposal_claim_school_sources_claim_fk foreign key (
    user_id, essay_id, proposal_claim_id
  ) references private.proposal_claims (user_id, essay_id, id) on delete cascade,
  constraint proposal_claim_school_sources_source_fk foreign key (
    user_id, school_source_id
  ) references public.school_dossier_sources (user_id, id) on delete restrict
);

create index proposal_claim_school_sources_owner_source_idx
on private.proposal_claim_school_sources (user_id, school_source_id);

alter table private.proposal_claims enable row level security;
alter table private.proposal_claim_story_facts enable row level security;
alter table private.proposal_claim_school_sources enable row level security;

revoke all on table private.proposal_claims from public, anon, authenticated;
revoke all on table private.proposal_claim_story_facts from public, anon, authenticated;
revoke all on table private.proposal_claim_school_sources from public, anon, authenticated;
grant select, insert, update, delete on table private.proposal_claims to service_role;
grant select, insert, update, delete on table private.proposal_claim_story_facts to service_role;
grant select, insert, update, delete on table private.proposal_claim_school_sources to service_role;

create function private.get_reference_draft_proposal(
  requested_user_id uuid,
  requested_proposal_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', proposal.id,
    'user_id', proposal.user_id,
    'essay_id', proposal.essay_id,
    'kind', proposal.kind,
    'target_revision', proposal.target_revision,
    'acknowledgment_version', proposal.acknowledgment_version,
    'reference_text', proposal.proposed_content ->> 'referenceText',
    'rationale', proposal.rationale,
    'status', proposal.status,
    'created_at', proposal.created_at,
    'expires_at', proposal.expires_at,
    'claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', claim.id,
        'text', claim.claim_text,
        'start', claim.start_offset,
        'end', claim.end_offset,
        'status', claim.status,
        'content_hmac', claim.content_hmac,
        'story_fact_ids', coalesce((
          select jsonb_agg(link.story_fact_id order by link.story_fact_id)
          from private.proposal_claim_story_facts link
          where link.user_id = claim.user_id
            and link.proposal_claim_id = claim.id
        ), '[]'::jsonb),
        'school_source_ids', coalesce((
          select jsonb_agg(link.school_source_id order by link.school_source_id)
          from private.proposal_claim_school_sources link
          where link.user_id = claim.user_id
            and link.proposal_claim_id = claim.id
        ), '[]'::jsonb)
      ) order by claim.position)
      from private.proposal_claims claim
      where claim.user_id = proposal.user_id
        and claim.essay_id = proposal.essay_id
        and claim.proposal_id = proposal.id
    ), '[]'::jsonb)
  )
  from private.ai_proposals proposal
  where proposal.user_id = requested_user_id
    and proposal.id = requested_proposal_id
    and proposal.kind = 'REFERENCE_DRAFT';
$$;

create function private.commit_reference_draft_proposal(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_target_revision integer,
  requested_operation_id uuid,
  requested_acknowledgment_version text,
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
  claim jsonb;
  claim_position bigint;
  current_claim private.proposal_claims%rowtype;
  current_essay public.essays%rowtype;
  current_operation private.ai_operations%rowtype;
  current_proposal private.ai_proposals%rowtype;
  evidence_id text;
  previous_end integer := 0;
  reference_text text;
begin
  select * into current_proposal
  from private.ai_proposals
  where operation_id = requested_operation_id;
  if found then
    if current_proposal.user_id = requested_user_id
      and current_proposal.essay_id = requested_essay_id
      and current_proposal.kind = 'REFERENCE_DRAFT'
    then
      return jsonb_build_object(
        'decision', 'REPLAY',
        'proposal', private.get_reference_draft_proposal(
          requested_user_id, current_proposal.id
        )
      );
    end if;
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;

  if requested_acknowledgment_version <> 'reference-draft-2026-08-02'
    or jsonb_typeof(requested_draft) is distinct from 'object'
    or jsonb_typeof(requested_draft -> 'referenceText') is distinct from 'string'
    or jsonb_typeof(requested_draft -> 'rationale') is distinct from 'string'
    or jsonb_typeof(requested_draft -> 'claims') is distinct from 'array'
    or jsonb_array_length(requested_draft -> 'claims') not between 1 and 50
  then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;
  reference_text := requested_draft ->> 'referenceText';
  if char_length(reference_text) not between 1 and 20000
    or char_length(requested_draft ->> 'rationale') not between 1 and 1000
    or cardinality(pg_catalog.regexp_split_to_array(pg_catalog.btrim(reference_text), '\s+'))
      > (select word_limit from public.essays where user_id = requested_user_id and id = requested_essay_id)
  then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;

  select * into current_essay
  from public.essays
  where user_id = requested_user_id and id = requested_essay_id
  for update;
  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND', 'proposal', null);
  end if;
  if current_essay.revision <> requested_target_revision then
    return jsonb_build_object('decision', 'REVISION_MISMATCH', 'proposal', null);
  end if;
  if current_essay.dossier_id is null
    or current_essay.selected_angle_id is null
    or current_essay.outline is null
    or jsonb_typeof(current_essay.outline -> 'sections') is distinct from 'array'
    or jsonb_array_length(current_essay.outline -> 'sections') < 3
  then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;

  select * into current_operation
  from private.ai_operations
  where id = requested_operation_id
    and user_id = requested_user_id
    and essay_id = requested_essay_id
    and purpose = 'REFERENCE_DRAFT'
    and status = 'STARTED'
  for update;
  if not found then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;

  insert into private.ai_proposals (
    user_id, essay_id, operation_id, kind, target_revision,
    selected_angle_id, proposed_content, rationale, status,
    acknowledgment_version, created_at, expires_at
  ) values (
    requested_user_id, requested_essay_id, requested_operation_id,
    'REFERENCE_DRAFT', requested_target_revision, current_essay.selected_angle_id,
    jsonb_build_object('referenceText', reference_text),
    requested_draft ->> 'rationale', 'PENDING',
    requested_acknowledgment_version, requested_at,
    requested_at + interval '18 months'
  ) returning * into current_proposal;

  for claim, claim_position in
    select value, ordinality
    from jsonb_array_elements(requested_draft -> 'claims') with ordinality
  loop
    if jsonb_typeof(claim) is distinct from 'object'
      or jsonb_typeof(claim -> 'text') is distinct from 'string'
      or jsonb_typeof(claim -> 'storyFactIds') is distinct from 'array'
      or jsonb_typeof(claim -> 'schoolSourceIds') is distinct from 'array'
      or coalesce(claim ->> 'start', '') !~ '^[0-9]+$'
      or coalesce(claim ->> 'end', '') !~ '^[0-9]+$'
      or (claim ->> 'start')::integer < previous_end
      or (claim ->> 'end')::integer <= (claim ->> 'start')::integer
      or (claim ->> 'end')::integer > char_length(reference_text)
      or pg_catalog.substring(
        reference_text,
        (claim ->> 'start')::integer + 1,
        (claim ->> 'end')::integer - (claim ->> 'start')::integer
      ) is distinct from claim ->> 'text'
      or char_length(claim ->> 'text') not between 1 and 1000
      or coalesce(claim ->> 'contentHmac', '') !~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
      or jsonb_array_length(claim -> 'storyFactIds') > 10
      or jsonb_array_length(claim -> 'schoolSourceIds') > 10
      or jsonb_array_length(claim -> 'storyFactIds')
        + jsonb_array_length(claim -> 'schoolSourceIds') < 1
    then
      raise exception using errcode = '22023', message = 'invalid reference claim';
    end if;

    insert into private.proposal_claims (
      user_id, essay_id, proposal_id, position, claim_text,
      start_offset, end_offset, status, content_hmac, created_at
    ) values (
      requested_user_id, requested_essay_id, current_proposal.id, claim_position,
      claim ->> 'text', (claim ->> 'start')::integer,
      (claim ->> 'end')::integer, 'SUPPORTED', claim ->> 'contentHmac', requested_at
    ) returning * into current_claim;

    for evidence_id in
      select value #>> '{}' from jsonb_array_elements(claim -> 'storyFactIds')
    loop
      if evidence_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or not exists (
          select 1 from public.story_facts fact
          where fact.user_id = requested_user_id
            and fact.id = evidence_id::uuid
            and fact.verification_status = 'VERIFIED'
            and fact.suppressed_at is null
        )
        or not exists (
          select 1
          from jsonb_array_elements(current_essay.outline -> 'sections') section,
            jsonb_array_elements_text(section -> 'storyFactIds') linked(value)
          where linked.value = evidence_id
        )
      then
        raise exception using errcode = '23514', message = 'invalid reference evidence';
      end if;
      insert into private.proposal_claim_story_facts (
        user_id, essay_id, proposal_claim_id, story_fact_id
      ) values (
        requested_user_id, requested_essay_id, current_claim.id, evidence_id::uuid
      );
    end loop;

    for evidence_id in
      select value #>> '{}' from jsonb_array_elements(claim -> 'schoolSourceIds')
    loop
      if evidence_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or not exists (
          select 1 from public.school_dossier_sources source
          where source.user_id = requested_user_id
            and source.id = evidence_id::uuid
            and source.dossier_id = current_essay.dossier_id
        )
        or not exists (
          select 1
          from jsonb_array_elements(current_essay.outline -> 'sections') section,
            jsonb_array_elements_text(section -> 'schoolSourceIds') linked(value)
          where linked.value = evidence_id
        )
      then
        raise exception using errcode = '23514', message = 'invalid reference evidence';
      end if;
      insert into private.proposal_claim_school_sources (
        user_id, essay_id, proposal_claim_id, school_source_id
      ) values (
        requested_user_id, requested_essay_id, current_claim.id, evidence_id::uuid
      );
    end loop;
    previous_end := (claim ->> 'end')::integer;
  end loop;

  if not private.finalize_ai_operation(
    requested_operation_id, 'SUCCEEDED', 201, requested_provider_request_id,
    requested_model_id, requested_input_tokens, requested_output_tokens,
    requested_latency_ms, requested_final_cost_cents,
    'REFERENCE_DRAFT_PROPOSAL', current_proposal.id, null, requested_at
  ) then
    raise exception using errcode = '40001', message = 'AI operation could not be finalized';
  end if;

  return jsonb_build_object(
    'decision', 'CREATED',
    'proposal', private.get_reference_draft_proposal(
      requested_user_id, current_proposal.id
    )
  );
exception
  when check_violation or invalid_text_representation then
    return jsonb_build_object('decision', 'EVIDENCE_INVALID', 'proposal', null);
end;
$$;

revoke execute on function private.get_reference_draft_proposal(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.commit_reference_draft_proposal(
  uuid, uuid, integer, uuid, text, jsonb, text, text,
  integer, integer, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function private.get_reference_draft_proposal(uuid, uuid)
to service_role;
grant execute on function private.commit_reference_draft_proposal(
  uuid, uuid, integer, uuid, text, jsonb, text, text,
  integer, integer, integer, integer, timestamptz
) to service_role;
