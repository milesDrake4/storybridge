create table private.essay_claim_confirmations (
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  proposal_claim_id uuid not null,
  claim_content_hmac text not null,
  decision text not null,
  idempotency_key_hmac text not null,
  request_hmac text not null,
  decided_at timestamptz not null default now(),
  primary key (user_id, essay_id, proposal_claim_id),
  constraint essay_claim_confirmations_claim_fk foreign key (
    user_id, essay_id, proposal_claim_id
  ) references private.proposal_claims (user_id, essay_id, id) on delete cascade,
  constraint essay_claim_confirmations_decision_check check (
    decision in ('CONFIRMED', 'REJECTED')
  ),
  constraint essay_claim_confirmations_content_hmac_check check (
    claim_content_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint essay_claim_confirmations_idempotency_hmac_check check (
    idempotency_key_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint essay_claim_confirmations_request_hmac_check check (
    request_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint essay_claim_confirmations_user_key unique (user_id, idempotency_key_hmac)
);

create index essay_claim_confirmations_owner_essay_idx
on private.essay_claim_confirmations (user_id, essay_id, decided_at, proposal_claim_id);

alter table private.essay_claim_confirmations enable row level security;
revoke all on table private.essay_claim_confirmations from public, anon, authenticated;
grant select, insert on table private.essay_claim_confirmations to service_role;

create function private.get_claim_confirmation(
  requested_user_id uuid,
  requested_claim_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', confirmation.user_id,
    'essay_id', confirmation.essay_id,
    'claim_id', confirmation.proposal_claim_id,
    'claim_content_hmac', confirmation.claim_content_hmac,
    'decision', confirmation.decision,
    'decided_at', confirmation.decided_at
  )
  from private.essay_claim_confirmations confirmation
  where confirmation.user_id = requested_user_id
    and confirmation.proposal_claim_id = requested_claim_id;
$$;

create function private.decide_reference_claim(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_claim_id uuid,
  requested_decision text,
  requested_idempotency_key_hmac text,
  requested_request_hmac text,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_claim private.proposal_claims%rowtype;
  current_confirmation private.essay_claim_confirmations%rowtype;
begin
  if requested_decision not in ('CONFIRM', 'REJECT')
    or requested_idempotency_key_hmac !~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
    or requested_request_hmac !~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  then
    raise exception using errcode = '22023', message = 'invalid claim decision';
  end if;

  select * into current_confirmation
  from private.essay_claim_confirmations
  where user_id = requested_user_id
    and idempotency_key_hmac = requested_idempotency_key_hmac
  for update;
  if found then
    if current_confirmation.request_hmac <> requested_request_hmac then
      return jsonb_build_object(
        'decision', 'IDEMPOTENCY_KEY_REUSED', 'confirmation', null
      );
    end if;
    return jsonb_build_object(
      'decision', 'REPLAY',
      'confirmation', private.get_claim_confirmation(
        requested_user_id, current_confirmation.proposal_claim_id
      )
    );
  end if;

  select claim.* into current_claim
  from private.proposal_claims claim
  join private.ai_proposals proposal
    on proposal.user_id = claim.user_id
    and proposal.essay_id = claim.essay_id
    and proposal.id = claim.proposal_id
  where claim.user_id = requested_user_id
    and claim.essay_id = requested_essay_id
    and claim.id = requested_claim_id
    and claim.status = 'SUPPORTED'
    and proposal.kind = 'REFERENCE_DRAFT'
  for update of claim;
  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND', 'confirmation', null);
  end if;

  perform 1 from private.essay_claim_confirmations
  where user_id = requested_user_id
    and essay_id = requested_essay_id
    and proposal_claim_id = requested_claim_id;
  if found then
    return jsonb_build_object('decision', 'STATE_CONFLICT', 'confirmation', null);
  end if;

  insert into private.essay_claim_confirmations (
    user_id, essay_id, proposal_claim_id, claim_content_hmac,
    decision, idempotency_key_hmac, request_hmac, decided_at
  ) values (
    requested_user_id, requested_essay_id, requested_claim_id,
    current_claim.content_hmac,
    case requested_decision when 'CONFIRM' then 'CONFIRMED' else 'REJECTED' end,
    requested_idempotency_key_hmac, requested_request_hmac, requested_at
  );

  return jsonb_build_object(
    'decision', 'DECIDED',
    'confirmation', private.get_claim_confirmation(
      requested_user_id, requested_claim_id
    )
  );
end;
$$;

create or replace function private.get_essay_workspace(
  requested_user_id uuid,
  requested_essay_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'essay', to_jsonb(essays),
    'school', jsonb_build_object(
      'id', schools.id,
      'canonical_name', schools.canonical_name,
      'official_domain', schools.official_domain
    ),
    'reference_draft', (
      select private.get_reference_draft_proposal(requested_user_id, proposal.id)
      from private.ai_proposals proposal
      where proposal.user_id = requested_user_id
        and proposal.essay_id = requested_essay_id
        and proposal.kind = 'REFERENCE_DRAFT'
      order by proposal.created_at desc, proposal.id desc
      limit 1
    ),
    'claim_confirmations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'claim_id', confirmation.proposal_claim_id,
        'decision', confirmation.decision,
        'decided_at', confirmation.decided_at
      ) order by confirmation.decided_at, confirmation.proposal_claim_id)
      from private.essay_claim_confirmations confirmation
      where confirmation.user_id = requested_user_id
        and confirmation.essay_id = requested_essay_id
    ), '[]'::jsonb)
  )
  from public.essays essays
  join private.schools schools on schools.id = essays.school_id
  where essays.user_id = requested_user_id and essays.id = requested_essay_id;
$$;

revoke execute on function private.get_claim_confirmation(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.decide_reference_claim(
  uuid, uuid, uuid, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function private.get_claim_confirmation(uuid, uuid) to service_role;
grant execute on function private.decide_reference_claim(
  uuid, uuid, uuid, text, text, text, timestamptz
) to service_role;
