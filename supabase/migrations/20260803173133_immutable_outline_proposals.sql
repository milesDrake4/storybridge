create table private.ai_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  operation_id uuid not null unique references private.ai_operations (id) on delete restrict,
  kind text not null,
  target_revision integer not null,
  selected_angle_id uuid,
  proposed_content jsonb not null,
  rationale text not null,
  status text not null default 'PENDING',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  constraint ai_proposals_owner_essay_fk foreign key (user_id, essay_id)
    references public.essays (user_id, id) on delete cascade,
  constraint ai_proposals_user_id_id_key unique (user_id, id),
  constraint ai_proposals_kind_check check (
    kind in ('OUTLINE', 'ADVICE', 'REWRITE', 'CONTINUATION', 'REFERENCE_DRAFT')
  ),
  constraint ai_proposals_outline_angle_check check (
    kind <> 'OUTLINE' or selected_angle_id is not null
  ),
  constraint ai_proposals_revision_check check (target_revision >= 0),
  constraint ai_proposals_content_check check (jsonb_typeof(proposed_content) = 'object'),
  constraint ai_proposals_rationale_check check (char_length(rationale) between 1 and 1000),
  constraint ai_proposals_status_check check (
    status in ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED')
  ),
  constraint ai_proposals_expiry_check check (expires_at > created_at),
  constraint ai_proposals_acceptance_check check (
    (status = 'ACCEPTED' and accepted_at is not null)
    or (status <> 'ACCEPTED' and accepted_at is null)
  )
);

create index ai_proposals_owner_essay_kind_idx
on private.ai_proposals (user_id, essay_id, kind, created_at desc, id desc);

alter table private.ai_proposals enable row level security;
revoke all on table private.ai_proposals from public, anon, authenticated;
grant select, insert, update, delete on table private.ai_proposals to service_role;

create function private.get_outline_proposal(
  requested_user_id uuid,
  requested_proposal_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', proposals.id,
    'user_id', proposals.user_id,
    'essay_id', proposals.essay_id,
    'kind', proposals.kind,
    'target_revision', proposals.target_revision,
    'selected_angle_id', proposals.selected_angle_id,
    'outline', proposals.proposed_content,
    'rationale', proposals.rationale,
    'status', proposals.status,
    'created_at', proposals.created_at,
    'expires_at', proposals.expires_at
  )
  from private.ai_proposals proposals
  where proposals.user_id = requested_user_id
    and proposals.id = requested_proposal_id
    and proposals.kind = 'OUTLINE';
$$;

create function private.commit_outline_proposal(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_dossier_id uuid,
  requested_angle_id uuid,
  requested_target_revision integer,
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
  current_essay public.essays%rowtype;
  current_operation private.ai_operations%rowtype;
  current_proposal private.ai_proposals%rowtype;
  evidence_id text;
  section jsonb;
  total_words integer := 0;
begin
  select * into current_proposal
  from private.ai_proposals
  where operation_id = requested_operation_id;
  if found then
    if current_proposal.user_id = requested_user_id
      and current_proposal.essay_id = requested_essay_id
      and current_proposal.kind = 'OUTLINE'
    then
      return jsonb_build_object(
        'decision', 'REPLAY',
        'proposal', private.get_outline_proposal(requested_user_id, current_proposal.id)
      );
    end if;
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;

  if jsonb_typeof(requested_draft) is distinct from 'object'
    or jsonb_typeof(requested_draft -> 'outline') is distinct from 'object'
    or requested_draft -> 'outline' ->> 'schemaVersion' is distinct from '1'
    or jsonb_typeof(requested_draft -> 'outline' -> 'sections') is distinct from 'array'
    or jsonb_array_length(requested_draft -> 'outline' -> 'sections') not between 3 and 6
    or (
      select count(distinct value ->> 'id')
      from jsonb_array_elements(requested_draft -> 'outline' -> 'sections')
    ) <> jsonb_array_length(requested_draft -> 'outline' -> 'sections')
  then
    raise exception using errcode = '22023', message = 'invalid outline proposal';
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
  if current_essay.dossier_id is distinct from requested_dossier_id
    or current_essay.selected_angle_id is distinct from requested_angle_id
  then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;

  select * into current_operation
  from private.ai_operations
  where id = requested_operation_id
    and user_id = requested_user_id
    and essay_id = requested_essay_id
    and purpose = 'OUTLINE_GENERATION'
  for update;
  if not found or current_operation.status <> 'STARTED' then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;

  for section in
    select value from jsonb_array_elements(requested_draft -> 'outline' -> 'sections')
  loop
    total_words := total_words + (section ->> 'targetWords')::integer;
    if jsonb_typeof(section -> 'storyFactIds') is distinct from 'array'
      or jsonb_array_length(section -> 'storyFactIds') < 1
      or jsonb_typeof(section -> 'schoolSourceIds') is distinct from 'array'
      or jsonb_array_length(section -> 'schoolSourceIds') < 1
    then
      return jsonb_build_object('decision', 'EVIDENCE_INVALID', 'proposal', null);
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
          and links.angle_id = requested_angle_id
          and links.story_fact_id = evidence_id::uuid
          and facts.verification_status = 'VERIFIED'
          and facts.suppressed_at is null
      ) then
        return jsonb_build_object('decision', 'EVIDENCE_INVALID', 'proposal', null);
      end if;
    end loop;
    for evidence_id in
      select value #>> '{}' from jsonb_array_elements(section -> 'schoolSourceIds')
    loop
      if not exists (
        select 1 from public.angle_school_sources links
        where links.user_id = requested_user_id
          and links.essay_id = requested_essay_id
          and links.dossier_id = requested_dossier_id
          and links.angle_id = requested_angle_id
          and links.school_source_id = evidence_id::uuid
      ) then
        return jsonb_build_object('decision', 'EVIDENCE_INVALID', 'proposal', null);
      end if;
    end loop;
  end loop;

  if total_words < pg_catalog.ceil(current_essay.word_limit * 0.9)
    or total_words > pg_catalog.floor(current_essay.word_limit * 1.1)
  then
    return jsonb_build_object('decision', 'EVIDENCE_INVALID', 'proposal', null);
  end if;

  insert into private.ai_proposals (
    user_id, essay_id, operation_id, kind, target_revision,
    selected_angle_id, proposed_content, rationale, status,
    created_at, expires_at
  ) values (
    requested_user_id, requested_essay_id, requested_operation_id, 'OUTLINE',
    requested_target_revision, requested_angle_id,
    requested_draft -> 'outline', requested_draft ->> 'rationale', 'PENDING',
    requested_at, requested_at + interval '30 days'
  ) returning * into current_proposal;

  if not private.finalize_ai_operation(
    requested_operation_id, 'SUCCEEDED', 201, requested_provider_request_id,
    requested_model_id, requested_input_tokens, requested_output_tokens,
    requested_latency_ms, requested_final_cost_cents, 'OUTLINE_PROPOSAL',
    current_proposal.id, null, requested_at
  ) then
    raise exception using errcode = '40001', message = 'AI operation could not be finalized';
  end if;

  return jsonb_build_object(
    'decision', 'CREATED',
    'proposal', private.get_outline_proposal(requested_user_id, current_proposal.id)
  );
end;
$$;

revoke execute on function private.get_outline_proposal(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.commit_outline_proposal(
  uuid, uuid, uuid, uuid, integer, uuid, jsonb, text, text, integer, integer, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function private.get_outline_proposal(uuid, uuid) to service_role;
grant execute on function private.commit_outline_proposal(
  uuid, uuid, uuid, uuid, integer, uuid, jsonb, text, text, integer, integer, integer, integer, timestamptz
) to service_role;
