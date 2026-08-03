begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

select has_table('private', 'entitlements', 'private entitlements table exists');
select has_table('public', 'essays', 'essay workspaces table exists');
select has_table(
  'private',
  'essay_allowance_transactions',
  'private allowance ledger exists'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.entitlements'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.essays'::regclass)
  and (select relrowsecurity from pg_class where oid = 'private.essay_allowance_transactions'::regclass),
  'essay storage has defense-in-depth RLS'
);
select ok(
  not has_table_privilege('authenticated', 'private.entitlements', 'SELECT')
  and not has_table_privilege('authenticated', 'private.essay_allowance_transactions', 'SELECT'),
  'browser roles cannot inspect entitlement internals'
);
select ok(
  has_table_privilege('authenticated', 'public.essays', 'SELECT')
  and not has_table_privilege('authenticated', 'public.essays', 'INSERT')
  and not has_table_privilege('authenticated', 'public.essays', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.essays', 'DELETE'),
  'browser roles can read only and cannot mutate essays directly'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'private.create_essay_workspace(uuid,uuid,text,text,integer,text,text,timestamptz)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.list_essay_workspaces(uuid,timestamptz,uuid,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.get_essay_workspace(uuid,uuid)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'private.delete_essay_workspace(uuid,uuid)',
    'EXECUTE'
  ),
  'browser roles cannot bypass the server-owned creation RPC'
);

insert into auth.users (id, email)
values
  ('e0000000-0000-4000-8000-000000000001', 'essay-owner@example.test'),
  ('e0000000-0000-4000-8000-000000000002', 'essay-other@example.test'),
  ('e0000000-0000-4000-8000-000000000003', 'essay-ineligible@example.test');

insert into private.beta_invitations (
  normalized_email_hmac, status, expires_at, accepted_user_id
)
values
  ('v1.' || repeat('e', 43), 'ACCEPTED', now() + interval '1 day', 'e0000000-0000-4000-8000-000000000001'),
  ('v1.' || repeat('f', 43), 'ACCEPTED', now() + interval '1 day', 'e0000000-0000-4000-8000-000000000002');

create temp table selected_school as
select id from private.schools where canonical_name = 'University of Michigan';

create temp table created_workspace as
select private.create_essay_workspace(
  'e0000000-0000-4000-8000-000000000001',
  (select id from selected_school),
  '2026-2027',
  'Describe a community that has shaped your perspective.',
  300,
  'v1.' || repeat('A', 43),
  'v1.' || repeat('B', 43),
  '2026-08-03T14:00:00Z'
) as data;

select is(
  (select data ->> 'decision' from created_workspace),
  'CREATED',
  'an eligible user can create a free essay workspace'
);
select is((select count(*) from private.entitlements), 1::bigint, 'creation lazily provisions one entitlement');
select is((select essay_limit from private.entitlements), 1, 'the free entitlement allows one essay');
select is((select count(*) from public.essays), 1::bigint, 'creation persists one essay');
select is(
  (select count(*) from private.essay_allowance_transactions),
  1::bigint,
  'creation permanently records one allowance consumption'
);
select is(
  private.create_essay_workspace(
    'e0000000-0000-4000-8000-000000000001', (select id from selected_school),
    '2026-2027', 'Describe a community that has shaped your perspective.', 300,
    'v1.' || repeat('A', 43), 'v1.' || repeat('B', 43), '2026-08-03T14:00:01Z'
  ) ->> 'decision',
  'REPLAY',
  'same-key same-body creation replays'
);
select is(
  private.create_essay_workspace(
    'e0000000-0000-4000-8000-000000000001', (select id from selected_school),
    '2026-2027', 'Describe a different community that shaped your perspective.', 300,
    'v1.' || repeat('A', 43), 'v1.' || repeat('C', 43), '2026-08-03T14:00:02Z'
  ) ->> 'decision',
  'IDEMPOTENCY_KEY_REUSED',
  'same-key changed-body creation is rejected'
);
select is(
  private.create_essay_workspace(
    'e0000000-0000-4000-8000-000000000001', (select id from selected_school),
    '2026-2027', 'Describe a community that has shaped your perspective.', 300,
    'v1.' || repeat('D', 43), 'v1.' || repeat('E', 43), '2026-08-03T14:00:03Z'
  ) ->> 'decision',
  'QUOTA_EXCEEDED',
  'a second free workspace is rejected'
);
select is((select count(*) from public.essays), 1::bigint, 'rejections create no extra essays');
select is(
  private.create_essay_workspace(
    'e0000000-0000-4000-8000-000000000002', gen_random_uuid(),
    '2026-2027', 'Describe a community that has shaped your perspective.', 300,
    'v1.' || repeat('F', 43), 'v1.' || repeat('G', 43), '2026-08-03T14:00:04Z'
  ) ->> 'decision',
  'UNSUPPORTED_SCHOOL',
  'only active registry schools can own workspaces'
);
select is(
  private.create_essay_workspace(
    'e0000000-0000-4000-8000-000000000003', (select id from selected_school),
    '2026-2027', 'Describe a community that has shaped your perspective.', 300,
    'v1.' || repeat('H', 43), 'v1.' || repeat('I', 43), '2026-08-03T14:00:05Z'
  ) ->> 'decision',
  'NOT_ELIGIBLE',
  'users without an accepted invitation are ineligible'
);

delete from public.essays
where id = ((select data -> 'essay' ->> 'id' from created_workspace)::uuid);
select is((select count(*) from public.essays), 0::bigint, 'an essay can be deleted');
select is((select count(*) from private.essay_allowance_transactions), 1::bigint, 'deletion retains allowance history');
select is(
  private.create_essay_workspace(
    'e0000000-0000-4000-8000-000000000001', (select id from selected_school),
    '2026-2027', 'Describe a community that has shaped your perspective.', 300,
    'v1.' || repeat('J', 43), 'v1.' || repeat('K', 43), '2026-08-03T14:00:06Z'
  ) ->> 'decision',
  'QUOTA_EXCEEDED',
  'deleting an essay does not restore its allowance'
);

insert into public.essays (
  user_id, school_id, season, prompt, word_limit, created_at, updated_at
)
values (
  'e0000000-0000-4000-8000-000000000001', (select id from selected_school),
  '2026-2027', 'Describe a community that has shaped your perspective.', 300,
  '2026-08-03T14:01:00Z', '2026-08-03T14:01:00Z'
);

select isnt(
  private.get_essay_workspace(
    'e0000000-0000-4000-8000-000000000001',
    (select id from public.essays)
  ),
  null::jsonb,
  'the owner-scoped repository query returns its workspace'
);
select is(
  private.get_essay_workspace(
    'e0000000-0000-4000-8000-000000000002',
    (select id from public.essays)
  ),
  null::jsonb,
  'the repository query masks a cross-owner workspace as missing'
);
select is(
  (
    select count(*)
    from private.list_essay_workspaces(
      'e0000000-0000-4000-8000-000000000001', null, null, 20
    )
  ),
  1::bigint,
  'the owner-scoped repository list returns its workspace'
);
select is(
  (
    select count(*)
    from private.list_essay_workspaces(
      'e0000000-0000-4000-8000-000000000002', null, null, 20
    )
  ),
  0::bigint,
  'the repository list cannot cross owner scope'
);

set local role authenticated;
set local request.jwt.claim.sub = 'e0000000-0000-4000-8000-000000000001';
select is((select count(*) from public.essays), 1::bigint, 'the owner can read their essay');
set local request.jwt.claim.sub = 'e0000000-0000-4000-8000-000000000002';
select is((select count(*) from public.essays), 0::bigint, 'another user cannot read the essay');
reset role;

select ok(
  not private.delete_essay_workspace(
    'e0000000-0000-4000-8000-000000000002',
    (select id from public.essays)
  ),
  'cross-owner deletion is masked as an idempotent miss'
);
select ok(
  private.delete_essay_workspace(
    'e0000000-0000-4000-8000-000000000001',
    (select id from public.essays)
  ),
  'the owner-scoped repository can delete its workspace'
);
select is((select count(*) from public.essays), 0::bigint, 'owner deletion removes the workspace');

select * from finish();
rollback;
