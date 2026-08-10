alter table private.account_deletions
add column deletion_idempotency_key_hmac text,
add column processing_started_at timestamptz,
add column attempt_count smallint not null default 0,
add constraint account_deletions_idempotency_hmac_check check (
  deletion_idempotency_key_hmac is null
  or deletion_idempotency_key_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
),
add constraint account_deletions_processing_check check (
  (status = 'PROCESSING' and processing_started_at is not null)
  or (status <> 'PROCESSING')
),
add constraint account_deletions_attempt_count_check check (
  attempt_count between 0 and 5
);

create unique index account_deletions_user_idempotency_idx
on private.account_deletions (user_id, deletion_idempotency_key_hmac)
where user_id is not null and deletion_idempotency_key_hmac is not null;

create unique index account_deletions_active_user_idx
on private.account_deletions (user_id)
where user_id is not null and status in ('QUEUED', 'PROCESSING');

drop index private.account_deletions_work_queue_idx;
create index account_deletions_work_queue_idx
on private.account_deletions (
  status, processing_started_at, requested_at, id
)
where status in ('QUEUED', 'PROCESSING');

create function private.queue_account_deletion(
  requested_user_id uuid,
  requested_user_id_hmac text,
  requested_status_token_hmac text,
  requested_idempotency_key_hmac text,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_deletion private.account_deletions%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'storybridge:account-deletion:' || requested_user_id::text,
      0
    )
  );

  select * into current_deletion
  from private.account_deletions
  where user_id = requested_user_id
    and deletion_idempotency_key_hmac = requested_idempotency_key_hmac
  order by requested_at desc, id desc
  limit 1
  for update;

  if found then
    if current_deletion.user_id_hmac = requested_user_id_hmac
      and current_deletion.deletion_status_token_hmac = requested_status_token_hmac
    then
      return jsonb_build_object(
        'decision', 'REPLAY',
        'deletion_id', current_deletion.id,
        'requested_at', current_deletion.requested_at
      );
    end if;
    return jsonb_build_object('decision', 'CONFLICT');
  end if;

  perform 1
  from private.account_deletions
  where user_id = requested_user_id
    and status in ('QUEUED', 'PROCESSING')
  for update;
  if found then
    return jsonb_build_object('decision', 'CONFLICT');
  end if;

  insert into private.account_deletions (
    user_id, user_id_hmac, status, deletion_status_token_hmac,
    deletion_idempotency_key_hmac, requested_at, expires_at,
    created_at, updated_at
  ) values (
    requested_user_id, requested_user_id_hmac, 'QUEUED',
    requested_status_token_hmac, requested_idempotency_key_hmac,
    requested_at, requested_at + interval '30 days', requested_at, requested_at
  ) returning * into current_deletion;

  return jsonb_build_object(
    'decision', 'QUEUED',
    'deletion_id', current_deletion.id,
    'requested_at', current_deletion.requested_at
  );
end;
$$;

create function private.get_account_deletion_status(
  requested_status_token_hmac text,
  requested_status_at timestamptz default now()
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'deletion_id', id,
    'status', status,
    'requested_at', account_deletions.requested_at,
    'completed_at', completed_at
  )
  from private.account_deletions account_deletions
  where account_deletions.deletion_status_token_hmac = requested_status_token_hmac
    and account_deletions.expires_at > requested_status_at;
$$;

create function private.claim_next_account_deletion(
  requested_claimed_at timestamptz default now()
)
returns jsonb
language sql
set search_path = ''
as $$
  with next_deletion as (
    select id
    from private.account_deletions account_deletions
    where (
        account_deletions.status = 'QUEUED'
        and account_deletions.attempt_count < 5
      )
      or (
        account_deletions.status = 'PROCESSING'
        and account_deletions.processing_started_at
          <= requested_claimed_at - interval '5 minutes'
      )
    order by account_deletions.requested_at, account_deletions.id
    limit 1
    for update skip locked
  ),
  claimed as (
    update private.account_deletions
    set status = 'PROCESSING',
        processing_started_at = requested_claimed_at,
        attempt_count = least(account_deletions.attempt_count + 1, 5)
    where id = (select id from next_deletion)
    returning id, user_id, user_id_hmac, status, attempt_count
  )
  select jsonb_build_object(
    'deletion_id', id,
    'user_id', user_id,
    'user_id_hmac', user_id_hmac,
    'status', status,
    'attempt_count', attempt_count
  )
  from claimed;
$$;

create function private.prepare_account_deletion(requested_deletion_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  deletion_user_id uuid;
begin
  select user_id into deletion_user_id
  from private.account_deletions
  where id = requested_deletion_id and status = 'PROCESSING'
  for update;
  if not found then return false; end if;
  if deletion_user_id is null then return true; end if;

  delete from private.beta_invitations
  where accepted_user_id = deletion_user_id;

  delete from private.entitlements where user_id = deletion_user_id;
  delete from private.checkout_sessions where user_id = deletion_user_id;
  delete from public.essays where user_id = deletion_user_id;
  delete from public.interview_sessions where user_id = deletion_user_id;
  delete from public.school_requests where user_id = deletion_user_id;
  delete from private.ai_operations where user_id = deletion_user_id;
  delete from public.profiles where user_id = deletion_user_id;
  return true;
end;
$$;

create function private.complete_account_deletion(
  requested_deletion_id uuid,
  requested_completed_at timestamptz default now()
)
returns boolean
language sql
set search_path = ''
as $$
  with completed as (
    update private.account_deletions
    set status = 'COMPLETE', completed_at = requested_completed_at,
        expires_at = requested_completed_at + interval '30 days',
        safe_failure_code = null
    where id = requested_deletion_id
      and status = 'PROCESSING'
      and user_id is null
    returning id
  )
  select exists(select 1 from completed);
$$;

create function private.fail_account_deletion(
  requested_deletion_id uuid,
  requested_safe_failure_code text,
  requested_failed_at timestamptz default now()
)
returns boolean
language sql
set search_path = ''
as $$
  with failed as (
    update private.account_deletions
    set status = 'FAILED', completed_at = requested_failed_at,
        expires_at = requested_failed_at + interval '30 days',
        safe_failure_code = requested_safe_failure_code
    where id = requested_deletion_id
      and status = 'PROCESSING'
      and user_id is not null
      and char_length(requested_safe_failure_code) between 1 and 100
    returning id
  )
  select exists(select 1 from failed);
$$;

create function private.get_account_export(
  requested_user_id uuid,
  requested_max_bytes integer default 5242880,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  account_export jsonb;
begin
  if requested_max_bytes not between 1024 and 5242880 then
    raise exception using errcode = '22023', message = 'invalid export size';
  end if;

  select jsonb_build_object(
    'schemaVersion', '2026-08-10',
    'exportedAt', requested_at,
    'profile', (
      select to_jsonb(profile)
      from public.profiles profile
      where profile.user_id = requested_user_id
    ),
    'data', jsonb_build_object(
      'interviewSessions', coalesce((
        select jsonb_agg(to_jsonb(session) - 'user_id' order by session.created_at, session.id)
        from public.interview_sessions session
        where session.user_id = requested_user_id
      ), '[]'::jsonb),
      'interviewMessages', coalesce((
        select jsonb_agg(to_jsonb(message) - 'user_id' order by message.created_at, message.id)
        from public.interview_messages message
        where message.user_id = requested_user_id
      ), '[]'::jsonb),
      'storyProfiles', coalesce((
        select jsonb_agg(to_jsonb(profile) - 'user_id' order by profile.version, profile.id)
        from public.story_profiles profile
        where profile.user_id = requested_user_id
      ), '[]'::jsonb),
      'storyFacts', coalesce((
        select jsonb_agg(
          to_jsonb(fact) - array['user_id', 'content_hmac']
          order by fact.created_at, fact.id
        )
        from public.story_facts fact
        where fact.user_id = requested_user_id
      ), '[]'::jsonb),
      'storyFactSources', coalesce((
        select jsonb_agg(to_jsonb(source) - 'user_id' order by source.fact_id, source.message_id)
        from public.story_fact_sources source
        where source.user_id = requested_user_id
      ), '[]'::jsonb),
      'schoolRequests', coalesce((
        select jsonb_agg(to_jsonb(request) - 'user_id' order by request.created_at, request.id)
        from public.school_requests request
        where request.user_id = requested_user_id
      ), '[]'::jsonb),
      'essays', coalesce((
        select jsonb_agg(to_jsonb(essay) - 'user_id' order by essay.created_at, essay.id)
        from public.essays essay
        where essay.user_id = requested_user_id
      ), '[]'::jsonb),
      'essayVersions', coalesce((
        select jsonb_agg(to_jsonb(version) - 'user_id' order by version.created_at, version.id)
        from public.essay_versions version
        where version.user_id = requested_user_id
      ), '[]'::jsonb),
      'essayAngles', coalesce((
        select jsonb_agg(
          to_jsonb(angle) - array['user_id', 'operation_id']
          order by angle.created_at, angle.id
        )
        from public.essay_angles angle
        where angle.user_id = requested_user_id
      ), '[]'::jsonb),
      'angleStoryFacts', coalesce((
        select jsonb_agg(to_jsonb(link) - 'user_id' order by link.angle_id, link.story_fact_id)
        from public.angle_story_facts link
        where link.user_id = requested_user_id
      ), '[]'::jsonb),
      'angleSchoolSources', coalesce((
        select jsonb_agg(to_jsonb(link) - 'user_id' order by link.angle_id, link.school_source_id)
        from public.angle_school_sources link
        where link.user_id = requested_user_id
      ), '[]'::jsonb),
      'schoolDossiers', coalesce((
        select jsonb_agg(
          to_jsonb(dossier) - array['user_id', 'operation_id']
          order by dossier.created_at, dossier.id
        )
        from public.school_dossiers dossier
        where dossier.user_id = requested_user_id
      ), '[]'::jsonb),
      'schoolDossierSources', coalesce((
        select jsonb_agg(to_jsonb(source) - 'user_id' order by source.created_at, source.id)
        from public.school_dossier_sources source
        where source.user_id = requested_user_id
      ), '[]'::jsonb),
      'coachingProposals', coalesce((
        select jsonb_agg(
          to_jsonb(proposal) - array['user_id', 'operation_id']
          order by proposal.created_at, proposal.id
        )
        from private.ai_proposals proposal
        where proposal.user_id = requested_user_id
      ), '[]'::jsonb),
      'proposalClaims', coalesce((
        select jsonb_agg(
          to_jsonb(claim) - array['user_id', 'content_hmac']
          order by claim.created_at, claim.id
        )
        from private.proposal_claims claim
        where claim.user_id = requested_user_id
      ), '[]'::jsonb),
      'claimDecisions', coalesce((
        select jsonb_agg(
          to_jsonb(decision) - array[
            'user_id', 'claim_content_hmac', 'idempotency_key_hmac', 'request_hmac'
          ]
          order by decision.decided_at, decision.proposal_claim_id
        )
        from private.essay_claim_confirmations decision
        where decision.user_id = requested_user_id
      ), '[]'::jsonb),
      'essayAudits', coalesce((
        select jsonb_agg(
          to_jsonb(audit) - array[
            'user_id', 'evidence_manifest_version', 'idempotency_key_hmac', 'request_hmac'
          ]
          order by audit.created_at, audit.id
        )
        from private.essay_audits audit
        where audit.user_id = requested_user_id
      ), '[]'::jsonb),
      'entitlements', coalesce((
        select jsonb_agg(
          to_jsonb(entitlement) - array['user_id', 'stripe_checkout_session_id']
          order by entitlement.created_at, entitlement.id
        )
        from private.entitlements entitlement
        where entitlement.user_id = requested_user_id
      ), '[]'::jsonb)
    )
  ) into account_export;

  if pg_catalog.octet_length(account_export::text) > requested_max_bytes then
    return jsonb_build_object('decision', 'TOO_LARGE');
  end if;
  return jsonb_build_object('decision', 'READY', 'export', account_export);
end;
$$;

revoke execute on function private.queue_account_deletion(
  uuid, text, text, text, timestamptz
) from public, anon, authenticated;
revoke execute on function private.get_account_deletion_status(text, timestamptz)
from public, anon, authenticated;
revoke execute on function private.claim_next_account_deletion(timestamptz)
from public, anon, authenticated;
revoke execute on function private.prepare_account_deletion(uuid)
from public, anon, authenticated;
revoke execute on function private.complete_account_deletion(uuid, timestamptz)
from public, anon, authenticated;
revoke execute on function private.fail_account_deletion(uuid, text, timestamptz)
from public, anon, authenticated;
revoke execute on function private.get_account_export(uuid, integer, timestamptz)
from public, anon, authenticated;

grant execute on function private.queue_account_deletion(
  uuid, text, text, text, timestamptz
) to service_role;
grant execute on function private.get_account_deletion_status(text, timestamptz)
to service_role;
grant execute on function private.claim_next_account_deletion(timestamptz)
to service_role;
grant execute on function private.prepare_account_deletion(uuid) to service_role;
grant execute on function private.complete_account_deletion(uuid, timestamptz)
to service_role;
grant execute on function private.fail_account_deletion(uuid, text, timestamptz)
to service_role;
grant execute on function private.get_account_export(uuid, integer, timestamptz)
to service_role;
