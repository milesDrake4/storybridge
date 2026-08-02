create table private.ai_operations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  essay_id uuid,
  method text not null,
  route text not null,
  idempotency_key_hmac text not null,
  request_hmac text,
  purpose text not null,
  status text not null default 'RESERVED',
  provider_started_at timestamptz,
  completed_at timestamptz,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  provider_request_id text,
  model_id text,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer,
  estimated_cost_cents integer not null,
  final_cost_cents integer,
  safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_operations_user_id_id_key unique (user_id, id),
  constraint ai_operations_idempotency_key_hmac_check check (
    idempotency_key_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint ai_operations_request_hmac_check check (
    request_hmac is null
    or request_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint ai_operations_method_check check (
    method in ('POST', 'PUT', 'PATCH', 'DELETE')
  ),
  constraint ai_operations_route_check check (
    route ~ '^/api/v1/[A-Za-z0-9_./{}-]+$' and char_length(route) <= 200
  ),
  constraint ai_operations_purpose_check check (
    purpose in (
      'INTERVIEW_REPLY',
      'STORY_EXTRACTION',
      'SCHOOL_RESEARCH',
      'ANGLE_GENERATION',
      'OUTLINE_GENERATION',
      'COACHING',
      'REWRITE',
      'CONTINUATION',
      'FINAL_REVIEW',
      'REFERENCE_DRAFT'
    )
  ),
  constraint ai_operations_status_check check (
    status in ('RESERVED', 'STARTED', 'SUCCEEDED', 'FAILED', 'REFUSED', 'UNKNOWN')
  ),
  constraint ai_operations_started_check check (
    (status = 'RESERVED' and provider_started_at is null and completed_at is null)
    or (
      status = 'STARTED'
      and provider_started_at is not null
      and completed_at is null
    )
    or (
      status in ('SUCCEEDED', 'FAILED', 'REFUSED', 'UNKNOWN')
      and completed_at is not null
    )
  ),
  constraint ai_operations_result_check check (
    (result_resource_type is null and result_resource_id is null)
    or (
      status = 'SUCCEEDED'
      and result_resource_type is not null
      and result_resource_id is not null
      and char_length(result_resource_type) between 1 and 50
    )
  ),
  constraint ai_operations_http_status_check check (
    original_http_status is null or original_http_status between 100 and 599
  ),
  constraint ai_operations_provider_id_check check (
    provider_request_id is null or char_length(provider_request_id) between 1 and 255
  ),
  constraint ai_operations_model_id_check check (
    model_id is null or char_length(model_id) between 1 and 100
  ),
  constraint ai_operations_usage_check check (
    (input_tokens is null or input_tokens >= 0)
    and (output_tokens is null or output_tokens >= 0)
    and (latency_ms is null or latency_ms >= 0)
    and estimated_cost_cents >= 0
    and (final_cost_cents is null or final_cost_cents >= 0)
  ),
  constraint ai_operations_error_code_check check (
    safe_error_code is null
    or (
      safe_error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
      and char_length(safe_error_code) <= 64
    )
  ),
  constraint ai_operations_timestamps_check check (
    (provider_started_at is null or provider_started_at >= created_at)
    and (completed_at is null or completed_at >= created_at)
    and updated_at >= created_at
  ),
  constraint ai_operations_idempotency_key unique (
    user_id,
    method,
    route,
    idempotency_key_hmac
  )
);

create unique index ai_operations_reference_draft_once_idx
on private.ai_operations (essay_id, purpose)
where
  essay_id is not null
  and purpose = 'REFERENCE_DRAFT'
  and provider_started_at is not null;

create index ai_operations_user_created_at_idx
on private.ai_operations (user_id, created_at desc);

create index ai_operations_request_hmac_retention_idx
on private.ai_operations (created_at)
where request_hmac is not null;

create table private.usage_reservations (
  operation_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  ip_hmac text not null,
  quota_window_start timestamptz not null,
  quota_window_end timestamptz not null,
  budget_month_start date not null,
  reserved_units integer not null default 1,
  estimated_cost_cents integer not null,
  final_units integer,
  final_cost_cents integer,
  expires_at timestamptz not null,
  released_at timestamptz,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint usage_reservations_operation_owner_fkey foreign key (user_id, operation_id)
    references private.ai_operations (user_id, id) on delete cascade,
  constraint usage_reservations_ip_hmac_check check (
    ip_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint usage_reservations_quota_window_check check (
    quota_window_end = quota_window_start + interval '1 day'
    and quota_window_start = (
      date_trunc('day', quota_window_start at time zone 'UTC') at time zone 'UTC'
    )
  ),
  constraint usage_reservations_budget_month_check check (
    budget_month_start = date_trunc('month', quota_window_start at time zone 'UTC')::date
  ),
  constraint usage_reservations_values_check check (
    reserved_units > 0
    and estimated_cost_cents >= 0
    and (final_units is null or final_units >= 0)
    and (final_cost_cents is null or final_cost_cents >= 0)
  ),
  constraint usage_reservations_lifecycle_check check (
    not (released_at is not null and finalized_at is not null)
    and (released_at is null or released_at >= created_at)
    and (finalized_at is null or finalized_at >= created_at)
    and expires_at > created_at
    and updated_at >= created_at
  )
);

create index usage_reservations_user_window_idx
on private.usage_reservations (user_id, quota_window_start)
where released_at is null;

create index usage_reservations_ip_window_idx
on private.usage_reservations (ip_hmac, quota_window_start)
where released_at is null;

create index usage_reservations_budget_month_idx
on private.usage_reservations (budget_month_start)
where released_at is null;

create trigger ai_operations_set_updated_at
before update on private.ai_operations
for each row execute function private.set_updated_at();

create trigger usage_reservations_set_updated_at
before update on private.usage_reservations
for each row execute function private.set_updated_at();

alter table private.ai_operations enable row level security;
alter table private.usage_reservations enable row level security;

revoke all on table private.ai_operations from public, anon, authenticated;
revoke all on table private.usage_reservations from public, anon, authenticated;
grant select, insert, update, delete on table private.ai_operations to service_role;
grant select, insert, update, delete on table private.usage_reservations to service_role;

create function private.reserve_ai_operation(
  requested_user_id uuid,
  requested_essay_id uuid,
  requested_method text,
  requested_route text,
  requested_idempotency_key_hmac text,
  requested_request_hmac text,
  requested_ip_hmac text,
  requested_purpose text,
  requested_daily_limit integer,
  requested_beta_account_cap integer,
  requested_monthly_budget_cents integer,
  requested_estimated_cost_cents integer,
  requested_at timestamptz default now()
)
returns table (
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  current_accepted_count integer;
  current_budget_cents bigint;
  current_ip_units bigint;
  current_month_start date;
  current_operation private.ai_operations%rowtype;
  current_user_units bigint;
  current_window_start timestamptz;
begin
  if requested_idempotency_key_hmac !~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
    or requested_request_hmac !~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
    or requested_ip_hmac !~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
    or requested_daily_limit < 1
    or requested_beta_account_cap < 1
    or requested_beta_account_cap > 25
    or requested_monthly_budget_cents < 1
    or requested_estimated_cost_cents < 0 then
    raise exception using errcode = '22023', message = 'invalid AI reservation input';
  end if;

  current_window_start :=
    date_trunc('day', requested_at at time zone 'UTC') at time zone 'UTC';
  current_month_start :=
    date_trunc('month', requested_at at time zone 'UTC')::date;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'storybridge:ai-user:' || requested_user_id::text || ':' || current_window_start::text,
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'storybridge:ai-ip:' || requested_ip_hmac || ':' || current_window_start::text,
      0
    )
  );

  select *
  into current_operation
  from private.ai_operations
  where user_id = requested_user_id
    and method = requested_method
    and route = requested_route
    and idempotency_key_hmac = requested_idempotency_key_hmac
  for update;

  if found then
    if current_operation.request_hmac is null
      or current_operation.request_hmac <> requested_request_hmac then
      return query select
        'IDEMPOTENCY_CONFLICT'::text,
        current_operation.id,
        current_operation.status,
        current_operation.result_resource_type,
        current_operation.result_resource_id,
        current_operation.original_http_status,
        current_window_start + interval '1 day';
      return;
    end if;

    if current_operation.status = 'RESERVED' then
      update private.usage_reservations reservations
      set released_at = requested_at
      where reservations.operation_id = current_operation.id
        and reservations.released_at is null
        and reservations.finalized_at is null
        and reservations.expires_at <= requested_at;

      if found then
        update private.ai_operations
        set
          status = 'FAILED',
          completed_at = requested_at,
          original_http_status = 503,
          safe_error_code = 'RESERVATION_EXPIRED'
        where id = current_operation.id
        returning * into current_operation;
      end if;
    end if;

    return query select
      'REPLAY'::text,
      current_operation.id,
      current_operation.status,
      current_operation.result_resource_type,
      current_operation.result_resource_id,
      current_operation.original_http_status,
      current_window_start + interval '1 day';
    return;
  end if;

  perform 1
  from private.beta_invitations
  where accepted_user_id = requested_user_id
    and status = 'ACCEPTED';

  if not found then
    raise exception using errcode = '42501', message = 'AI access requires an accepted invitation';
  end if;

  select accepted_count
  into current_accepted_count
  from private.beta_cohort_state
  where singleton
  for update;

  if current_accepted_count > requested_beta_account_cap then
    return query select
      'BETA_CAP_REACHED'::text,
      null::uuid,
      null::text,
      null::text,
      null::uuid,
      null::integer,
      current_window_start + interval '1 day';
    return;
  end if;

  if requested_purpose = 'REFERENCE_DRAFT' and requested_essay_id is not null then
    perform 1
    from private.ai_operations
    where essay_id = requested_essay_id
      and purpose = 'REFERENCE_DRAFT'
      and provider_started_at is not null;

    if found then
      return query select
        'FALLBACK_LIMIT_REACHED'::text,
        null::uuid,
        null::text,
        null::text,
        null::uuid,
        null::integer,
        current_window_start + interval '1 day';
      return;
    end if;
  end if;

  select coalesce(sum(reserved_units), 0)
  into current_user_units
  from private.usage_reservations reservations
  join private.ai_operations operations on operations.id = reservations.operation_id
  where reservations.user_id = requested_user_id
    and reservations.quota_window_start = current_window_start
    and reservations.released_at is null
    and (
      operations.provider_started_at is not null
      or reservations.expires_at > requested_at
    );

  select coalesce(sum(reserved_units), 0)
  into current_ip_units
  from private.usage_reservations reservations
  join private.ai_operations operations on operations.id = reservations.operation_id
  where reservations.ip_hmac = requested_ip_hmac
    and reservations.quota_window_start = current_window_start
    and reservations.released_at is null
    and (
      operations.provider_started_at is not null
      or reservations.expires_at > requested_at
    );

  if current_user_units >= requested_daily_limit
    or current_ip_units >= requested_daily_limit then
    return query select
      'QUOTA_EXCEEDED'::text,
      null::uuid,
      null::text,
      null::text,
      null::uuid,
      null::integer,
      current_window_start + interval '1 day';
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'storybridge:ai-budget:' || current_month_start::text,
      0
    )
  );

  select coalesce(
    sum(coalesce(reservations.final_cost_cents, reservations.estimated_cost_cents)),
    0
  )
  into current_budget_cents
  from private.usage_reservations reservations
  join private.ai_operations operations on operations.id = reservations.operation_id
  where reservations.budget_month_start = current_month_start
    and reservations.released_at is null
    and (
      operations.provider_started_at is not null
      or reservations.expires_at > requested_at
    );

  if current_budget_cents + requested_estimated_cost_cents
    > requested_monthly_budget_cents then
    return query select
      'BUDGET_EXHAUSTED'::text,
      null::uuid,
      null::text,
      null::text,
      null::uuid,
      null::integer,
      (current_month_start + interval '1 month')::timestamptz;
    return;
  end if;

  insert into private.ai_operations (
    user_id,
    essay_id,
    method,
    route,
    idempotency_key_hmac,
    request_hmac,
    purpose,
    estimated_cost_cents,
    created_at,
    updated_at
  )
  values (
    requested_user_id,
    requested_essay_id,
    requested_method,
    requested_route,
    requested_idempotency_key_hmac,
    requested_request_hmac,
    requested_purpose,
    requested_estimated_cost_cents,
    requested_at,
    requested_at
  )
  returning * into current_operation;

  insert into private.usage_reservations (
    operation_id,
    user_id,
    ip_hmac,
    quota_window_start,
    quota_window_end,
    budget_month_start,
    estimated_cost_cents,
    expires_at,
    created_at,
    updated_at
  )
  values (
    current_operation.id,
    requested_user_id,
    requested_ip_hmac,
    current_window_start,
    current_window_start + interval '1 day',
    current_month_start,
    requested_estimated_cost_cents,
    requested_at + interval '10 minutes',
    requested_at,
    requested_at
  );

  return query select
    'RESERVED'::text,
    current_operation.id,
    current_operation.status,
    null::text,
    null::uuid,
    null::integer,
    current_window_start + interval '1 day';
end;
$$;

create function private.start_ai_operation(
  requested_operation_id uuid,
  requested_at timestamptz default now()
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  current_operation private.ai_operations%rowtype;
begin
  select *
  into current_operation
  from private.ai_operations
  where id = requested_operation_id
  for update;

  if not found then
    return 'NOT_FOUND';
  end if;
  if current_operation.provider_started_at is not null then
    return 'ALREADY_STARTED';
  end if;
  if current_operation.status <> 'RESERVED' then
    return 'INVALID_STATE';
  end if;

  perform 1
  from private.usage_reservations
  where operation_id = requested_operation_id
    and released_at is null
    and finalized_at is null
    and expires_at > requested_at
  for update;

  if not found then
    return 'RESERVATION_EXPIRED';
  end if;

  if current_operation.purpose = 'REFERENCE_DRAFT' then
    perform 1
    from private.ai_operations
    where essay_id = current_operation.essay_id
      and purpose = 'REFERENCE_DRAFT'
      and provider_started_at is not null
      and id <> current_operation.id;

    if found then
      return 'FALLBACK_LIMIT_REACHED';
    end if;
  end if;

  update private.ai_operations
  set status = 'STARTED', provider_started_at = requested_at
  where id = requested_operation_id;

  return 'STARTED';
exception
  when unique_violation then
    return 'FALLBACK_LIMIT_REACHED';
end;
$$;

create function private.release_ai_operation(
  requested_operation_id uuid,
  requested_safe_error_code text,
  requested_http_status integer,
  requested_at timestamptz default now()
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  update private.ai_operations
  set
    status = 'FAILED',
    completed_at = requested_at,
    original_http_status = requested_http_status,
    safe_error_code = requested_safe_error_code
  where id = requested_operation_id
    and status = 'RESERVED'
    and provider_started_at is null;

  if not found then
    return false;
  end if;

  update private.usage_reservations
  set released_at = requested_at
  where operation_id = requested_operation_id
    and released_at is null
    and finalized_at is null;

  return true;
end;
$$;

create function private.finalize_ai_operation(
  requested_operation_id uuid,
  requested_status text,
  requested_http_status integer,
  requested_provider_request_id text,
  requested_model_id text,
  requested_input_tokens integer,
  requested_output_tokens integer,
  requested_latency_ms integer,
  requested_final_cost_cents integer,
  requested_result_resource_type text,
  requested_result_resource_id uuid,
  requested_safe_error_code text,
  requested_at timestamptz default now()
)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if requested_status not in ('SUCCEEDED', 'FAILED', 'REFUSED', 'UNKNOWN') then
    raise exception using errcode = '22023', message = 'invalid AI completion status';
  end if;

  update private.ai_operations
  set
    status = requested_status,
    completed_at = requested_at,
    original_http_status = requested_http_status,
    provider_request_id = requested_provider_request_id,
    model_id = requested_model_id,
    input_tokens = requested_input_tokens,
    output_tokens = requested_output_tokens,
    latency_ms = requested_latency_ms,
    final_cost_cents = requested_final_cost_cents,
    result_resource_type = requested_result_resource_type,
    result_resource_id = requested_result_resource_id,
    safe_error_code = requested_safe_error_code
  where id = requested_operation_id
    and status = 'STARTED'
    and provider_started_at is not null;

  if not found then
    return false;
  end if;

  update private.usage_reservations
  set
    final_units = 1,
    final_cost_cents = requested_final_cost_cents,
    finalized_at = requested_at
  where operation_id = requested_operation_id
    and released_at is null
    and finalized_at is null;

  return true;
end;
$$;

revoke execute on function private.reserve_ai_operation(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer,
  integer,
  integer,
  timestamptz
) from public, anon, authenticated;
grant execute on function private.reserve_ai_operation(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  integer,
  integer,
  integer,
  integer,
  timestamptz
) to service_role;

revoke execute on function private.start_ai_operation(uuid, timestamptz)
from public, anon, authenticated;
grant execute on function private.start_ai_operation(uuid, timestamptz)
to service_role;

revoke execute on function private.release_ai_operation(uuid, text, integer, timestamptz)
from public, anon, authenticated;
grant execute on function private.release_ai_operation(uuid, text, integer, timestamptz)
to service_role;

revoke execute on function private.finalize_ai_operation(
  uuid,
  text,
  integer,
  text,
  text,
  integer,
  integer,
  integer,
  integer,
  text,
  uuid,
  text,
  timestamptz
) from public, anon, authenticated;
grant execute on function private.finalize_ai_operation(
  uuid,
  text,
  integer,
  text,
  text,
  integer,
  integer,
  integer,
  integer,
  text,
  uuid,
  text,
  timestamptz
) to service_role;

select cron.schedule(
  'purge-expired-ai-request-fingerprints',
  '15 0 * * *',
  $$update private.ai_operations
    set request_hmac = null
    where request_hmac is not null
      and created_at < now() - interval '30 days'$$
);
