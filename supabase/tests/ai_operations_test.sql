begin;

create extension if not exists pgtap with schema extensions;
select plan(35);

select has_table('private', 'ai_operations', 'AI operations table exists');
select has_table('private', 'usage_reservations', 'usage reservations table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'private.ai_operations'::regclass)
  and (select relrowsecurity from pg_class where oid = 'private.usage_reservations'::regclass),
  'AI telemetry tables have defense-in-depth RLS enabled'
);
select ok(
  not has_table_privilege('authenticated', 'private.ai_operations', 'SELECT')
  and not has_table_privilege('authenticated', 'private.ai_operations', 'INSERT')
  and not has_table_privilege('authenticated', 'private.ai_operations', 'UPDATE')
  and not has_table_privilege('authenticated', 'private.usage_reservations', 'SELECT'),
  'authenticated clients have no AI telemetry privileges'
);
select has_function(
  'private',
  'reserve_ai_operation',
  array[
    'uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'text',
    'integer', 'integer', 'integer', 'integer', 'timestamp with time zone'
  ],
  'atomic AI reservation RPC exists'
);
select has_function(
  'private',
  'start_ai_operation',
  array['uuid', 'timestamp with time zone'],
  'provider-start transition RPC exists'
);
select has_function(
  'private',
  'release_ai_operation',
  array['uuid', 'text', 'integer', 'timestamp with time zone'],
  'pre-provider release RPC exists'
);
select has_function(
  'private',
  'finalize_ai_operation',
  array[
    'uuid', 'text', 'integer', 'text', 'text', 'integer', 'integer',
    'integer', 'integer', 'text', 'uuid', 'text', 'timestamp with time zone'
  ],
  'provider completion RPC exists'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.reserve_ai_operation(uuid,uuid,text,text,text,text,text,text,integer,integer,integer,integer,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.start_ai_operation(uuid,timestamptz)',
    'EXECUTE'
  ),
  'authenticated clients cannot invoke reservation transitions directly'
);

insert into auth.users (id, email)
values
  ('40000000-0000-4000-8000-000000000001', 'ai-one@example.test'),
  ('40000000-0000-4000-8000-000000000002', 'ai-two@example.test');

insert into private.beta_invitations (
  normalized_email_hmac,
  status,
  expires_at,
  accepted_user_id
)
values
  (
    'v1.' || repeat('g', 43),
    'ACCEPTED',
    now() + interval '1 day',
    '40000000-0000-4000-8000-000000000001'
  ),
  (
    'v1.' || repeat('h', 43),
    'ACCEPTED',
    now() + interval '1 day',
    '40000000-0000-4000-8000-000000000002'
  );

create temp table first_reservation as
select * from private.reserve_ai_operation(
  '40000000-0000-4000-8000-000000000001',
  null,
  'POST',
  '/api/v1/interview-sessions/current/messages',
  'v1.' || repeat('i', 43),
  'v1.' || repeat('j', 43),
  'v1.' || repeat('k', 43),
  'INTERVIEW_REPLY',
  1,
  2,
  100,
  60,
  '2026-08-02T12:00:00Z'
);

select is(
  (select decision from first_reservation),
  'RESERVED',
  'the first eligible request reserves quota and budget'
);
select is(
  (select count(*) from private.ai_operations),
  1::bigint,
  'one reservation creates one content-free operation'
);
select is(
  (select count(*) from private.usage_reservations),
  1::bigint,
  'one reservation creates one usage row'
);

create temp table first_replay as
select * from private.reserve_ai_operation(
  '40000000-0000-4000-8000-000000000001', null, 'POST',
  '/api/v1/interview-sessions/current/messages',
  'v1.' || repeat('i', 43), 'v1.' || repeat('j', 43),
  'v1.' || repeat('k', 43), 'INTERVIEW_REPLY', 1, 2, 100, 60,
  '2026-08-02T12:00:01Z'
);

select is((select decision from first_replay), 'REPLAY', 'same-key same-body requests replay');
select is(
  (select operation_id from first_replay),
  (select operation_id from first_reservation),
  'an idempotent replay returns the original operation'
);
select is(
  (
    select decision from private.reserve_ai_operation(
      '40000000-0000-4000-8000-000000000001', null, 'POST',
      '/api/v1/interview-sessions/current/messages',
      'v1.' || repeat('i', 43), 'v1.' || repeat('z', 43),
      'v1.' || repeat('k', 43), 'INTERVIEW_REPLY', 1, 2, 100, 60,
      '2026-08-02T12:00:02Z'
    )
  ),
  'IDEMPOTENCY_CONFLICT',
  'same-key changed-body reuse is rejected'
);
select is(
  (
    select decision from private.reserve_ai_operation(
      '40000000-0000-4000-8000-000000000001', null, 'POST',
      '/api/v1/interview-sessions/current/messages',
      'v1.' || repeat('l', 43), 'v1.' || repeat('m', 43),
      'v1.' || repeat('k', 43), 'INTERVIEW_REPLY', 1, 2, 100, 10,
      '2026-08-02T12:00:03Z'
    )
  ),
  'QUOTA_EXCEEDED',
  'daily user and keyed-IP quota is enforced before insert'
);
select is(
  private.release_ai_operation(
    (select operation_id from first_reservation),
    'INPUT_REJECTED',
    422,
    '2026-08-02T12:00:04Z'
  ),
  true,
  'a pre-provider failure releases its operation'
);
select ok(
  (select released_at is not null from private.usage_reservations where operation_id = (select operation_id from first_reservation)),
  'a pre-provider failure releases reserved quota and budget'
);

create temp table started_reservation as
select * from private.reserve_ai_operation(
  '40000000-0000-4000-8000-000000000001', null, 'POST',
  '/api/v1/interview-sessions/current/messages',
  'v1.' || repeat('l', 43), 'v1.' || repeat('m', 43),
  'v1.' || repeat('k', 43), 'INTERVIEW_REPLY', 10, 2, 100, 30,
  '2026-08-02T12:00:05Z'
);

select is((select decision from started_reservation), 'RESERVED', 'released quota is immediately reusable');
select is(
  private.start_ai_operation(
    (select operation_id from started_reservation),
    '2026-08-02T12:00:06Z'
  ),
  'STARTED',
  'the provider-start transition succeeds once'
);
select is(
  private.finalize_ai_operation(
    (select operation_id from started_reservation),
    'REFUSED', 502, 'resp_synthetic', 'gpt-synthetic', 10, 2, 25, 40,
    null, null, 'PROVIDER_REFUSED', '2026-08-02T12:00:07Z'
  ),
  true,
  'a refused provider call finalizes the operation'
);
select is(
  private.release_ai_operation(
    (select operation_id from started_reservation),
    'SHOULD_NOT_RELEASE', 500, '2026-08-02T12:00:08Z'
  ),
  false,
  'a provider-started operation cannot release quota'
);
select ok(
  (
    select operations.status = 'REFUSED' and reservations.released_at is null
    from private.ai_operations operations
    join private.usage_reservations reservations on reservations.operation_id = operations.id
    where operations.id = (select operation_id from started_reservation)
  ),
  'refused calls permanently consume their reservation'
);
select is(
  (
    select decision from private.reserve_ai_operation(
      '40000000-0000-4000-8000-000000000002', null, 'POST',
      '/api/v1/interview-sessions/current/messages',
      'v1.' || repeat('n', 43), 'v1.' || repeat('o', 43),
      'v1.' || repeat('p', 43), 'INTERVIEW_REPLY', 10, 2, 100, 61,
      '2026-08-02T12:00:09Z'
    )
  ),
  'BUDGET_EXHAUSTED',
  'the global monthly budget counts finalized cost atomically'
);

create temp table fallback_one as
select * from private.reserve_ai_operation(
  '40000000-0000-4000-8000-000000000001',
  '50000000-0000-4000-8000-000000000001',
  'POST', '/api/v1/essays/{essayId}/reference-draft',
  'v1.' || repeat('q', 43), 'v1.' || repeat('r', 43),
  'v1.' || repeat('k', 43), 'REFERENCE_DRAFT', 10, 2, 100, 0,
  '2026-08-02T12:00:10Z'
);

select is((select decision from fallback_one), 'RESERVED', 'the first fallback can reserve');
select is(
  private.start_ai_operation(
    (select operation_id from fallback_one),
    '2026-08-02T12:00:11Z'
  ),
  'STARTED',
  'the first fallback atomically acquires its one-time slot'
);
select is(
  (
    select decision from private.reserve_ai_operation(
      '40000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000001',
      'POST', '/api/v1/essays/{essayId}/reference-draft',
      'v1.' || repeat('s', 43), 'v1.' || repeat('t', 43),
      'v1.' || repeat('k', 43), 'REFERENCE_DRAFT', 10, 2, 100, 0,
      '2026-08-02T12:00:12Z'
    )
  ),
  'FALLBACK_LIMIT_REACHED',
  'a second fallback cannot reserve after provider start'
);

create temp table successful_reservation as
select * from private.reserve_ai_operation(
  '40000000-0000-4000-8000-000000000002', null, 'POST',
  '/api/v1/synthetic-success',
  'v1.' || repeat('u', 43), 'v1.' || repeat('v', 43),
  'v1.' || repeat('p', 43), 'FINAL_REVIEW', 10, 2, 100, 0,
  '2026-08-02T12:00:13Z'
);
select is((select decision from successful_reservation), 'RESERVED', 'a successful operation reserves');
select is(
  private.start_ai_operation(
    (select operation_id from successful_reservation),
    '2026-08-02T12:00:14Z'
  ),
  'STARTED',
  'a successful operation starts'
);
select is(
  private.finalize_ai_operation(
    (select operation_id from successful_reservation),
    'SUCCEEDED', 201, 'resp_success', 'gpt-synthetic', 10, 3, 20, 0,
    'AUDIT', '60000000-0000-4000-8000-000000000001', null,
    '2026-08-02T12:00:15Z'
  ),
  true,
  'a successful operation records only resource identity and telemetry'
);
select results_eq(
  $$select decision, operation_status, result_resource_type, result_resource_id, original_http_status from private.reserve_ai_operation('40000000-0000-4000-8000-000000000002', null, 'POST', '/api/v1/synthetic-success', 'v1.' || repeat('u', 43), 'v1.' || repeat('v', 43), 'v1.' || repeat('p', 43), 'FINAL_REVIEW', 10, 2, 100, 0, '2026-08-02T12:00:16Z')$$,
  $$values ('REPLAY'::text, 'SUCCEEDED'::text, 'AUDIT'::text, '60000000-0000-4000-8000-000000000001'::uuid, 201)$$,
  'completed replay returns the original resource representation identity'
);
select is(
  (select reset_at from first_reservation),
  '2026-08-03T00:00:00Z'::timestamptz,
  'daily quota reset is the next UTC midnight'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name in ('ai_operations', 'usage_reservations')
      and column_name ~ '(content|prompt|answer|draft|response_text|request_body)'
  ),
  'operation telemetry has no student-content columns'
);
select ok(
  not exists (
    select 1
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'ai_operations'
      and column_name = 'idempotency_key'
  ),
  'only a keyed idempotency HMAC is stored'
);
select throws_ok(
  $$select * from private.reserve_ai_operation('40000000-0000-4000-8000-000000000001', null, 'POST', '/api/v1/test', 'raw-key', 'v1.' || repeat('w', 43), 'v1.' || repeat('x', 43), 'COACHING', 10, 2, 100, 1, '2026-08-02T12:00:17Z')$$,
  '22023',
  'invalid AI reservation input',
  'raw or malformed identifiers are rejected'
);

select * from finish();
rollback;
