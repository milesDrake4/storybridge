create table private.essay_audits (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid not null,
  essay_revision integer not null,
  issues jsonb not null,
  evidence_manifest_version text not null,
  similarity jsonb not null,
  status text not null,
  idempotency_key_hmac text not null,
  request_hmac text not null,
  created_at timestamptz not null default now(),
  constraint essay_audits_owner_essay_fk foreign key (user_id, essay_id)
    references public.essays (user_id, id) on delete cascade,
  constraint essay_audits_user_id_id_key unique (user_id, id),
  constraint essay_audits_revision_check check (essay_revision >= 0),
  constraint essay_audits_issues_check check (
    jsonb_typeof(issues) = 'array' and jsonb_array_length(issues) <= 100
  ),
  constraint essay_audits_manifest_check check (
    evidence_manifest_version ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint essay_audits_similarity_check check (
    jsonb_typeof(similarity) = 'object'
  ),
  constraint essay_audits_status_check check (status in ('PASS', 'BLOCKED')),
  constraint essay_audits_status_issues_check check (
    (status = 'BLOCKED') = pg_catalog.jsonb_path_exists(
      issues, '$[*] ? (@.severity == "BLOCKING")'
    )
  ),
  constraint essay_audits_idempotency_hmac_check check (
    idempotency_key_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint essay_audits_request_hmac_check check (
    request_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint essay_audits_user_idempotency_key unique (
    user_id, idempotency_key_hmac
  )
);

create index essay_audits_owner_essay_revision_idx
on private.essay_audits (
  user_id, essay_id, essay_revision desc, created_at desc, id desc
);

alter table private.essay_audits enable row level security;
revoke all on table private.essay_audits from public, anon, authenticated;
grant select, insert on table private.essay_audits to service_role;

create function private.get_unsupported_proposal_claims(
  requested_user_id uuid,
  requested_essay_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'text', claims.claim ->> 'text', 'evidence_ids', '[]'::jsonb
  ) order by claims.proposal_id, claims.position), '[]'::jsonb)
  from (
    select proposal.id as proposal_id, claim.ordinality as position,
      claim.value as claim
    from private.ai_proposals proposal
    cross join lateral jsonb_array_elements(
      coalesce(proposal.proposed_content -> 'claims', '[]'::jsonb)
    ) with ordinality claim
    where proposal.user_id = requested_user_id
      and proposal.essay_id = requested_essay_id
      and proposal.kind = 'REWRITE'
    union all
    select proposal.id, suggestion.ordinality * 100 + claim.ordinality,
      claim.value
    from private.ai_proposals proposal
    cross join lateral jsonb_array_elements(
      coalesce(proposal.proposed_content -> 'suggestions', '[]'::jsonb)
    ) with ordinality suggestion
    cross join lateral jsonb_array_elements(
      coalesce(suggestion.value -> 'claims', '[]'::jsonb)
    ) with ordinality claim
    where proposal.user_id = requested_user_id
      and proposal.essay_id = requested_essay_id
      and proposal.kind = 'CONTINUATION'
  ) claims
  where claims.claim ->> 'status' = 'BLOCKING_UNSUPPORTED'
    and coalesce(char_length(claims.claim ->> 'text'), 0) between 1 and 500;
$$;

create function private.current_audit_evidence_manifest(
  requested_user_id uuid,
  requested_essay_id uuid
)
returns text
language sql
stable
set search_path = ''
as $$
  select 'v1.' || private.sha256_base64url(jsonb_build_object(
    'dossier_id', essay.dossier_id,
    'outline', essay.outline,
    'facts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fact.id,
        'content_hmac', fact.content_hmac,
        'verification_status', fact.verification_status,
        'suppressed_at', fact.suppressed_at
      ) order by fact.id)
      from public.story_facts fact
      where fact.user_id = requested_user_id
        and fact.id::text in (
          select linked.value
          from jsonb_array_elements(
            coalesce(essay.outline -> 'sections', '[]'::jsonb)
          ) section
          cross join lateral jsonb_array_elements_text(
            coalesce(section.value -> 'storyFactIds', '[]'::jsonb)
          ) linked(value)
        )
    ), '[]'::jsonb),
    'school_sources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', source.id, 'dossier_id', source.dossier_id,
        'claim', source.claim
      ) order by source.id)
      from public.school_dossier_sources source
      where source.user_id = requested_user_id
        and source.id::text in (
          select linked.value
          from jsonb_array_elements(
            coalesce(essay.outline -> 'sections', '[]'::jsonb)
          ) section
          cross join lateral jsonb_array_elements_text(
            coalesce(section.value -> 'schoolSourceIds', '[]'::jsonb)
          ) linked(value)
        )
    ), '[]'::jsonb),
    'voice_profiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', profile.id, 'revision', profile.revision,
        'status', profile.status, 'voice_profile', profile.voice_profile
      ) order by profile.version, profile.id)
      from public.story_profiles profile
      where profile.user_id = requested_user_id
    ), '[]'::jsonb),
    'reference_drafts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', proposal.id, 'target_revision', proposal.target_revision,
        'proposed_content', proposal.proposed_content,
        'status', proposal.status
      ) order by proposal.created_at, proposal.id)
      from private.ai_proposals proposal
      where proposal.user_id = requested_user_id
        and proposal.essay_id = requested_essay_id
        and proposal.kind = 'REFERENCE_DRAFT'
    ), '[]'::jsonb),
    'reference_claims', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', claim.id, 'content_hmac', claim.content_hmac,
        'decision', confirmation.decision,
        'confirmed_content_hmac', confirmation.claim_content_hmac
      ) order by claim.position, claim.id)
      from private.ai_proposals proposal
      join private.proposal_claims claim
        on claim.user_id = proposal.user_id
        and claim.essay_id = proposal.essay_id
        and claim.proposal_id = proposal.id
      left join private.essay_claim_confirmations confirmation
        on confirmation.user_id = claim.user_id
        and confirmation.essay_id = claim.essay_id
        and confirmation.proposal_claim_id = claim.id
      where proposal.user_id = requested_user_id
        and proposal.essay_id = requested_essay_id
        and proposal.kind = 'REFERENCE_DRAFT'
    ), '[]'::jsonb),
    'unsupported_claims', private.get_unsupported_proposal_claims(
      requested_user_id, requested_essay_id
    )
  )::text)
  from public.essays essay
  where essay.user_id = requested_user_id and essay.id = requested_essay_id;
$$;

create function private.get_essay_audit_context(
  requested_user_id uuid,
  requested_essay_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'essay', jsonb_build_object(
      'id', essay.id, 'draft_text', essay.draft_text,
      'prompt', essay.prompt, 'revision', essay.revision,
      'word_limit', essay.word_limit
    ),
    'evidence_manifest_version', private.current_audit_evidence_manifest(
      requested_user_id, requested_essay_id
    ),
    'has_voice_profile', exists (
      select 1 from public.story_profiles profile
      where profile.user_id = requested_user_id
        and profile.status in ('REVIEW_REQUIRED', 'ACTIVE')
    ),
    'story_fact_ids', coalesce((
      select jsonb_agg(linked.value order by linked.value)
      from (
        select distinct evidence.value
        from jsonb_array_elements(
          coalesce(essay.outline -> 'sections', '[]'::jsonb)
        ) section
        cross join lateral jsonb_array_elements_text(
          coalesce(section.value -> 'storyFactIds', '[]'::jsonb)
        ) evidence(value)
      ) linked
      join public.story_facts fact
        on fact.user_id = requested_user_id
        and fact.id::text = linked.value
        and fact.verification_status = 'VERIFIED'
        and fact.suppressed_at is null
    ), '[]'::jsonb),
    'school_source_ids', coalesce((
      select jsonb_agg(linked.value order by linked.value)
      from (
        select distinct evidence.value
        from jsonb_array_elements(
          coalesce(essay.outline -> 'sections', '[]'::jsonb)
        ) section
        cross join lateral jsonb_array_elements_text(
          coalesce(section.value -> 'schoolSourceIds', '[]'::jsonb)
        ) evidence(value)
      ) linked
      join public.school_dossier_sources source
        on source.user_id = requested_user_id
        and source.id::text = linked.value
        and source.dossier_id = essay.dossier_id
    ), '[]'::jsonb),
    'invalid_evidence_ids', coalesce((
      select jsonb_agg(all_evidence.value order by all_evidence.value)
      from (
        select distinct evidence.value, 'FACT' as kind
        from jsonb_array_elements(
          coalesce(essay.outline -> 'sections', '[]'::jsonb)
        ) section
        cross join lateral jsonb_array_elements_text(
          coalesce(section.value -> 'storyFactIds', '[]'::jsonb)
        ) evidence(value)
        union
        select distinct evidence.value, 'SOURCE'
        from jsonb_array_elements(
          coalesce(essay.outline -> 'sections', '[]'::jsonb)
        ) section
        cross join lateral jsonb_array_elements_text(
          coalesce(section.value -> 'schoolSourceIds', '[]'::jsonb)
        ) evidence(value)
      ) all_evidence
      where (
        all_evidence.kind = 'FACT' and not exists (
          select 1 from public.story_facts fact
          where fact.user_id = requested_user_id
            and fact.id::text = all_evidence.value
            and fact.verification_status = 'VERIFIED'
            and fact.suppressed_at is null
        )
      ) or (
        all_evidence.kind = 'SOURCE' and not exists (
          select 1 from public.school_dossier_sources source
          where source.user_id = requested_user_id
            and source.id::text = all_evidence.value
            and source.dossier_id = essay.dossier_id
        )
      )
    ), '[]'::jsonb),
    'reference_draft', (
      select jsonb_build_object(
        'reference_text', proposal.proposed_content ->> 'referenceText',
        'claims', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', claim.id, 'text', claim.claim_text,
            'decision', confirmation.decision
          ) order by claim.position)
          from private.proposal_claims claim
          left join private.essay_claim_confirmations confirmation
            on confirmation.user_id = claim.user_id
            and confirmation.essay_id = claim.essay_id
            and confirmation.proposal_claim_id = claim.id
          where claim.user_id = proposal.user_id
            and claim.essay_id = proposal.essay_id
            and claim.proposal_id = proposal.id
        ), '[]'::jsonb)
      )
      from private.ai_proposals proposal
      where proposal.user_id = requested_user_id
        and proposal.essay_id = requested_essay_id
        and proposal.kind = 'REFERENCE_DRAFT'
      order by proposal.created_at desc, proposal.id desc
      limit 1
    ),
    'unsupported_claims', private.get_unsupported_proposal_claims(
      requested_user_id, requested_essay_id
    )
  )
  from public.essays essay
  where essay.user_id = requested_user_id and essay.id = requested_essay_id;
$$;

create function private.get_essay_audit(
  requested_user_id uuid,
  requested_audit_id uuid
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', audit.id, 'user_id', audit.user_id, 'essay_id', audit.essay_id,
    'essay_revision', audit.essay_revision, 'issues', audit.issues,
    'evidence_manifest_version', audit.evidence_manifest_version,
    'similarity', audit.similarity, 'status', audit.status,
    'created_at', audit.created_at
  )
  from private.essay_audits audit
  where audit.user_id = requested_user_id and audit.id = requested_audit_id;
$$;

create function private.commit_essay_audit(
  requested_user_id uuid,
  requested_audit_id uuid,
  requested_essay_id uuid,
  requested_essay_revision integer,
  requested_expected_draft_text text,
  requested_evidence_manifest_version text,
  requested_issues jsonb,
  requested_similarity jsonb,
  requested_status text,
  requested_idempotency_key_hmac text,
  requested_request_hmac text,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_audit private.essay_audits%rowtype;
  current_essay public.essays%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'storybridge:essay-audit:' || requested_user_id::text || ':' ||
      requested_idempotency_key_hmac,
      0
    )
  );
  select * into current_audit
  from private.essay_audits
  where user_id = requested_user_id
    and idempotency_key_hmac = requested_idempotency_key_hmac;
  if found then
    if current_audit.request_hmac <> requested_request_hmac then
      return jsonb_build_object(
        'decision', 'IDEMPOTENCY_KEY_REUSED', 'audit', null
      );
    end if;
    return jsonb_build_object(
      'decision', 'REPLAY',
      'audit', private.get_essay_audit(requested_user_id, current_audit.id)
    );
  end if;

  select * into current_essay from public.essays
  where user_id = requested_user_id and id = requested_essay_id
  for update;
  if not found then
    return jsonb_build_object('decision', 'NOT_FOUND', 'audit', null);
  end if;
  if current_essay.revision <> requested_essay_revision
    or current_essay.draft_text <> requested_expected_draft_text
  then
    return jsonb_build_object(
      'decision', 'REVISION_MISMATCH', 'audit', null
    );
  end if;

  perform 1 from public.story_facts fact
  where fact.user_id = requested_user_id
    and fact.id::text in (
      select linked.value
      from jsonb_array_elements(
        coalesce(current_essay.outline -> 'sections', '[]'::jsonb)
      ) section
      cross join lateral jsonb_array_elements_text(
        coalesce(section.value -> 'storyFactIds', '[]'::jsonb)
      ) linked(value)
    )
  for update;
  perform 1 from public.story_profiles profile
  where profile.user_id = requested_user_id
  for update;
  perform 1 from public.school_dossier_sources source
  where source.user_id = requested_user_id
    and source.id::text in (
      select linked.value
      from jsonb_array_elements(
        coalesce(current_essay.outline -> 'sections', '[]'::jsonb)
      ) section
      cross join lateral jsonb_array_elements_text(
        coalesce(section.value -> 'schoolSourceIds', '[]'::jsonb)
      ) linked(value)
    )
  for update;
  perform 1 from private.proposal_claims claim
  where claim.user_id = requested_user_id
    and claim.essay_id = requested_essay_id
  for update;
  perform 1 from private.ai_proposals proposal
  where proposal.user_id = requested_user_id
    and proposal.essay_id = requested_essay_id
  for update;

  if private.current_audit_evidence_manifest(
    requested_user_id, requested_essay_id
  ) is distinct from requested_evidence_manifest_version then
    return jsonb_build_object(
      'decision', 'MANIFEST_MISMATCH', 'audit', null
    );
  end if;

  insert into private.essay_audits (
    id, user_id, essay_id, essay_revision, issues,
    evidence_manifest_version, similarity, status,
    idempotency_key_hmac, request_hmac, created_at
  ) values (
    requested_audit_id, requested_user_id, requested_essay_id,
    requested_essay_revision, requested_issues,
    requested_evidence_manifest_version, requested_similarity,
    requested_status, requested_idempotency_key_hmac,
    requested_request_hmac, requested_at
  ) returning * into current_audit;

  return jsonb_build_object(
    'decision', 'CREATED',
    'audit', private.get_essay_audit(requested_user_id, current_audit.id)
  );
exception when check_violation or unique_violation then
  return jsonb_build_object('decision', 'MANIFEST_MISMATCH', 'audit', null);
end;
$$;

revoke execute on function private.get_unsupported_proposal_claims(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.current_audit_evidence_manifest(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.get_essay_audit_context(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.get_essay_audit(uuid, uuid)
from public, anon, authenticated;
revoke execute on function private.commit_essay_audit(
  uuid, uuid, uuid, integer, text, text, jsonb, jsonb, text,
  text, text, timestamptz
) from public, anon, authenticated;

grant execute on function private.get_essay_audit_context(uuid, uuid)
to service_role;
grant execute on function private.get_essay_audit(uuid, uuid)
to service_role;
grant execute on function private.get_unsupported_proposal_claims(uuid, uuid)
to service_role;
grant execute on function private.current_audit_evidence_manifest(uuid, uuid)
to service_role;
grant execute on function private.commit_essay_audit(
  uuid, uuid, uuid, integer, text, text, jsonb, jsonb, text,
  text, text, timestamptz
) to service_role;
