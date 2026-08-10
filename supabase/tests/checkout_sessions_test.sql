begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select has_table('private', 'checkout_sessions', 'checkout bindings are private');
select has_function(
  'private', 'reserve_checkout_session',
  array['uuid','uuid','text','text','integer','text','text','timestamptz','text','text','text','timestamptz'],
  'checkout reservation is available to the service'
);
select has_function(
  'private', 'finalize_checkout_session',
  array['uuid','text','text','text','timestamptz','timestamptz'],
  'checkout finalization is available to the service'
);
select ok(
  not has_table_privilege('authenticated', 'private.checkout_sessions', 'SELECT'),
  'browser users cannot read checkout bindings'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.reserve_checkout_session(uuid,uuid,text,text,integer,text,text,timestamptz,text,text,text,timestamptz)',
    'EXECUTE'
  ),
  'browser users cannot reserve checkouts'
);

insert into auth.users (id, email) values
  ('fa000000-0000-4000-8000-000000000001', 'checkout@example.test');

select is(
  private.reserve_checkout_session(
    'fa100000-0000-4000-8000-000000000001',
    'fa000000-0000-4000-8000-000000000001', '2026-2027',
    'price_season_pass', 2499, 'usd', 'payment',
    '2026-08-04T16:30:00Z', 'v1.' || repeat('u', 43),
    'v1.' || repeat('i', 43), 'v1.' || repeat('r', 43),
    '2026-08-04T16:00:00Z'
  ) ->> 'decision',
  'PENDING', 'the first request reserves a provider binding'
);
select is(
  (select count(*) from private.checkout_sessions where status = 'OPEN'),
  1::bigint, 'one open checkout is reserved'
);

select is(
  private.reserve_checkout_session(
    'fa100000-0000-4000-8000-000000000002',
    'fa000000-0000-4000-8000-000000000001', '2026-2027',
    'price_season_pass', 2499, 'usd', 'payment',
    '2026-08-04T16:31:00Z', 'v1.' || repeat('u', 43),
    'v1.' || repeat('j', 43), 'v1.' || repeat('r', 43),
    '2026-08-04T16:01:00Z'
  ) ->> 'binding_id',
  'fa100000-0000-4000-8000-000000000001',
  'another key resumes the same unfinalized binding'
);

select is(
  private.finalize_checkout_session(
    'fa100000-0000-4000-8000-000000000001', 'cs_test_one', null,
    'https://checkout.stripe.com/c/pay/cs_test_one',
    '2026-08-04T16:30:00Z', '2026-08-04T16:02:00Z'
  ),
  'FINALIZED', 'the service finalizes the provider binding'
);
select is(
  private.finalize_checkout_session(
    'fa100000-0000-4000-8000-000000000001', 'cs_test_one', null,
    'https://checkout.stripe.com/c/pay/cs_test_one',
    '2026-08-04T16:30:00Z', '2026-08-04T16:03:00Z'
  ),
  'REPLAY', 'exact finalization retries are idempotent'
);
select is(
  private.finalize_checkout_session(
    'fa100000-0000-4000-8000-000000000001', 'cs_test_attacker', null,
    'https://checkout.stripe.com/c/pay/cs_test_attacker',
    '2026-08-04T16:30:00Z', '2026-08-04T16:03:00Z'
  ),
  'STATE_CONFLICT', 'a binding cannot be replaced by another provider session'
);

select is(
  private.reserve_checkout_session(
    'fa100000-0000-4000-8000-000000000003',
    'fa000000-0000-4000-8000-000000000001', '2026-2027',
    'price_season_pass', 2499, 'usd', 'payment',
    '2026-08-04T16:32:00Z', 'v1.' || repeat('u', 43),
    'v1.' || repeat('i', 43), 'v1.' || repeat('r', 43),
    '2026-08-04T16:04:00Z'
  ) ->> 'checkout_url',
  'https://checkout.stripe.com/c/pay/cs_test_one',
  'the original key replays the original Stripe-hosted URL'
);
select is(
  private.reserve_checkout_session(
    'fa100000-0000-4000-8000-000000000004',
    'fa000000-0000-4000-8000-000000000001', '2026-2027',
    'price_season_pass', 2499, 'usd', 'payment',
    '2026-08-04T16:33:00Z', 'v1.' || repeat('u', 43),
    'v1.' || repeat('i', 43), 'v1.' || repeat('x', 43),
    '2026-08-04T16:05:00Z'
  ) ->> 'decision',
  'IDEMPOTENCY_KEY_REUSED',
  'an idempotency key cannot be reused for different request content'
);

select is(
  private.reserve_checkout_session(
    'fa100000-0000-4000-8000-000000000005',
    'fa000000-0000-4000-8000-000000000001', '2026-2027',
    'price_season_pass', 2499, 'usd', 'payment',
    '2026-08-04T17:01:00Z', 'v1.' || repeat('u', 43),
    'v1.' || repeat('k', 43), 'v1.' || repeat('r', 43),
    '2026-08-04T16:31:00Z'
  ) ->> 'binding_id',
  'fa100000-0000-4000-8000-000000000005',
  'an elapsed open session is atomically replaced'
);
select is(
  (select status from private.checkout_sessions
   where binding_id = 'fa100000-0000-4000-8000-000000000001'),
  'EXPIRED', 'the elapsed binding is marked expired'
);
select is(
  (select count(*) from private.checkout_sessions where status = 'OPEN'),
  1::bigint, 'there remains exactly one open checkout for the season'
);
select is(
  (select expected_amount_cents from private.checkout_sessions where status = 'OPEN'),
  2499, 'the server-selected amount is retained in the binding'
);

select * from finish();
rollback;
