begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

select has_table('private', 'schools', 'private school registry exists');
select has_table('public', 'school_requests', 'school requests table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'private.schools'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.school_requests'::regclass),
  'registry and requests have defense-in-depth RLS'
);
select is((select count(*) from private.schools), 12::bigint, 'twelve verified schools are seeded');
select is(
  (select count(*) from private.schools where status = 'ACTIVE'
    and verification_source_url like 'https://%'
    and verifier_id <> '' and verified_at is not null),
  12::bigint,
  'every active school carries operator verification evidence'
);
select is(
  (select count(distinct normalized_domain) from private.schools),
  (select count(*) from private.schools),
  'normalized official domains are unique'
);
select results_eq(
  $$select canonical_name from private.search_schools('', null, null, 3)$$,
  $$values ('Brown University'::text), ('Columbia University'::text), ('Cornell University'::text)$$,
  'registry search has stable normalized-name ordering'
);
select results_eq(
  $$select official_domain from private.search_schools('michigan', null, null, 20)$$,
  $$values ('umich.edu'::text)$$,
  'registry search returns only matching active schools'
);
select ok(
  not has_table_privilege('authenticated', 'private.schools', 'SELECT')
  and not has_table_privilege('authenticated', 'private.schools', 'INSERT')
  and not has_table_privilege('authenticated', 'private.schools', 'UPDATE')
  and not has_table_privilege('authenticated', 'private.schools', 'DELETE'),
  'users cannot read or mutate registry storage directly'
);
select ok(
  has_table_privilege('authenticated', 'public.school_requests', 'SELECT')
  and not has_table_privilege('authenticated', 'public.school_requests', 'INSERT')
  and not has_table_privilege('authenticated', 'public.school_requests', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.school_requests', 'DELETE'),
  'users can read only their requests and cannot control request status'
);
select ok(
  not has_function_privilege('authenticated', 'private.search_schools(text,text,uuid,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.create_school_request(uuid,text,text,text,text,timestamptz)', 'EXECUTE'),
  'users cannot bypass server-owned registry RPCs'
);

insert into auth.users (id, email)
values
  ('f0000000-0000-4000-8000-000000000001', 'school-owner@example.test'),
  ('f0000000-0000-4000-8000-000000000002', 'school-other@example.test');

select is(
  private.create_school_request(
    'f0000000-0000-4000-8000-000000000001', 'Unsupported College',
    'https://unsupported.example.edu',
    'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    '2026-08-02T23:00:00Z'
  ) ->> 'decision',
  'CREATED',
  'the server can create an owner-scoped unsupported-school request'
);
select is(
  private.create_school_request(
    'f0000000-0000-4000-8000-000000000001', 'Unsupported College',
    'https://unsupported.example.edu',
    'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'v1.BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    '2026-08-02T23:00:01Z'
  ) ->> 'decision',
  'REPLAY',
  'same-key same-body request replays without duplication'
);
select is(
  private.create_school_request(
    'f0000000-0000-4000-8000-000000000001', 'Different College', null,
    'v1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    'v1.CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC',
    '2026-08-02T23:00:02Z'
  ) ->> 'decision',
  'IDEMPOTENCY_KEY_REUSED',
  'same-key changed-body request is rejected'
);
select is((select count(*) from public.school_requests), 1::bigint, 'idempotent replay creates one row');

set local role authenticated;
set local request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000001';
select is((select count(*) from public.school_requests), 1::bigint, 'the owner can read the request');
set local request.jwt.claim.sub = 'f0000000-0000-4000-8000-000000000002';
select is((select count(*) from public.school_requests), 0::bigint, 'another user cannot read the request');
reset role;

select * from finish();
rollback;
