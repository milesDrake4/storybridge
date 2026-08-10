create table private.stripe_events (
  event_id text primary key,
  event_type text not null,
  payload_hmac text not null,
  provider_created_at timestamptz not null,
  received_at timestamptz not null,
  status text not null default 'RECEIVED',
  binding_id uuid,
  stripe_checkout_session_id text,
  stripe_customer_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  safe_failure_code text,
  operator_alert_required boolean not null default false,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stripe_events_event_id_check check (
    event_id ~ '^evt_[A-Za-z0-9_]+$'
  ),
  constraint stripe_events_type_check check (char_length(event_type) between 1 and 200),
  constraint stripe_events_payload_hmac_check check (
    payload_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint stripe_events_status_check check (
    status in ('RECEIVED', 'PROCESSED', 'REJECTED', 'RETRY_PENDING', 'FAILED')
  ),
  constraint stripe_events_session_id_check check (
    stripe_checkout_session_id is null
    or stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$'
  ),
  constraint stripe_events_customer_id_check check (
    stripe_customer_id is null or stripe_customer_id ~ '^cus_[A-Za-z0-9_]+$'
  ),
  constraint stripe_events_payment_intent_id_check check (
    stripe_payment_intent_id is null
    or stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'
  ),
  constraint stripe_events_charge_id_check check (
    stripe_charge_id is null or stripe_charge_id ~ '^ch_[A-Za-z0-9_]+$'
  ),
  constraint stripe_events_failure_code_check check (
    safe_failure_code is null
    or safe_failure_code ~ '^[A-Z][A-Z0-9_]{0,99}$'
  ),
  constraint stripe_events_terminal_time_check check (
    (status in ('RECEIVED', 'RETRY_PENDING') and processed_at is null)
    or (status in ('PROCESSED', 'REJECTED', 'FAILED') and processed_at is not null)
  ),
  constraint stripe_events_timestamps_check check (
    updated_at >= created_at and received_at <= updated_at
  )
);

create index stripe_events_binding_id_idx
on private.stripe_events (binding_id, provider_created_at, event_id)
where binding_id is not null;
create index stripe_events_retry_queue_idx
on private.stripe_events (received_at, event_id)
where status = 'RETRY_PENDING';
create index stripe_events_alert_queue_idx
on private.stripe_events (processed_at, event_id)
where operator_alert_required;

create table private.stripe_reversal_tombstones (
  binding_id uuid primary key references private.checkout_sessions (binding_id) on delete cascade,
  stripe_payment_intent_id text not null unique,
  stripe_charge_id text not null unique,
  terminal_state text not null,
  source_event_id text not null references private.stripe_events (event_id) on delete restrict,
  provider_created_at timestamptz not null,
  processed_at timestamptz not null,
  constraint stripe_reversal_tombstones_payment_intent_check check (
    stripe_payment_intent_id ~ '^pi_[A-Za-z0-9_]+$'
  ),
  constraint stripe_reversal_tombstones_charge_check check (
    stripe_charge_id ~ '^ch_[A-Za-z0-9_]+$'
  ),
  constraint stripe_reversal_tombstones_state_check check (
    terminal_state in ('REFUNDED', 'REVOKED')
  )
);

create index stripe_reversal_tombstones_source_event_idx
on private.stripe_reversal_tombstones (source_event_id);

alter table private.stripe_events enable row level security;
alter table private.stripe_reversal_tombstones enable row level security;
revoke all on table private.stripe_events from public, anon, authenticated;
revoke all on table private.stripe_reversal_tombstones from public, anon, authenticated;
grant select, insert, update on table private.stripe_events to service_role;
grant select, insert, update on table private.stripe_reversal_tombstones to service_role;

create function private.commit_stripe_event(
  requested_action text,
  requested_alert_operator boolean,
  requested_amount_cents integer,
  requested_binding_id uuid,
  requested_charge_id text,
  requested_currency text,
  requested_customer_id text,
  requested_event_created_at timestamptz,
  requested_event_id text,
  requested_event_type text,
  requested_livemode boolean,
  requested_mode text,
  requested_now timestamptz,
  requested_paid_essay_limit integer,
  requested_payload_hmac text,
  requested_payment_intent_id text,
  requested_price_id text,
  requested_safe_failure_code text,
  requested_season text,
  requested_session_id text,
  requested_user_binding_hmac text
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  current_event private.stripe_events%rowtype;
  current_session private.checkout_sessions%rowtype;
  current_tombstone private.stripe_reversal_tombstones%rowtype;
  desired_terminal_state text;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('storybridge:stripe-event:' || requested_event_id, 0)
  );

  insert into private.stripe_events (
    event_id, event_type, payload_hmac, provider_created_at, received_at,
    status, binding_id, stripe_checkout_session_id, stripe_customer_id,
    stripe_payment_intent_id, stripe_charge_id, safe_failure_code,
    operator_alert_required, created_at, updated_at
  ) values (
    requested_event_id, requested_event_type, requested_payload_hmac,
    requested_event_created_at, requested_now, 'RECEIVED', requested_binding_id,
    requested_session_id, requested_customer_id, requested_payment_intent_id,
    requested_charge_id, requested_safe_failure_code, requested_alert_operator,
    requested_now, requested_now
  ) on conflict (event_id) do nothing;

  select * into current_event
  from private.stripe_events
  where event_id = requested_event_id
  for update;

  if current_event.payload_hmac <> requested_payload_hmac
    or current_event.event_type <> requested_event_type
  then
    return 'REJECTED';
  end if;

  if current_event.status in ('PROCESSED', 'REJECTED', 'FAILED') then
    return 'REPLAY';
  end if;

  update private.stripe_events
  set binding_id = requested_binding_id,
      stripe_checkout_session_id = requested_session_id,
      stripe_customer_id = requested_customer_id,
      stripe_payment_intent_id = requested_payment_intent_id,
      stripe_charge_id = requested_charge_id,
      safe_failure_code = requested_safe_failure_code,
      operator_alert_required = requested_alert_operator,
      updated_at = requested_now
  where event_id = requested_event_id;

  if requested_action = 'RETRY' then
    update private.stripe_events
    set status = 'RETRY_PENDING', processed_at = null, updated_at = requested_now
    where event_id = requested_event_id;
    return 'RETRY_PENDING';
  end if;

  if requested_action = 'REJECT' then
    update private.stripe_events
    set status = 'REJECTED', processed_at = requested_now, updated_at = requested_now
    where event_id = requested_event_id;
    return 'REJECTED';
  end if;

  if requested_action not in ('COMPLETE', 'EXPIRE', 'REFUND', 'REVOKE')
    or requested_binding_id is null
    or requested_session_id is null
  then
    update private.stripe_events
    set status = 'REJECTED', safe_failure_code = 'INVALID_NORMALIZED_EVENT',
        operator_alert_required = true, processed_at = requested_now,
        updated_at = requested_now
    where event_id = requested_event_id;
    return 'REJECTED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'storybridge:stripe-binding:' || requested_binding_id::text,
      0
    )
  );

  select * into current_session
  from private.checkout_sessions
  where binding_id = requested_binding_id
  for update;

  if not found then
    update private.stripe_events
    set status = 'RETRY_PENDING', safe_failure_code = 'BINDING_NOT_FOUND',
        operator_alert_required = false, processed_at = null,
        updated_at = requested_now
    where event_id = requested_event_id;
    return 'RETRY_PENDING';
  end if;

  if current_session.stripe_checkout_session_id is distinct from requested_session_id
    or current_session.expected_price_id is distinct from requested_price_id
    or current_session.expected_amount_cents is distinct from requested_amount_cents
    or current_session.expected_currency is distinct from requested_currency
    or current_session.mode is distinct from requested_mode
    or current_session.season is distinct from requested_season
    or current_session.user_binding_hmac is distinct from requested_user_binding_hmac
    or (current_session.stripe_customer_id is not null
      and current_session.stripe_customer_id is distinct from requested_customer_id)
    or (current_session.stripe_payment_intent_id is not null
      and current_session.stripe_payment_intent_id is distinct from requested_payment_intent_id)
    or (current_session.stripe_charge_id is not null
      and current_session.stripe_charge_id is distinct from requested_charge_id)
    or requested_livemode is null
  then
    update private.stripe_events
    set status = 'REJECTED', safe_failure_code = 'BINDING_MISMATCH',
        operator_alert_required = true, processed_at = requested_now,
        updated_at = requested_now
    where event_id = requested_event_id;
    return 'REJECTED';
  end if;

  if requested_action = 'EXPIRE' then
    if current_session.status = 'OPEN' then
      update private.checkout_sessions
      set status = 'EXPIRED', updated_at = requested_now
      where binding_id = requested_binding_id;
    end if;
  elsif requested_action in ('REFUND', 'REVOKE') then
    if requested_payment_intent_id is null or requested_charge_id is null then
      update private.stripe_events
      set status = 'REJECTED', safe_failure_code = 'MISSING_REVERSAL_BINDING',
          operator_alert_required = true, processed_at = requested_now,
          updated_at = requested_now
      where event_id = requested_event_id;
      return 'REJECTED';
    end if;

    desired_terminal_state := case
      when requested_action = 'REVOKE' then 'REVOKED'
      else 'REFUNDED'
    end;

    select * into current_tombstone
    from private.stripe_reversal_tombstones
    where binding_id = requested_binding_id
    for update;

    if found and (
      current_tombstone.stripe_payment_intent_id <> requested_payment_intent_id
      or current_tombstone.stripe_charge_id <> requested_charge_id
    ) then
      update private.stripe_events
      set status = 'REJECTED', safe_failure_code = 'REVERSAL_BINDING_MISMATCH',
          operator_alert_required = true, processed_at = requested_now,
          updated_at = requested_now
      where event_id = requested_event_id;
      return 'REJECTED';
    end if;

    insert into private.stripe_reversal_tombstones (
      binding_id, stripe_payment_intent_id, stripe_charge_id, terminal_state,
      source_event_id, provider_created_at, processed_at
    ) values (
      requested_binding_id, requested_payment_intent_id, requested_charge_id,
      desired_terminal_state, requested_event_id, requested_event_created_at,
      requested_now
    ) on conflict (binding_id) do update
      set terminal_state = case
            when private.stripe_reversal_tombstones.terminal_state = 'REVOKED'
              or excluded.terminal_state = 'REVOKED' then 'REVOKED'
            else 'REFUNDED'
          end,
          source_event_id = case
            when private.stripe_reversal_tombstones.terminal_state = 'REVOKED'
              and excluded.terminal_state = 'REFUNDED'
              then private.stripe_reversal_tombstones.source_event_id
            else excluded.source_event_id
          end,
          provider_created_at = greatest(
            private.stripe_reversal_tombstones.provider_created_at,
            excluded.provider_created_at
          ),
          processed_at = excluded.processed_at;

    select * into current_tombstone
    from private.stripe_reversal_tombstones
    where binding_id = requested_binding_id;

    insert into private.entitlements (
      user_id, kind, season, essay_limit, status, starts_at,
      stripe_checkout_session_id, created_at, updated_at
    ) values (
      current_session.user_id, 'SEASON_PASS', current_session.season,
      requested_paid_essay_limit, current_tombstone.terminal_state,
      requested_event_created_at, current_session.stripe_checkout_session_id,
      requested_now, requested_now
    ) on conflict (user_id, season, kind) do update
      set essay_limit = excluded.essay_limit,
          status = case
            when private.entitlements.status = 'REVOKED'
              or excluded.status = 'REVOKED' then 'REVOKED'
            else 'REFUNDED'
          end,
          stripe_checkout_session_id = excluded.stripe_checkout_session_id,
          updated_at = excluded.updated_at;

    update private.checkout_sessions
    set stripe_customer_id = coalesce(
          stripe_customer_id, requested_customer_id
        ),
        stripe_payment_intent_id = requested_payment_intent_id,
        stripe_charge_id = requested_charge_id,
        updated_at = requested_now
    where binding_id = requested_binding_id;
  else
    if current_session.status = 'EXPIRED' then
      update private.stripe_events
      set status = 'REJECTED', safe_failure_code = 'STALE_COMPLETION',
          operator_alert_required = true, processed_at = requested_now,
          updated_at = requested_now
      where event_id = requested_event_id;
      return 'REJECTED';
    end if;

    if requested_payment_intent_id is null or requested_charge_id is null then
      update private.stripe_events
      set status = 'REJECTED', safe_failure_code = 'MISSING_PAYMENT_BINDING',
          operator_alert_required = true, processed_at = requested_now,
          updated_at = requested_now
      where event_id = requested_event_id;
      return 'REJECTED';
    end if;

    select * into current_tombstone
    from private.stripe_reversal_tombstones
    where binding_id = requested_binding_id;

    insert into private.entitlements (
      user_id, kind, season, essay_limit, status, starts_at,
      stripe_checkout_session_id, created_at, updated_at
    ) values (
      current_session.user_id, 'SEASON_PASS', current_session.season,
      requested_paid_essay_limit,
      coalesce(current_tombstone.terminal_state, 'ACTIVE'),
      requested_event_created_at, requested_session_id,
      requested_now, requested_now
    ) on conflict (user_id, season, kind) do update
      set essay_limit = excluded.essay_limit,
          status = case
            when private.entitlements.status = 'REVOKED' then 'REVOKED'
            when private.entitlements.status = 'REFUNDED' then 'REFUNDED'
            else excluded.status
          end,
          stripe_checkout_session_id = excluded.stripe_checkout_session_id,
          updated_at = excluded.updated_at;

    update private.checkout_sessions
    set status = 'PAID', stripe_customer_id = requested_customer_id,
        stripe_payment_intent_id = requested_payment_intent_id,
        stripe_charge_id = requested_charge_id, updated_at = requested_now
    where binding_id = requested_binding_id;
  end if;

  update private.stripe_events
  set status = 'PROCESSED', safe_failure_code = null,
      operator_alert_required = false, processed_at = requested_now,
      updated_at = requested_now
  where event_id = requested_event_id;
  return 'PROCESSED';
end;
$$;

revoke execute on function private.commit_stripe_event(
  text, boolean, integer, uuid, text, text, text, timestamptz, text, text,
  boolean, text, timestamptz, integer, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function private.commit_stripe_event(
  text, boolean, integer, uuid, text, text, text, timestamptz, text, text,
  boolean, text, timestamptz, integer, text, text, text, text, text, text, text
) to service_role;
