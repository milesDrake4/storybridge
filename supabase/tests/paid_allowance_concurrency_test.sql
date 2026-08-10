create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(2);

select extensions.dblink_connect(
  'paid_allowance_a',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'paid_allowance_b',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);

select extensions.dblink_exec(
  'paid_allowance_a',
  $$
    delete from private.beta_invitations
    where accepted_user_id = 'fe000000-0000-4000-8000-000000000001';
    delete from auth.users
    where id = 'fe000000-0000-4000-8000-000000000001';
    insert into auth.users (id, email)
    values ('fe000000-0000-4000-8000-000000000001', 'paid-concurrent@example.test');
    insert into private.beta_invitations (
      normalized_email_hmac, status, expires_at, accepted_user_id
    ) values (
      'v1.' || repeat('z', 43), 'ACCEPTED', now() + interval '1 day',
      'fe000000-0000-4000-8000-000000000001'
    );
    insert into private.entitlements (
      user_id, kind, season, essay_limit, status, starts_at,
      stripe_checkout_session_id
    ) values
      ('fe000000-0000-4000-8000-000000000001', 'FREE', '2026-2027', 1,
       'ACTIVE', '2026-08-01T00:00:00Z', null),
      ('fe000000-0000-4000-8000-000000000001', 'SEASON_PASS', '2026-2027', 20,
       'ACTIVE', '2026-08-02T00:00:00Z', 'cs_test_paid_concurrent');
    insert into public.essays (
      id, user_id, school_id, season, prompt, word_limit
    )
    select (
             'fe100000-0000-4000-8000-'
             || pg_catalog.lpad(value::text, 12, '0')
           )::uuid,
           'fe000000-0000-4000-8000-000000000001', schools.id,
           '2026-2027', 'Describe a community that has shaped your perspective.', 300
    from generate_series(1, 19) value
    cross join lateral (
      select id from private.schools
      where canonical_name = 'University of Michigan'
    ) schools;
    insert into private.essay_allowance_transactions (
      user_id, entitlement_id, essay_id, season,
      idempotency_key_hmac, request_hmac
    )
    select 'fe000000-0000-4000-8000-000000000001', entitlements.id,
           essays.id, '2026-2027',
           'v1.' || pg_catalog.rpad(value::text, 43, 'x'),
           'v1.' || pg_catalog.rpad(value::text, 43, 'y')
    from generate_series(1, 19) value
    join public.essays essays on essays.id = (
      'fe100000-0000-4000-8000-'
      || pg_catalog.lpad(value::text, 12, '0')
    )::uuid
    join private.entitlements entitlements
      on entitlements.user_id = essays.user_id
     and entitlements.kind = case when value = 1 then 'FREE' else 'SEASON_PASS' end;
  $$
);

select extensions.dblink_send_query(
  'paid_allowance_a',
  $$select private.create_essay_workspace(
    'fe000000-0000-4000-8000-000000000001',
    (select id from private.schools where canonical_name = 'University of Michigan'),
    '2026-2027', 'Describe a challenge that changed your perspective.', 300,
    'v1.' || repeat('A', 43), 'v1.' || repeat('B', 43),
    1,
    '2026-08-10T17:00:00Z'
  )$$
);
select extensions.dblink_send_query(
  'paid_allowance_b',
  $$select private.create_essay_workspace(
    'fe000000-0000-4000-8000-000000000001',
    (select id from private.schools where canonical_name = 'University of Michigan'),
    '2026-2027', 'Describe a challenge that changed your perspective.', 300,
    'v1.' || repeat('C', 43), 'v1.' || repeat('D', 43),
    1,
    '2026-08-10T17:00:00Z'
  )$$
);

create temp table concurrent_paid_results (decision text);
insert into concurrent_paid_results
select result ->> 'decision'
from extensions.dblink_get_result('paid_allowance_a') as response(result jsonb);
insert into concurrent_paid_results
select result ->> 'decision'
from extensions.dblink_get_result('paid_allowance_b') as response(result jsonb);
select count(*) from extensions.dblink_get_result('paid_allowance_a') as drained(result jsonb);
select count(*) from extensions.dblink_get_result('paid_allowance_b') as drained(result jsonb);

select results_eq(
  $$select decision, count(*) from concurrent_paid_results group by decision order by decision$$,
  $$values ('CREATED'::text, 1::bigint), ('QUOTA_EXCEEDED'::text, 1::bigint)$$,
  'simultaneous paid creation cannot exceed the twentieth workspace'
);
select is(
  (select count(*) from private.essay_allowance_transactions
   where user_id = 'fe000000-0000-4000-8000-000000000001'
     and season = '2026-2027'),
  20::bigint, 'concurrent paid creation records exactly twenty consumptions'
);

select extensions.dblink_exec(
  'paid_allowance_a',
  $$
    delete from private.beta_invitations
    where accepted_user_id = 'fe000000-0000-4000-8000-000000000001';
    delete from auth.users
    where id = 'fe000000-0000-4000-8000-000000000001';
  $$
);
select extensions.dblink_disconnect('paid_allowance_a');
select extensions.dblink_disconnect('paid_allowance_b');

select * from finish();
