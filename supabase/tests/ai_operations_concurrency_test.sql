create extension if not exists pgtap with schema extensions;
create extension if not exists dblink with schema extensions;

select plan(3);

select extensions.dblink_connect(
  'ai_limit_a',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'ai_limit_b',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);

select extensions.dblink_exec(
  'ai_limit_a',
  $$
    delete from private.beta_invitations
    where accepted_user_id in (
      '80000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000003'
    );
    delete from auth.users
    where id in (
      '80000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000003'
    );
    insert into auth.users (id, email)
    values
      ('80000000-0000-4000-8000-000000000001', 'concurrent-a@example.test'),
      ('80000000-0000-4000-8000-000000000002', 'concurrent-b@example.test'),
      ('80000000-0000-4000-8000-000000000003', 'concurrent-c@example.test');
    insert into private.beta_invitations (
      normalized_email_hmac,
      status,
      expires_at,
      accepted_user_id
    )
    values
      ('v1.' || repeat('1', 43), 'ACCEPTED', now() + interval '1 day', '80000000-0000-4000-8000-000000000001'),
      ('v1.' || repeat('2', 43), 'ACCEPTED', now() + interval '1 day', '80000000-0000-4000-8000-000000000002'),
      ('v1.' || repeat('3', 43), 'ACCEPTED', now() + interval '1 day', '80000000-0000-4000-8000-000000000003');
  $$
);

select extensions.dblink_send_query(
  'ai_limit_a',
  $$select * from private.reserve_ai_operation(
    '80000000-0000-4000-8000-000000000001', null, 'POST', '/api/v1/concurrent-budget',
    'v1.' || repeat('4', 43), 'v1.' || repeat('5', 43), 'v1.' || repeat('6', 43),
    'COACHING', 10, 3, 100, 60, '2026-08-02T13:00:00Z'
  )$$
);
select extensions.dblink_send_query(
  'ai_limit_b',
  $$select * from private.reserve_ai_operation(
    '80000000-0000-4000-8000-000000000002', null, 'POST', '/api/v1/concurrent-budget',
    'v1.' || repeat('7', 43), 'v1.' || repeat('8', 43), 'v1.' || repeat('9', 43),
    'COACHING', 10, 3, 100, 60, '2026-08-02T13:00:00Z'
  )$$
);

create temp table concurrent_budget_results (decision text);
insert into concurrent_budget_results
select decision
from extensions.dblink_get_result('ai_limit_a') as result(
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
);
insert into concurrent_budget_results
select decision
from extensions.dblink_get_result('ai_limit_b') as result(
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
);
select count(*)
from extensions.dblink_get_result('ai_limit_a') as drained(
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
);
select count(*)
from extensions.dblink_get_result('ai_limit_b') as drained(
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
);

select results_eq(
  $$select decision, count(*) from concurrent_budget_results group by decision order by decision$$,
  $$values ('BUDGET_EXHAUSTED'::text, 1::bigint), ('RESERVED'::text, 1::bigint)$$,
  'simultaneous users cannot exceed the global monthly budget'
);

select extensions.dblink_disconnect('ai_limit_a');
select extensions.dblink_disconnect('ai_limit_b');
select extensions.dblink_connect(
  'ai_limit_a',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'ai_limit_b',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);

select extensions.dblink_send_query(
  'ai_limit_a',
  $$select * from private.reserve_ai_operation(
    '80000000-0000-4000-8000-000000000003', null, 'POST', '/api/v1/concurrent-user',
    'v1.' || repeat('a', 43), 'v1.' || repeat('b', 43), 'v1.' || repeat('c', 43),
    'COACHING', 1, 3, 1000, 0, '2026-08-03T13:00:00Z'
  )$$
);
select extensions.dblink_send_query(
  'ai_limit_b',
  $$select * from private.reserve_ai_operation(
    '80000000-0000-4000-8000-000000000003', null, 'POST', '/api/v1/concurrent-user',
    'v1.' || repeat('d', 43), 'v1.' || repeat('e', 43), 'v1.' || repeat('c', 43),
    'COACHING', 1, 3, 1000, 0, '2026-08-03T13:00:00Z'
  )$$
);

create temp table concurrent_user_results (decision text);
insert into concurrent_user_results
select decision
from extensions.dblink_get_result('ai_limit_a') as result(
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
);
insert into concurrent_user_results
select decision
from extensions.dblink_get_result('ai_limit_b') as result(
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
);
select count(*)
from extensions.dblink_get_result('ai_limit_a') as drained(
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
);
select count(*)
from extensions.dblink_get_result('ai_limit_b') as drained(
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
);

select results_eq(
  $$select decision, count(*) from concurrent_user_results group by decision order by decision$$,
  $$values ('QUOTA_EXCEEDED'::text, 1::bigint), ('RESERVED'::text, 1::bigint)$$,
  'simultaneous requests for one user cannot exceed the daily quota'
);

select extensions.dblink_disconnect('ai_limit_a');
select extensions.dblink_disconnect('ai_limit_b');
select extensions.dblink_connect(
  'ai_limit_a',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);
select extensions.dblink_connect(
  'ai_limit_b',
  'host=host.docker.internal port=54322 dbname=postgres user=postgres password=postgres'
);

select extensions.dblink_send_query(
  'ai_limit_a',
  $$select * from private.reserve_ai_operation(
    '80000000-0000-4000-8000-000000000001', null, 'POST', '/api/v1/concurrent-ip',
    'v1.' || repeat('f', 43), 'v1.' || repeat('g', 43), 'v1.' || repeat('y', 43),
    'COACHING', 1, 3, 1000, 0, '2026-08-04T13:00:00Z'
  )$$
);
select extensions.dblink_send_query(
  'ai_limit_b',
  $$select * from private.reserve_ai_operation(
    '80000000-0000-4000-8000-000000000002', null, 'POST', '/api/v1/concurrent-ip',
    'v1.' || repeat('h', 43), 'v1.' || repeat('i', 43), 'v1.' || repeat('y', 43),
    'COACHING', 1, 3, 1000, 0, '2026-08-04T13:00:00Z'
  )$$
);

create temp table concurrent_ip_results (decision text);
insert into concurrent_ip_results
select decision
from extensions.dblink_get_result('ai_limit_a') as result(
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
);
insert into concurrent_ip_results
select decision
from extensions.dblink_get_result('ai_limit_b') as result(
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
);
select count(*)
from extensions.dblink_get_result('ai_limit_a') as drained(
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
);
select count(*)
from extensions.dblink_get_result('ai_limit_b') as drained(
  decision text,
  operation_id uuid,
  operation_status text,
  result_resource_type text,
  result_resource_id uuid,
  original_http_status integer,
  reset_at timestamptz
);

select results_eq(
  $$select decision, count(*) from concurrent_ip_results group by decision order by decision$$,
  $$values ('QUOTA_EXCEEDED'::text, 1::bigint), ('RESERVED'::text, 1::bigint)$$,
  'simultaneous users sharing one keyed IP cannot exceed its daily quota'
);

select extensions.dblink_exec(
  'ai_limit_a',
  $$delete from private.beta_invitations
    where accepted_user_id in (
      '80000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000003'
    );
    delete from auth.users
    where id in (
      '80000000-0000-4000-8000-000000000001',
      '80000000-0000-4000-8000-000000000002',
      '80000000-0000-4000-8000-000000000003'
    )$$
);
select extensions.dblink_disconnect('ai_limit_a');
select extensions.dblink_disconnect('ai_limit_b');

select * from finish();
