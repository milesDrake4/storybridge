create table private.checkout_sessions (
  binding_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  season text not null,
  stripe_checkout_session_id text,
  stripe_customer_id text,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  expected_price_id text not null,
  expected_amount_cents integer not null,
  expected_currency text not null,
  mode text not null,
  provider_expires_at timestamptz not null,
  status text not null default 'OPEN',
  checkout_url text,
  user_binding_hmac text not null,
  idempotency_key_hmac text not null,
  request_hmac text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint checkout_sessions_season_check check (
    season ~ '^[0-9]{4}-[0-9]{4}$'
  ),
  constraint checkout_sessions_price_id_check check (
    expected_price_id ~ '^price_[A-Za-z0-9_]+$'
  ),
  constraint checkout_sessions_amount_check check (expected_amount_cents > 0),
  constraint checkout_sessions_currency_check check (expected_currency = 'usd'),
  constraint checkout_sessions_mode_check check (mode = 'payment'),
  constraint checkout_sessions_status_check check (
    status in ('OPEN', 'PAID', 'EXPIRED')
  ),
  constraint checkout_sessions_expiry_check check (
    provider_expires_at > created_at
  ),
  constraint checkout_sessions_url_check check (
    checkout_url is null
    or checkout_url ~ '^https://checkout\.stripe\.com/'
  ),
  constraint checkout_sessions_provider_binding_check check (
    (stripe_checkout_session_id is null and checkout_url is null)
    or (stripe_checkout_session_id ~ '^cs_[A-Za-z0-9_]+$' and checkout_url is not null)
  ),
  constraint checkout_sessions_user_binding_hmac_check check (
    user_binding_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint checkout_sessions_idempotency_hmac_check check (
    idempotency_key_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint checkout_sessions_request_hmac_check check (
    request_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint checkout_sessions_timestamps_check check (updated_at >= created_at),
  constraint checkout_sessions_user_idempotency_key unique (
    user_id, idempotency_key_hmac
  )
);

create index checkout_sessions_user_id_idx
on private.checkout_sessions (user_id);
create unique index checkout_sessions_open_user_season_idx
on private.checkout_sessions (user_id, season)
where status = 'OPEN';
create unique index checkout_sessions_stripe_session_idx
on private.checkout_sessions (stripe_checkout_session_id)
where stripe_checkout_session_id is not null;
create unique index checkout_sessions_payment_intent_idx
on private.checkout_sessions (stripe_payment_intent_id)
where stripe_payment_intent_id is not null;
create unique index checkout_sessions_charge_idx
on private.checkout_sessions (stripe_charge_id)
where stripe_charge_id is not null;

create trigger checkout_sessions_set_updated_at
before update on private.checkout_sessions
for each row execute function private.set_updated_at();

alter table private.checkout_sessions enable row level security;
revoke all on table private.checkout_sessions from public, anon, authenticated;
grant select, insert, update on table private.checkout_sessions to service_role;

create function private.reserve_checkout_session(
  requested_binding_id uuid,
  requested_user_id uuid,
  requested_season text,
  requested_price_id text,
  requested_amount_cents integer,
  requested_currency text,
  requested_mode text,
  requested_expires_at timestamptz,
  requested_user_binding_hmac text,
  requested_idempotency_key_hmac text,
  requested_request_hmac text,
  requested_at timestamptz default now()
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  current_session private.checkout_sessions%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'storybridge:checkout:' || requested_user_id::text || ':' || requested_season,
      0
    )
  );

  update private.checkout_sessions
  set status = 'EXPIRED', updated_at = requested_at
  where user_id = requested_user_id
    and season = requested_season
    and status = 'OPEN'
    and provider_expires_at <= requested_at;

  select * into current_session
  from private.checkout_sessions
  where user_id = requested_user_id
    and idempotency_key_hmac = requested_idempotency_key_hmac;

  if found then
    if current_session.request_hmac <> requested_request_hmac then
      return jsonb_build_object('decision', 'IDEMPOTENCY_KEY_REUSED');
    end if;
    if current_session.status <> 'OPEN' then
      return jsonb_build_object('decision', 'STATE_CONFLICT');
    end if;
    if current_session.checkout_url is not null then
      return jsonb_build_object(
        'decision', 'READY',
        'binding_id', current_session.binding_id,
        'checkout_url', current_session.checkout_url,
        'expires_at', current_session.provider_expires_at
      );
    end if;
    if current_session.expected_price_id <> requested_price_id
      or current_session.expected_amount_cents <> requested_amount_cents
      or current_session.expected_currency <> requested_currency
      or current_session.mode <> requested_mode
      or current_session.user_binding_hmac <> requested_user_binding_hmac
    then
      return jsonb_build_object('decision', 'STATE_CONFLICT');
    end if;
    return jsonb_build_object(
      'decision', 'PENDING',
      'binding_id', current_session.binding_id,
      'expires_at', current_session.provider_expires_at
    );
  end if;

  select * into current_session
  from private.checkout_sessions
  where user_id = requested_user_id
    and season = requested_season
    and status = 'OPEN';

  if found then
    if current_session.checkout_url is not null then
      return jsonb_build_object(
        'decision', 'READY',
        'binding_id', current_session.binding_id,
        'checkout_url', current_session.checkout_url,
        'expires_at', current_session.provider_expires_at
      );
    end if;
    if current_session.expected_price_id <> requested_price_id
      or current_session.expected_amount_cents <> requested_amount_cents
      or current_session.expected_currency <> requested_currency
      or current_session.mode <> requested_mode
      or current_session.user_binding_hmac <> requested_user_binding_hmac
    then
      return jsonb_build_object('decision', 'STATE_CONFLICT');
    end if;
    return jsonb_build_object(
      'decision', 'PENDING',
      'binding_id', current_session.binding_id,
      'expires_at', current_session.provider_expires_at
    );
  end if;

  insert into private.checkout_sessions (
    binding_id, user_id, season, expected_price_id, expected_amount_cents,
    expected_currency, mode, provider_expires_at, user_binding_hmac,
    idempotency_key_hmac, request_hmac, created_at, updated_at
  ) values (
    requested_binding_id, requested_user_id, requested_season,
    requested_price_id, requested_amount_cents, requested_currency,
    requested_mode, requested_expires_at, requested_user_binding_hmac,
    requested_idempotency_key_hmac, requested_request_hmac,
    requested_at, requested_at
  );

  return jsonb_build_object(
    'decision', 'PENDING',
    'binding_id', requested_binding_id,
    'expires_at', requested_expires_at
  );
end;
$$;

create function private.finalize_checkout_session(
  requested_binding_id uuid,
  requested_stripe_session_id text,
  requested_stripe_customer_id text,
  requested_checkout_url text,
  requested_expires_at timestamptz,
  requested_at timestamptz default now()
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  current_session private.checkout_sessions%rowtype;
begin
  select * into current_session
  from private.checkout_sessions
  where binding_id = requested_binding_id
  for update;

  if not found then return 'NOT_FOUND'; end if;
  if current_session.status <> 'OPEN'
    or current_session.provider_expires_at <= requested_at
    or current_session.provider_expires_at <> requested_expires_at
  then
    return 'STATE_CONFLICT';
  end if;

  if current_session.stripe_checkout_session_id is not null then
    if current_session.stripe_checkout_session_id = requested_stripe_session_id
      and current_session.checkout_url = requested_checkout_url
      and current_session.stripe_customer_id is not distinct from requested_stripe_customer_id
    then
      return 'REPLAY';
    end if;
    return 'STATE_CONFLICT';
  end if;

  update private.checkout_sessions
  set stripe_checkout_session_id = requested_stripe_session_id,
      stripe_customer_id = requested_stripe_customer_id,
      checkout_url = requested_checkout_url,
      updated_at = requested_at
  where binding_id = requested_binding_id;
  return 'FINALIZED';
end;
$$;

revoke execute on function private.reserve_checkout_session(
  uuid, uuid, text, text, integer, text, text, timestamptz,
  text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function private.reserve_checkout_session(
  uuid, uuid, text, text, integer, text, text, timestamptz,
  text, text, text, timestamptz
) to service_role;

revoke execute on function private.finalize_checkout_session(
  uuid, text, text, text, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function private.finalize_checkout_session(
  uuid, text, text, text, timestamptz, timestamptz
) to service_role;
