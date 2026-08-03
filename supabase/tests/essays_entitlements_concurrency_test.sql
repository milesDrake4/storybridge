create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(2);

select extensions.dblink_connect(
  'essay_allowance_a',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'essay_allowance_b',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);

select extensions.dblink_exec(
  'essay_allowance_a',
  $$
    delete from private.beta_invitations
    where accepted_user_id = 'e1000000-0000-4000-8000-000000000001';
    delete from auth.users
    where id = 'e1000000-0000-4000-8000-000000000001';
    insert into auth.users (id, email)
    values ('e1000000-0000-4000-8000-000000000001', 'essay-concurrent@example.test');
    insert into private.beta_invitations (
      normalized_email_hmac, status, expires_at, accepted_user_id
    ) values (
      'v1.' || repeat('q', 43), 'ACCEPTED', now() + interval '1 day',
      'e1000000-0000-4000-8000-000000000001'
    );
  $$
);

select extensions.dblink_send_query(
  'essay_allowance_a',
  $$select private.create_essay_workspace(
    'e1000000-0000-4000-8000-000000000001',
    (select id from private.schools where canonical_name = 'University of Michigan'),
    '2026-2027', 'Describe a community that has shaped your perspective.', 300,
    'v1.' || repeat('L', 43), 'v1.' || repeat('M', 43), '2026-08-03T15:00:00Z'
  )$$
);
select extensions.dblink_send_query(
  'essay_allowance_b',
  $$select private.create_essay_workspace(
    'e1000000-0000-4000-8000-000000000001',
    (select id from private.schools where canonical_name = 'University of Michigan'),
    '2026-2027', 'Describe a community that has shaped your perspective.', 300,
    'v1.' || repeat('N', 43), 'v1.' || repeat('O', 43), '2026-08-03T15:00:00Z'
  )$$
);

create temp table concurrent_essay_results (decision text);
insert into concurrent_essay_results
select result ->> 'decision'
from extensions.dblink_get_result('essay_allowance_a') as response(result jsonb);
insert into concurrent_essay_results
select result ->> 'decision'
from extensions.dblink_get_result('essay_allowance_b') as response(result jsonb);
select count(*) from extensions.dblink_get_result('essay_allowance_a') as drained(result jsonb);
select count(*) from extensions.dblink_get_result('essay_allowance_b') as drained(result jsonb);

select results_eq(
  $$select decision, count(*) from concurrent_essay_results group by decision order by decision$$,
  $$values ('CREATED'::text, 1::bigint), ('QUOTA_EXCEEDED'::text, 1::bigint)$$,
  'simultaneous workspace creation cannot exceed the free allowance'
);
select is(
  (
    select count(*)
    from private.essay_allowance_transactions
    where user_id = 'e1000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'concurrent creation records exactly one consumption'
);

select extensions.dblink_exec(
  'essay_allowance_a',
  $$
    delete from private.beta_invitations
    where accepted_user_id = 'e1000000-0000-4000-8000-000000000001';
    delete from auth.users
    where id = 'e1000000-0000-4000-8000-000000000001';
  $$
);
select extensions.dblink_disconnect('essay_allowance_a');
select extensions.dblink_disconnect('essay_allowance_b');

select * from finish();
