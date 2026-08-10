begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

select has_function(
  'private', 'get_billing_entitlement',
  array['uuid','text','integer','timestamptz'],
  'server-owned billing entitlement read model exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.get_billing_entitlement(uuid,text,integer,timestamptz)',
    'EXECUTE'
  ),
  'browser roles cannot query private entitlement state directly'
);

insert into auth.users (id, email) values
  ('fd000000-0000-4000-8000-000000000001', 'paid-active@example.test'),
  ('fd000000-0000-4000-8000-000000000002', 'paid-refunded@example.test'),
  ('fd000000-0000-4000-8000-000000000003', 'paid-revoked@example.test'),
  ('fd000000-0000-4000-8000-000000000004', 'free-default@example.test');

insert into private.beta_invitations (
  normalized_email_hmac, status, expires_at, accepted_user_id
) values
  ('v1.' || repeat('a', 43), 'ACCEPTED', now() + interval '1 day',
   'fd000000-0000-4000-8000-000000000001'),
  ('v1.' || repeat('b', 43), 'ACCEPTED', now() + interval '1 day',
   'fd000000-0000-4000-8000-000000000002'),
  ('v1.' || repeat('c', 43), 'ACCEPTED', now() + interval '1 day',
   'fd000000-0000-4000-8000-000000000003'),
  ('v1.' || repeat('d', 43), 'ACCEPTED', now() + interval '1 day',
   'fd000000-0000-4000-8000-000000000004');

insert into private.entitlements (
  user_id, kind, season, essay_limit, status, starts_at,
  stripe_checkout_session_id, created_at, updated_at
) values
  ('fd000000-0000-4000-8000-000000000001', 'FREE', '2026-2027', 1,
   'ACTIVE', '2026-08-01T00:00:00Z', null,
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
  ('fd000000-0000-4000-8000-000000000001', 'SEASON_PASS', '2026-2027', 20,
   'ACTIVE', '2026-08-02T00:00:00Z', 'cs_test_allowance_active',
   '2026-08-02T00:00:00Z', '2026-08-02T00:00:00Z'),
  ('fd000000-0000-4000-8000-000000000002', 'FREE', '2026-2027', 1,
   'ACTIVE', '2026-08-01T00:00:00Z', null,
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
  ('fd000000-0000-4000-8000-000000000002', 'SEASON_PASS', '2026-2027', 20,
   'REFUNDED', '2026-08-02T00:00:00Z', 'cs_test_allowance_refunded',
   '2026-08-02T00:00:00Z', '2026-08-02T00:00:00Z'),
  ('fd000000-0000-4000-8000-000000000003', 'FREE', '2026-2027', 1,
   'ACTIVE', '2026-08-01T00:00:00Z', null,
   '2026-08-01T00:00:00Z', '2026-08-01T00:00:00Z'),
  ('fd000000-0000-4000-8000-000000000003', 'SEASON_PASS', '2026-2027', 20,
   'REVOKED', '2026-08-02T00:00:00Z', 'cs_test_allowance_revoked',
   '2026-08-02T00:00:00Z', '2026-08-02T00:00:00Z');

create temp table paid_allowance_seed (
  user_id uuid not null,
  essay_id uuid not null,
  position integer not null
);
insert into paid_allowance_seed (user_id, essay_id, position)
select 'fd000000-0000-4000-8000-000000000001'::uuid, gen_random_uuid(), value
from generate_series(1, 19) value
union all
select 'fd000000-0000-4000-8000-000000000002'::uuid, gen_random_uuid(), 1
union all
select 'fd000000-0000-4000-8000-000000000003'::uuid, gen_random_uuid(), 1;

insert into public.essays (
  id, user_id, school_id, season, prompt, word_limit, created_at, updated_at
)
select seed.essay_id, seed.user_id, schools.id, '2026-2027',
       'Describe a community that has shaped your perspective.', 300,
       '2026-08-03T00:00:00Z', '2026-08-03T00:00:00Z'
from paid_allowance_seed seed
cross join lateral (
  select id from private.schools
  where canonical_name = 'University of Michigan'
) schools;

insert into private.essay_allowance_transactions (
  user_id, entitlement_id, essay_id, season,
  idempotency_key_hmac, request_hmac, created_at
)
select seed.user_id, entitlements.id, seed.essay_id, '2026-2027',
       'v1.' || pg_catalog.rpad(seed.position::text, 43, 'x'),
       'v1.' || pg_catalog.rpad(seed.position::text, 43, 'y'),
       '2026-08-03T00:00:00Z'::timestamptz + seed.position * interval '1 minute'
from paid_allowance_seed seed
join private.entitlements entitlements
  on entitlements.user_id = seed.user_id
 and entitlements.season = '2026-2027'
 and entitlements.kind = case
   when seed.user_id = 'fd000000-0000-4000-8000-000000000001'
     and seed.position > 1 then 'SEASON_PASS'
   else 'FREE'
 end;

select is(
  private.create_essay_workspace(
    'fd000000-0000-4000-8000-000000000001',
    (select id from private.schools where canonical_name = 'University of Michigan'),
    '2026-2027', 'Describe a challenge that changed your perspective.', 300,
    'v1.' || repeat('A', 43), 'v1.' || repeat('B', 43),
    1,
    '2026-08-10T16:00:00Z'
  ) ->> 'decision',
  'CREATED', 'an active pass permits the twentieth seasonal workspace'
);
select is(
  private.create_essay_workspace(
    'fd000000-0000-4000-8000-000000000001',
    (select id from private.schools where canonical_name = 'University of Michigan'),
    '2026-2027', 'Describe a challenge that changed your perspective.', 300,
    'v1.' || repeat('C', 43), 'v1.' || repeat('D', 43),
    '2026-08-10T16:01:00Z'
  ) ->> 'decision',
  'QUOTA_EXCEEDED', 'the twenty-first seasonal workspace is rejected'
);
select is(
  (select count(*) from private.essay_allowance_transactions
   where user_id = 'fd000000-0000-4000-8000-000000000001'
     and season = '2026-2027'),
  20::bigint, 'free and paid consumption share one seasonal ceiling'
);
select is(
  (select count(*) from private.essay_allowance_transactions transactions
   join private.entitlements entitlements on entitlements.id = transactions.entitlement_id
   where transactions.user_id = 'fd000000-0000-4000-8000-000000000001'
     and entitlements.kind = 'SEASON_PASS'),
  19::bigint, 'the ledger preserves which allowance funded each workspace'
);

select is(
  private.create_essay_workspace(
    'fd000000-0000-4000-8000-000000000002',
    (select id from private.schools where canonical_name = 'University of Michigan'),
    '2026-2027', 'Describe a challenge that changed your perspective.', 300,
    'v1.' || repeat('E', 43), 'v1.' || repeat('F', 43),
    '2026-08-10T16:02:00Z'
  ) ->> 'decision',
  'QUOTA_EXCEEDED', 'a refunded pass cannot fund another workspace'
);
select is(
  private.create_essay_workspace(
    'fd000000-0000-4000-8000-000000000003',
    (select id from private.schools where canonical_name = 'University of Michigan'),
    '2026-2027', 'Describe a challenge that changed your perspective.', 300,
    'v1.' || repeat('G', 43), 'v1.' || repeat('H', 43),
    '2026-08-10T16:03:00Z'
  ) ->> 'decision',
  'QUOTA_EXCEEDED', 'a revoked pass cannot fund another workspace'
);

select is(
  private.get_billing_entitlement(
    'fd000000-0000-4000-8000-000000000001', '2026-2027', 1,
    '2026-08-10T16:04:00Z'
  ) ->> 'kind',
  'SEASON_PASS', 'the read model reports an active pass as effective'
);
select is(
  (private.get_billing_entitlement(
    'fd000000-0000-4000-8000-000000000001', '2026-2027', 1,
    '2026-08-10T16:04:00Z'
  ) ->> 'essays_used')::integer,
  20, 'the read model reports total seasonal usage'
);
select is(
  private.get_billing_entitlement(
    'fd000000-0000-4000-8000-000000000002', '2026-2027', 1,
    '2026-08-10T16:04:00Z'
  ) ->> 'kind',
  'FREE', 'a terminal pass falls back to the free entitlement'
);
select is(
  private.get_billing_entitlement(
    'fd000000-0000-4000-8000-000000000002', '2026-2027', 1,
    '2026-08-10T16:04:00Z'
  ) ->> 'season_pass_status',
  'REFUNDED', 'the read model preserves the terminal paid state'
);
select is(
  (private.get_billing_entitlement(
    'fd000000-0000-4000-8000-000000000004', '2026-2027', 1,
    '2026-08-10T16:04:00Z'
  ) ->> 'essays_remaining')::integer,
  1, 'an unused account receives the configured free allowance view'
);

select isnt(
  private.get_essay_workspace(
    'fd000000-0000-4000-8000-000000000002',
    (select essay_id from paid_allowance_seed
     where user_id = 'fd000000-0000-4000-8000-000000000002')
  ),
  null::jsonb, 'terminal entitlement does not hide existing content'
);
select ok(
  private.delete_essay_workspace(
    'fd000000-0000-4000-8000-000000000002',
    (select essay_id from paid_allowance_seed
     where user_id = 'fd000000-0000-4000-8000-000000000002')
  ),
  'terminal entitlement does not block owner deletion'
);
select is(
  (select count(*) from private.essay_allowance_transactions
   where user_id = 'fd000000-0000-4000-8000-000000000002'),
  1::bigint, 'deletion after reversal retains allowance consumption'
);

select * from finish();
rollback;
