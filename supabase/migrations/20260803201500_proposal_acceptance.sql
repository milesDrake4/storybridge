create table private.proposal_acceptance_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  proposal_id uuid not null unique,
  idempotency_key_hmac text not null,
  request_hmac text not null,
  accepted_revision integer not null,
  created_at timestamptz not null default now(),
  constraint proposal_acceptance_owner_essay_fk foreign key (user_id, essay_id)
    references public.essays (user_id, id) on delete cascade,
  constraint proposal_acceptance_owner_proposal_fk
    foreign key (user_id, essay_id, proposal_id)
    references private.ai_proposals (user_id, essay_id, id) on delete cascade,
  constraint proposal_acceptance_idempotency_hmac_check check (
    idempotency_key_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint proposal_acceptance_request_hmac_check check (
    request_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint proposal_acceptance_revision_check check (accepted_revision > 0),
  constraint proposal_acceptance_user_idempotency_key unique (
    user_id, idempotency_key_hmac
  )
);

alter table private.proposal_acceptance_transactions enable row level security;
revoke all on table private.proposal_acceptance_transactions
from public, anon, authenticated;
grant select, insert on table private.proposal_acceptance_transactions
to service_role;

create function private.find_proposal_acceptance_replay(
  requested_user_id uuid,
  requested_idempotency_key_hmac text,
  requested_request_hmac text
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  current_transaction private.proposal_acceptance_transactions%rowtype;
  current_essay public.essays%rowtype;
begin
  select * into current_transaction
  from private.proposal_acceptance_transactions
  where user_id = requested_user_id
    and idempotency_key_hmac = requested_idempotency_key_hmac;
  if not found then return null; end if;
  if current_transaction.request_hmac <> requested_request_hmac then
    return jsonb_build_object(
      'decision', 'IDEMPOTENCY_KEY_REUSED', 'essay', null
    );
  end if;
  select * into current_essay from public.essays
  where user_id = requested_user_id and id = current_transaction.essay_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'decision', 'REPLAY', 'essay', to_jsonb(current_essay)
  );
end;
$$;

create function private.accept_revision_proposal(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_proposal_id uuid,
  requested_expected_revision integer,
  requested_expected_current_draft text,
  requested_next_draft text,
  requested_idempotency_key_hmac text,
  requested_request_hmac text,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  claim jsonb;
  computed_next_draft text;
  current_essay public.essays%rowtype;
  current_proposal private.ai_proposals%rowtype;
  evidence_id text;
  following_text text;
  preceding_text text;
  proposal_text text;
  replay jsonb;
  save_result jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'storybridge:proposal-acceptance:' || requested_user_id::text || ':' ||
      requested_idempotency_key_hmac,
      0
    )
  );
  replay := private.find_proposal_acceptance_replay(
    requested_user_id, requested_idempotency_key_hmac, requested_request_hmac
  );
  if replay is not null then return replay; end if;

  select * into current_essay from public.essays
  where user_id = requested_user_id and id = requested_essay_id for update;
  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND', 'essay', null);
  end if;
  if current_essay.revision <> requested_expected_revision
    or current_essay.draft_text <> requested_expected_current_draft
  then
    return jsonb_build_object('decision', 'REVISION_MISMATCH', 'essay', null);
  end if;

  select * into current_proposal from private.ai_proposals
  where user_id = requested_user_id and essay_id = requested_essay_id
    and id = requested_proposal_id for update;
  if not found then
    return jsonb_build_object(
      'decision', 'PROPOSAL_NOT_ACCEPTABLE', 'essay', null
    );
  end if;
  if current_proposal.kind not in ('REWRITE', 'CONTINUATION')
    or current_proposal.status <> 'PENDING'
    or current_proposal.target_revision <> requested_expected_revision
    or current_proposal.expires_at <= requested_at
  then
    return jsonb_build_object(
      'decision', 'PROPOSAL_NOT_ACCEPTABLE', 'essay', null
    );
  end if;

  if current_proposal.kind = 'REWRITE' then
    if current_proposal.selection_end > char_length(current_essay.draft_text)
      or private.sha256_base64url(
        pg_catalog.substring(
          current_essay.draft_text,
          current_proposal.selection_start + 1,
          current_proposal.selection_end - current_proposal.selection_start
        )
      ) <> current_proposal.selection_text_hash
    then
      return jsonb_build_object(
        'decision', 'PROPOSAL_NOT_ACCEPTABLE', 'essay', null
      );
    end if;
    computed_next_draft :=
      pg_catalog.substring(
        current_essay.draft_text, 1, current_proposal.selection_start
      ) || (current_proposal.proposed_content ->> 'proposedText') ||
      pg_catalog.substring(
        current_essay.draft_text, current_proposal.selection_end + 1
      );
  else
    if current_proposal.cursor_offset > char_length(current_essay.draft_text)
      or private.sha256_base64url(current_essay.draft_text)
        <> current_proposal.context_hash
    then
      return jsonb_build_object(
        'decision', 'PROPOSAL_NOT_ACCEPTABLE', 'essay', null
      );
    end if;
    select pg_catalog.string_agg(value ->> 'proposedText', E'\n\n' order by ordinality)
      into proposal_text
    from jsonb_array_elements(
      current_proposal.proposed_content -> 'suggestions'
    ) with ordinality;
    preceding_text := pg_catalog.substring(
      current_essay.draft_text, 1, current_proposal.cursor_offset
    );
    following_text := pg_catalog.substring(
      current_essay.draft_text, current_proposal.cursor_offset + 1
    );
    computed_next_draft := preceding_text ||
      case when preceding_text <> '' and preceding_text !~ E'[ \n]$'
        then ' ' else '' end ||
      proposal_text ||
      case when following_text <> ''
        and following_text !~ E'^[ \n,.;:!?)]'
        then ' ' else '' end ||
      following_text;
  end if;
  if computed_next_draft is distinct from requested_next_draft then
    return jsonb_build_object(
      'decision', 'PROPOSAL_NOT_ACCEPTABLE', 'essay', null
    );
  end if;

  for claim in
    select value from jsonb_array_elements(
      case when current_proposal.kind = 'REWRITE'
        then current_proposal.proposed_content -> 'claims'
        else (
          select coalesce(jsonb_agg(claim_value.value), '[]'::jsonb)
          from jsonb_array_elements(
            current_proposal.proposed_content -> 'suggestions'
          ) as suggestion(value)
          cross join lateral jsonb_array_elements(
            suggestion.value -> 'claims'
          ) as claim_value(value)
        )
      end
    )
  loop
    if claim ->> 'status' <> 'SUPPORTED'
      or jsonb_typeof(claim -> 'storyFactIds') is distinct from 'array'
      or jsonb_typeof(claim -> 'schoolSourceIds') is distinct from 'array'
    then
      return jsonb_build_object(
        'decision', 'PROPOSAL_NOT_ACCEPTABLE', 'essay', null
      );
    end if;
    if jsonb_array_length(claim -> 'storyFactIds')
      + jsonb_array_length(claim -> 'schoolSourceIds') < 1
    then
      return jsonb_build_object(
        'decision', 'PROPOSAL_NOT_ACCEPTABLE', 'essay', null
      );
    end if;
    for evidence_id in
      select value #>> '{}' from jsonb_array_elements(claim -> 'storyFactIds')
    loop
      if not exists (
        select 1 from public.story_facts fact
        join public.story_profiles profile
          on profile.user_id = fact.user_id and profile.id = fact.profile_id
        where fact.user_id = requested_user_id
          and fact.id::text = evidence_id
          and fact.verification_status = 'VERIFIED'
          and fact.suppressed_at is null
          and profile.status = 'ACTIVE'
      ) then
        return jsonb_build_object(
          'decision', 'PROPOSAL_NOT_ACCEPTABLE', 'essay', null
        );
      end if;
    end loop;
    for evidence_id in
      select value #>> '{}' from jsonb_array_elements(claim -> 'schoolSourceIds')
    loop
      if not exists (
        select 1 from public.school_dossier_sources source
        where source.user_id = requested_user_id
          and source.dossier_id = current_essay.dossier_id
          and source.id::text = evidence_id
      ) then
        return jsonb_build_object(
          'decision', 'PROPOSAL_NOT_ACCEPTABLE', 'essay', null
        );
      end if;
    end loop;
  end loop;

  save_result := private.save_essay_draft(
    requested_user_id, requested_essay_id, requested_expected_revision,
    requested_next_draft, null, null, 'ACCEPTED_PROPOSAL',
    requested_proposal_id, requested_at
  );
  if save_result ->> 'decision' <> 'UPDATED' then
    return jsonb_build_object(
      'decision', 'STATE_CONFLICT', 'essay', null
    );
  end if;

  update private.ai_proposals set status = 'ACCEPTED', accepted_at = requested_at
  where user_id = requested_user_id and essay_id = requested_essay_id
    and id = requested_proposal_id;
  insert into private.proposal_acceptance_transactions (
    user_id, essay_id, proposal_id, idempotency_key_hmac,
    request_hmac, accepted_revision, created_at
  ) values (
    requested_user_id, requested_essay_id, requested_proposal_id,
    requested_idempotency_key_hmac, requested_request_hmac,
    requested_expected_revision + 1, requested_at
  );
  return jsonb_build_object(
    'decision', 'ACCEPTED', 'essay', save_result -> 'essay'
  );
end;
$$;

revoke execute on function private.find_proposal_acceptance_replay(
  uuid, text, text
) from public, anon, authenticated;
revoke execute on function private.accept_revision_proposal(
  uuid, uuid, uuid, integer, text, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function private.find_proposal_acceptance_replay(
  uuid, text, text
) to service_role;
grant execute on function private.accept_revision_proposal(
  uuid, uuid, uuid, integer, text, text, text, text, timestamptz
) to service_role;
