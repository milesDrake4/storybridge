alter table private.beta_invitations
add column invite_token_hmac text;

alter table private.beta_invitations
add constraint beta_invitations_token_hmac_check check (
  invite_token_hmac is null
  or invite_token_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
);

alter table private.beta_invitations
add constraint beta_invitations_pending_token_check check (
  status <> 'PENDING' or invite_token_hmac is not null
);

create unique index beta_invitations_active_token_hmac_idx
on private.beta_invitations (invite_token_hmac)
where status = 'PENDING' and invite_token_hmac is not null;

create table private.auth_request_limits (
  scope text not null,
  key_hmac text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  request_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (scope, key_hmac, window_start),
  constraint auth_request_limits_scope_check check (scope in ('EMAIL', 'IP')),
  constraint auth_request_limits_key_check check (
    key_hmac ~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
  ),
  constraint auth_request_limits_window_check check (
    window_end = window_start + interval '1 day'
  ),
  constraint auth_request_limits_count_check check (request_count > 0),
  constraint auth_request_limits_timestamps_check check (updated_at >= created_at)
);

create index auth_request_limits_expiry_idx
on private.auth_request_limits (window_end);

create trigger auth_request_limits_set_updated_at
before update on private.auth_request_limits
for each row execute function private.set_updated_at();

alter table private.auth_request_limits enable row level security;
revoke all on table private.auth_request_limits from public, anon, authenticated;
grant select, insert, update, delete on table private.auth_request_limits to service_role;

create function private.consume_auth_request_limit(
  requested_scope text,
  requested_key_hmac text,
  requested_limit integer,
  requested_at timestamptz default now()
)
returns table (
  allowed boolean,
  limit_value integer,
  remaining integer,
  reset_at timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  current_count integer;
  current_window_start timestamptz;
begin
  if requested_scope not in ('EMAIL', 'IP')
    or requested_key_hmac !~ '^v[1-9][0-9]*\.[A-Za-z0-9_-]{43}$'
    or requested_limit < 1 then
    raise exception using errcode = '22023', message = 'invalid rate limit input';
  end if;

  current_window_start := date_trunc('day', requested_at at time zone 'UTC') at time zone 'UTC';

  delete from private.auth_request_limits
  where window_end <= requested_at;

  insert into private.auth_request_limits (
    scope,
    key_hmac,
    window_start,
    window_end,
    request_count
  )
  values (
    requested_scope,
    requested_key_hmac,
    current_window_start,
    current_window_start + interval '1 day',
    1
  )
  on conflict (scope, key_hmac, window_start)
  do update set request_count = private.auth_request_limits.request_count + 1
  returning request_count into current_count;

  return query select
    current_count <= requested_limit,
    requested_limit,
    greatest(requested_limit - current_count, 0),
    current_window_start + interval '1 day';
end;
$$;

revoke execute on function private.consume_auth_request_limit(text, text, integer, timestamptz)
from public, anon, authenticated;
grant execute on function private.consume_auth_request_limit(text, text, integer, timestamptz)
to service_role;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'purge-expired-auth-request-limits',
  '0 0 * * *',
  $$delete from private.auth_request_limits where window_end <= now()$$
);
