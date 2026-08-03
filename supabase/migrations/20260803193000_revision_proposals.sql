create function private.sha256_base64url(requested_text text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select pg_catalog.rtrim(
    pg_catalog.translate(
      pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(requested_text, 'UTF8')),
        'base64'
      ),
      '+/', '-_'
    ),
    '='
  );
$$;

alter table private.ai_proposals
  add column selection_start integer,
  add column selection_end integer,
  add column selection_text_hash text,
  add column cursor_offset integer,
  add column context_hash text,
  add column rewrite_instruction text;

alter table private.ai_proposals add constraint ai_proposals_revision_binding_check check (
  (
    kind = 'REWRITE'
    and selection_start is not null and selection_start >= 0
    and selection_end is not null and selection_end > selection_start
    and selection_text_hash is not null
    and selection_text_hash ~ '^[A-Za-z0-9_-]{43}$'
    and cursor_offset is null and context_hash is null
    and rewrite_instruction is not null
    and rewrite_instruction in (
      'CLARIFY', 'TIGHTEN', 'EXPAND', 'STRENGTHEN_EVIDENCE',
      'IMPROVE_TRANSITION', 'PRESERVE_VOICE', 'CUSTOM'
    )
  ) or (
    kind = 'CONTINUATION'
    and cursor_offset is not null and cursor_offset >= 0
    and context_hash is not null
    and context_hash ~ '^[A-Za-z0-9_-]{43}$'
    and selection_start is null and selection_end is null
    and selection_text_hash is null and rewrite_instruction is null
  ) or (
    kind not in ('REWRITE', 'CONTINUATION')
    and selection_start is null and selection_end is null
    and selection_text_hash is null and cursor_offset is null
    and context_hash is null and rewrite_instruction is null
  )
);

create function private.get_revision_proposal(
  requested_user_id uuid,
  requested_proposal_id uuid,
  requested_kind text
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', proposal.id, 'user_id', proposal.user_id,
    'essay_id', proposal.essay_id, 'kind', proposal.kind,
    'target_revision', proposal.target_revision,
    'proposed_content', proposal.proposed_content,
    'rationale', proposal.rationale, 'status', proposal.status,
    'selection_start', proposal.selection_start,
    'selection_end', proposal.selection_end,
    'selection_text_hash', proposal.selection_text_hash,
    'cursor_offset', proposal.cursor_offset,
    'context_hash', proposal.context_hash,
    'rewrite_instruction', proposal.rewrite_instruction,
    'created_at', proposal.created_at, 'expires_at', proposal.expires_at
  )
  from private.ai_proposals proposal
  where proposal.user_id = requested_user_id
    and proposal.id = requested_proposal_id
    and proposal.kind = requested_kind
    and requested_kind in ('REWRITE', 'CONTINUATION');
$$;

create function private.commit_revision_proposal(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_kind text,
  requested_target_revision integer,
  requested_operation_id uuid,
  requested_draft jsonb,
  requested_selection_start integer,
  requested_selection_end integer,
  requested_selection_text_hash text,
  requested_cursor_offset integer,
  requested_context_hash text,
  requested_rewrite_instruction text,
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
  expected_purpose text;
begin
  if requested_kind not in ('REWRITE', 'CONTINUATION')
    or jsonb_typeof(requested_draft) is distinct from 'object'
  then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;
  expected_purpose := case requested_kind
    when 'REWRITE' then 'REWRITE' else 'CONTINUATION' end;

  select * into current_proposal from private.ai_proposals
  where operation_id = requested_operation_id;
  if found then
    if current_proposal.user_id = requested_user_id
      and current_proposal.essay_id = requested_essay_id
      and current_proposal.kind = requested_kind
    then
      return jsonb_build_object(
        'decision', 'REPLAY',
        'proposal', private.get_revision_proposal(
          requested_user_id, current_proposal.id, requested_kind
        )
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
  if current_essay.dossier_id is null then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;
  if requested_kind = 'REWRITE' and (
    requested_selection_start is null or requested_selection_start < 0
    or requested_selection_end is null
    or requested_selection_end <= requested_selection_start
    or requested_selection_end > char_length(current_essay.draft_text)
    or requested_selection_text_hash is null
    or requested_selection_text_hash !~ '^[A-Za-z0-9_-]{43}$'
    or requested_rewrite_instruction is null
    or requested_rewrite_instruction not in (
      'CLARIFY', 'TIGHTEN', 'EXPAND', 'STRENGTHEN_EVIDENCE',
      'IMPROVE_TRANSITION', 'PRESERVE_VOICE', 'CUSTOM'
    )
    or requested_cursor_offset is not null or requested_context_hash is not null
    or jsonb_typeof(requested_draft -> 'claims') is distinct from 'array'
    or jsonb_array_length(requested_draft -> 'claims') > 10
    or coalesce(char_length(requested_draft ->> 'proposedText'), 0) not between 1 and 4000
    or coalesce(char_length(requested_draft ->> 'rationale'), 0) not between 1 and 1000
  ) then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;
  if requested_kind = 'REWRITE' and private.sha256_base64url(
    pg_catalog.substring(
      current_essay.draft_text,
      requested_selection_start + 1,
      requested_selection_end - requested_selection_start
    )
  ) <> requested_selection_text_hash then
    return jsonb_build_object('decision', 'REVISION_MISMATCH', 'proposal', null);
  end if;
  if requested_kind = 'CONTINUATION' and (
    requested_cursor_offset is null or requested_cursor_offset < 0
    or requested_cursor_offset > char_length(current_essay.draft_text)
    or requested_context_hash is null
    or requested_context_hash !~ '^[A-Za-z0-9_-]{43}$'
    or requested_selection_start is not null
    or requested_selection_end is not null
    or requested_selection_text_hash is not null
    or requested_rewrite_instruction is not null
    or jsonb_typeof(requested_draft -> 'suggestions') is distinct from 'array'
    or jsonb_array_length(requested_draft -> 'suggestions') not between 1 and 3
  ) then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;
  if requested_kind = 'CONTINUATION'
    and private.sha256_base64url(current_essay.draft_text) <> requested_context_hash
  then
    return jsonb_build_object('decision', 'REVISION_MISMATCH', 'proposal', null);
  end if;

  select * into current_operation from private.ai_operations
  where id = requested_operation_id and user_id = requested_user_id
    and essay_id = requested_essay_id and purpose = expected_purpose
    and status = 'STARTED' for update;
  if not found then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'proposal', null);
  end if;

  insert into private.ai_proposals (
    user_id, essay_id, operation_id, kind, target_revision,
    proposed_content, rationale, status, created_at, expires_at,
    selection_start, selection_end, selection_text_hash,
    cursor_offset, context_hash, rewrite_instruction
  ) values (
    requested_user_id, requested_essay_id, requested_operation_id,
    requested_kind, requested_target_revision, requested_draft,
    case when requested_kind = 'REWRITE'
      then requested_draft ->> 'rationale' else 'Continuation options' end,
    'PENDING', requested_at, requested_at + interval '24 hours',
    requested_selection_start, requested_selection_end,
    requested_selection_text_hash, requested_cursor_offset,
    requested_context_hash, requested_rewrite_instruction
  ) returning * into current_proposal;

  update private.ai_operations set
    status = 'SUCCEEDED', completed_at = requested_at,
    result_resource_type = requested_kind || '_PROPOSAL',
    result_resource_id = current_proposal.id,
    provider_request_id = requested_provider_request_id,
    model_id = requested_model_id, input_tokens = requested_input_tokens,
    output_tokens = requested_output_tokens, latency_ms = requested_latency_ms,
    final_cost_cents = requested_final_cost_cents, original_http_status = 201,
    safe_error_code = null, updated_at = requested_at
  where id = requested_operation_id;

  return jsonb_build_object(
    'decision', 'CREATED',
    'proposal', private.get_revision_proposal(
      requested_user_id, current_proposal.id, requested_kind
    )
  );
end;
$$;

revoke execute on function private.get_revision_proposal(uuid, uuid, text)
from public, anon, authenticated;
revoke execute on function private.commit_revision_proposal(
  uuid, uuid, text, integer, uuid, jsonb, integer, integer, text,
  integer, text, text, text, text, integer, integer, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function private.get_revision_proposal(uuid, uuid, text)
to service_role;
revoke execute on function private.sha256_base64url(text)
from public, anon, authenticated;
grant execute on function private.sha256_base64url(text) to service_role;
grant execute on function private.commit_revision_proposal(
  uuid, uuid, text, integer, uuid, jsonb, integer, integer, text,
  integer, text, text, text, text, integer, integer, integer, integer, timestamptz
) to service_role;
