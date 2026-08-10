create or replace function private.create_essay_workspace(
  requested_user_id uuid,
  requested_school_id uuid,
  requested_season text,
  requested_prompt text,
  requested_word_limit integer,
  requested_idempotency_key_hmac text,
  requested_request_hmac text,
  requested_free_essay_limit integer,
  requested_at timestamptz
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_entitlement private.entitlements%rowtype;
  current_transaction private.essay_allowance_transactions%rowtype;
  current_essay public.essays%rowtype;
  consumed_count bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'storybridge:essay-allowance:' || requested_user_id::text || ':' || requested_season,
      0
    )
  );

  select * into current_transaction
  from private.essay_allowance_transactions
  where user_id = requested_user_id
    and idempotency_key_hmac = requested_idempotency_key_hmac;

  if found then
    if current_transaction.request_hmac <> requested_request_hmac then
      return jsonb_build_object('decision', 'IDEMPOTENCY_KEY_REUSED', 'essay', null);
    end if;

    select * into current_essay
    from public.essays
    where user_id = requested_user_id and id = current_transaction.essay_id;

    if found then
      return jsonb_build_object('decision', 'REPLAY', 'essay', to_jsonb(current_essay));
    end if;

    return jsonb_build_object('decision', 'REPLAY_DELETED', 'essay', null);
  end if;

  perform 1
  from private.beta_invitations
  where accepted_user_id = requested_user_id and status = 'ACCEPTED';

  if not found then
    return jsonb_build_object('decision', 'NOT_ELIGIBLE', 'essay', null);
  end if;

  perform 1
  from private.schools
  where id = requested_school_id and status = 'ACTIVE';

  if not found then
    return jsonb_build_object('decision', 'UNSUPPORTED_SCHOOL', 'essay', null);
  end if;

  insert into private.entitlements (
    user_id, kind, season, essay_limit, status, starts_at, created_at, updated_at
  ) values (
    requested_user_id, 'FREE', requested_season, requested_free_essay_limit, 'ACTIVE',
    requested_at, requested_at, requested_at
  )
  on conflict (user_id, season, kind) do nothing;

  select * into current_entitlement
  from private.entitlements
  where user_id = requested_user_id
    and season = requested_season
    and status = 'ACTIVE'
    and starts_at <= requested_at
    and (ends_at is null or ends_at > requested_at)
  order by case kind when 'SEASON_PASS' then 0 else 1 end
  limit 1
  for update;

  if not found then
    return jsonb_build_object('decision', 'QUOTA_EXCEEDED', 'essay', null);
  end if;

  select count(*) into consumed_count
  from private.essay_allowance_transactions
  where user_id = requested_user_id
    and season = requested_season;

  if consumed_count >= current_entitlement.essay_limit then
    return jsonb_build_object('decision', 'QUOTA_EXCEEDED', 'essay', null);
  end if;

  insert into public.essays (
    user_id, school_id, season, prompt, word_limit, created_at, updated_at
  ) values (
    requested_user_id, requested_school_id, requested_season,
    requested_prompt, requested_word_limit, requested_at, requested_at
  )
  returning * into current_essay;

  insert into private.essay_allowance_transactions (
    user_id, entitlement_id, essay_id, season,
    idempotency_key_hmac, request_hmac, created_at
  ) values (
    requested_user_id, current_entitlement.id, current_essay.id, requested_season,
    requested_idempotency_key_hmac, requested_request_hmac, requested_at
  );

  return jsonb_build_object('decision', 'CREATED', 'essay', to_jsonb(current_essay));
end;
$$;

create or replace function private.create_essay_workspace(
  requested_user_id uuid,
  requested_school_id uuid,
  requested_season text,
  requested_prompt text,
  requested_word_limit integer,
  requested_idempotency_key_hmac text,
  requested_request_hmac text,
  requested_at timestamptz default now()
)
returns jsonb
language sql
set search_path = ''
as $$
  select private.create_essay_workspace(
    requested_user_id, requested_school_id, requested_season,
    requested_prompt, requested_word_limit, requested_idempotency_key_hmac,
    requested_request_hmac, 1, requested_at
  );
$$;

create function private.get_billing_entitlement(
  requested_user_id uuid,
  requested_season text,
  requested_default_free_limit integer,
  requested_at timestamptz default now()
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with paid as (
    select
      kind,
      case
        when status = 'ACTIVE'
          and (starts_at > requested_at
            or (ends_at is not null and ends_at <= requested_at))
          then 'EXPIRED'
        else status
      end as effective_status,
      essay_limit
    from private.entitlements
    where user_id = requested_user_id
      and season = requested_season
      and kind = 'SEASON_PASS'
  ),
  free as (
    select
      kind,
      case
        when status = 'ACTIVE'
          and (starts_at > requested_at
            or (ends_at is not null and ends_at <= requested_at))
          then 'EXPIRED'
        else status
      end as effective_status,
      essay_limit
    from private.entitlements
    where user_id = requested_user_id
      and season = requested_season
      and kind = 'FREE'
  ),
  candidates as (
    select 0 as priority, kind, effective_status, essay_limit
    from paid
    where effective_status = 'ACTIVE'
    union all
    select 1, kind, effective_status, essay_limit
    from free
    union all
    select 2, 'FREE', 'ACTIVE', requested_default_free_limit
    where not exists (select 1 from free)
  ),
  effective as (
    select kind, effective_status, essay_limit
    from candidates
    order by priority
    limit 1
  ),
  usage as (
    select count(*)::integer as essays_used
    from private.essay_allowance_transactions
    where user_id = requested_user_id
      and season = requested_season
  )
  select jsonb_build_object(
    'season', requested_season,
    'kind', effective.kind,
    'status', effective.effective_status,
    'essay_limit', effective.essay_limit,
    'essays_used', usage.essays_used,
    'essays_remaining', case
      when effective.effective_status = 'ACTIVE'
        then greatest(effective.essay_limit - usage.essays_used, 0)
      else 0
    end,
    'season_pass_status', (select effective_status from paid)
  )
  from effective cross join usage;
$$;

revoke execute on function private.get_billing_entitlement(
  uuid, text, integer, timestamptz
) from public, anon, authenticated;
grant execute on function private.get_billing_entitlement(
  uuid, text, integer, timestamptz
) to service_role;

revoke execute on function private.create_essay_workspace(
  uuid, uuid, text, text, integer, text, text, integer, timestamptz
) from public, anon, authenticated;
grant execute on function private.create_essay_workspace(
  uuid, uuid, text, text, integer, text, text, integer, timestamptz
) to service_role;
