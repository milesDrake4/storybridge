create function private.get_advice_proposal(
  requested_user_id uuid,
  requested_proposal_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', proposals.id, 'user_id', proposals.user_id,
    'essay_id', proposals.essay_id, 'kind', proposals.kind,
    'target_revision', proposals.target_revision,
    'guidance', proposals.proposed_content -> 'guidance',
    'headline', proposals.proposed_content ->> 'headline',
    'rationale', proposals.rationale, 'status', proposals.status,
    'created_at', proposals.created_at, 'expires_at', proposals.expires_at
  )
  from private.ai_proposals proposals
  where proposals.user_id = requested_user_id
    and proposals.id = requested_proposal_id and proposals.kind = 'ADVICE';
$$;

create function private.commit_advice_proposal(
  requested_user_id uuid,
  requested_essay_id uuid,
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
begin
  select * into current_proposal from private.ai_proposals
  where operation_id = requested_operation_id;
  if found then
    if current_proposal.user_id = requested_user_id
      and current_proposal.essay_id = requested_essay_id
      and current_proposal.kind = 'ADVICE'
    then
      return jsonb_build_object(
        'decision', 'REPLAY',
        'proposal', private.get_advice_proposal(requested_user_id, current_proposal.id)
      );
    end if;
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;

  select * into current_essay from public.essays
  where user_id = requested_user_id and id = requested_essay_id for update;
  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND', 'proposal', null);
  end if;
  if current_essay.revision <> requested_target_revision then
    return jsonb_build_object('decision', 'REVISION_MISMATCH', 'proposal', null);
  end if;
  if current_essay.dossier_id is null or current_essay.outline is null then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;
  if jsonb_typeof(requested_draft) is distinct from 'object'
    or jsonb_typeof(requested_draft -> 'guidance') is distinct from 'array'
    or jsonb_array_length(requested_draft -> 'guidance') not between 1 and 5
    or coalesce(char_length(requested_draft ->> 'headline'), 0) not between 1 and 160
    or coalesce(char_length(requested_draft ->> 'rationale'), 0) not between 1 and 1000
    or exists (
      select 1 from jsonb_array_elements_text(requested_draft -> 'guidance') item
      where char_length(item) not between 1 and 500
    )
  then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;

  select * into current_operation from private.ai_operations
  where id = requested_operation_id and user_id = requested_user_id
    and essay_id = requested_essay_id and purpose = 'COACHING'
    and status = 'STARTED' for update;
  if not found then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;

  insert into private.ai_proposals (
    user_id, essay_id, operation_id, kind, target_revision,
    proposed_content, rationale, status, created_at, expires_at
  ) values (
    requested_user_id, requested_essay_id, requested_operation_id, 'ADVICE',
    requested_target_revision, requested_draft - 'rationale',
    requested_draft ->> 'rationale', 'PENDING', requested_at,
    requested_at + interval '24 hours'
  ) returning * into current_proposal;

  update private.ai_operations set
    status = 'SUCCEEDED', completed_at = requested_at,
    result_resource_type = 'ADVICE_PROPOSAL',
    result_resource_id = current_proposal.id,
    provider_request_id = requested_provider_request_id,
    model_id = requested_model_id, input_tokens = requested_input_tokens,
    output_tokens = requested_output_tokens, latency_ms = requested_latency_ms,
    final_cost_cents = requested_final_cost_cents, original_http_status = 201,
    safe_error_code = null, updated_at = requested_at
  where id = requested_operation_id;

  return jsonb_build_object(
    'decision', 'CREATED',
    'proposal', private.get_advice_proposal(requested_user_id, current_proposal.id)
  );
end;
$$;

revoke execute on function private.get_advice_proposal(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.commit_advice_proposal(
  uuid, uuid, integer, uuid, jsonb, text, text,
  integer, integer, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function private.get_advice_proposal(uuid, uuid) to service_role;
grant execute on function private.commit_advice_proposal(
  uuid, uuid, integer, uuid, jsonb, text, text,
  integer, integer, integer, integer, timestamptz
) to service_role;
