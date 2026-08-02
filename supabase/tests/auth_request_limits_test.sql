begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select has_table('private', 'auth_request_limits', 'auth request limits table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'private.auth_request_limits'::regclass),
  'auth request limits has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'private.auth_request_limits', 'SELECT')
  and not has_table_privilege('authenticated', 'private.auth_request_limits', 'SELECT')
  and not has_function_privilege('authenticated', 'private.consume_auth_request_limit(text,text,integer,timestamptz)', 'EXECUTE'),
  'public roles cannot read or consume rate limits'
);
select ok(
  exists (
    select 1 from pg_indexes
    where schemaname = 'private'
      and indexname = 'beta_invitations_active_token_hmac_idx'
  ),
  'pending invitation tokens have a unique partial index'
);
select throws_ok(
  $$insert into private.beta_invitations (normalized_email_hmac, status, expires_at) values ('v1.' || repeat('b', 43), 'PENDING', now() + interval '1 day')$$,
  '23514',
  null,
  'pending invitations require an HMAC-bound token'
);

select results_eq(
  $$select allowed, limit_value, remaining, reset_at from private.consume_auth_request_limit('EMAIL', 'v1.' || repeat('a', 43), 2, '2026-08-02T12:00:00Z')$$,
  $$values (true, 2, 1, '2026-08-03T00:00:00Z'::timestamptz)$$,
  'first request consumes one email allowance'
);
select results_eq(
  $$select allowed, remaining from private.consume_auth_request_limit('EMAIL', 'v1.' || repeat('a', 43), 2, '2026-08-02T13:00:00Z')$$,
  $$values (true, 0)$$,
  'request at the limit is allowed'
);
select results_eq(
  $$select allowed, remaining from private.consume_auth_request_limit('EMAIL', 'v1.' || repeat('a', 43), 2, '2026-08-02T14:00:00Z')$$,
  $$values (false, 0)$$,
  'request above the limit is denied'
);
select results_eq(
  $$select allowed, remaining from private.consume_auth_request_limit('IP', 'v1.' || repeat('a', 43), 2, '2026-08-02T14:00:00Z')$$,
  $$values (true, 1)$$,
  'email and IP scopes are isolated'
);
select lives_ok(
  $$select * from private.consume_auth_request_limit('EMAIL', 'v1.' || repeat('c', 43), 2, '2026-08-03T00:00:00Z')$$,
  'a request in the next window triggers expired-key cleanup'
);
select is(
  (select count(*) from private.auth_request_limits where window_end <= '2026-08-03T00:00:00Z'),
  0::bigint,
  'expired rate-limit HMACs are not retained beyond their window'
);
select results_eq(
  $$select schedule, command from cron.job where jobname = 'purge-expired-auth-request-limits'$$,
  $$values ('0 0 * * *'::text, 'delete from private.auth_request_limits where window_end <= now()'::text)$$,
  'expired keyed identifiers are purged at every UTC window boundary'
);

select * from finish();
rollback;
