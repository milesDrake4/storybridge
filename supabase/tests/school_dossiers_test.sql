begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

select has_table('public', 'school_dossiers', 'school dossiers table exists');
select has_table('public', 'school_dossier_sources', 'dossier sources table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.school_dossiers'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.school_dossier_sources'::regclass),
  'dossier tables have RLS enabled'
);
select ok(
  has_table_privilege('authenticated', 'public.school_dossiers', 'SELECT')
  and not has_table_privilege('authenticated', 'public.school_dossiers', 'INSERT')
  and not has_table_privilege('authenticated', 'public.school_dossier_sources', 'UPDATE'),
  'browser roles can read owned evidence but cannot mutate it'
);
select ok(
  not has_function_privilege('authenticated', 'private.get_school_dossier(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.get_school_dossier_for_essay(uuid,uuid)', 'EXECUTE')
  and not has_function_privilege(
    'authenticated',
    'private.commit_school_dossier(uuid,uuid,uuid,jsonb,text,text,integer,integer,integer,integer,timestamptz)',
    'EXECUTE'
  ),
  'browser roles cannot bypass server-owned dossier functions'
);

insert into auth.users (id, email)
values
  ('c0000000-0000-4000-8000-000000000001', 'dossier-owner@example.test'),
  ('c0000000-0000-4000-8000-000000000002', 'dossier-other@example.test');
insert into private.beta_invitations (normalized_email_hmac, status, expires_at, accepted_user_id)
values
  ('v1.' || repeat('r', 43), 'ACCEPTED', now() + interval '1 day', 'c0000000-0000-4000-8000-000000000001'),
  ('v1.' || repeat('s', 43), 'ACCEPTED', now() + interval '1 day', 'c0000000-0000-4000-8000-000000000002');

create temp table dossier_essay as
select (private.create_essay_workspace(
  'c0000000-0000-4000-8000-000000000001',
  (select id from private.schools where canonical_name = 'University of Michigan'),
  '2026-2027', 'Describe a community that has shaped your perspective.', 300,
  'v1.' || repeat('A', 43), 'v1.' || repeat('B', 43), '2026-08-03T18:00:00Z'
) -> 'essay' ->> 'id')::uuid as id;

create temp table dossier_operation as
select operation_id from private.reserve_ai_operation(
  'c0000000-0000-4000-8000-000000000001', (select id from dossier_essay),
  'POST', '/api/v1/essays/{essayId}/research', 'v1.' || repeat('C', 43),
  'v1.' || repeat('D', 43), 'v1.' || repeat('E', 43), 'SCHOOL_RESEARCH',
  50, 25, 15000, 25, '2026-08-03T18:00:01Z'
);
select is(
  private.start_ai_operation((select operation_id from dossier_operation), '2026-08-03T18:00:02Z'),
  'STARTED',
  'research operation starts before provider work'
);

create temp table committed_dossier as
select private.commit_school_dossier(
  'c0000000-0000-4000-8000-000000000001', (select id from dossier_essay),
  (select operation_id from dossier_operation),
  jsonb_build_object(
    'schemaVersion', '1',
    'summary', 'Evidence-backed overview.',
    'sources', jsonb_build_array(jsonb_build_object(
      'category', 'ACADEMICS',
      'claim', 'Students can pursue interdisciplinary study.',
      'title', 'Academics at Michigan',
      'supportingExcerpt', 'Students can pursue interdisciplinary study across schools.',
      'normalizedUrl', 'https://umich.edu/academics',
      'retrievedAt', '2026-08-03T17:55:00Z'
    ))
  ),
  'provider-request', 'research-model', 100, 50, 1200, 25,
  '2026-08-03T18:00:03Z'
) as data;

select is((select data ->> 'decision' from committed_dossier), 'CREATED', 'valid evidence commits');
select is((select count(*) from public.school_dossiers), 1::bigint, 'one dossier persists');
select is((select count(*) from public.school_dossier_sources), 1::bigint, 'all evidence sources persist');
select isnt((select dossier_id from public.essays), null::uuid, 'essay binds the ready dossier');
select is((select revision from public.essays), 1, 'dossier binding advances essay revision');
select is((select status from private.ai_operations), 'SUCCEEDED', 'operation succeeds in the same commit');
select is((select result_resource_type from private.ai_operations), 'SCHOOL_DOSSIER', 'operation links the dossier type');
select is((select finalized_at is not null from private.usage_reservations), true, 'usage finalizes atomically');
select is(
  private.commit_school_dossier(
    'c0000000-0000-4000-8000-000000000001', (select id from dossier_essay),
    (select operation_id from dossier_operation),
    '{}'::jsonb, 'changed', 'changed', 0, 0, 0, 0, '2026-08-03T18:00:04Z'
  ) ->> 'decision',
  'REPLAY',
  'operation replay returns the immutable dossier'
);
select is((select count(*) from public.school_dossiers), 1::bigint, 'replay creates no duplicate dossier');
select isnt(
  private.get_school_dossier_for_essay(
    'c0000000-0000-4000-8000-000000000001', (select id from dossier_essay)
  ),
  null::jsonb,
  'owner repository query returns the dossier'
);
select is(
  private.get_school_dossier_for_essay(
    'c0000000-0000-4000-8000-000000000002', (select id from dossier_essay)
  ),
  null::jsonb,
  'cross-owner repository query is masked as missing'
);

set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';
select is((select count(*) from public.school_dossiers), 1::bigint, 'owner can read the dossier');
select is((select count(*) from public.school_dossier_sources), 1::bigint, 'owner can read source provenance');
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000002';
select is((select count(*) from public.school_dossiers), 0::bigint, 'another user cannot read the dossier');
select is((select count(*) from public.school_dossier_sources), 0::bigint, 'another user cannot read provenance');
reset role;

select is(
  (select supporting_excerpt from public.school_dossier_sources),
  'Students can pursue interdisciplinary study across schools.',
  'supporting excerpt remains attached to its claim'
);
select is(
  (select normalized_url from public.school_dossier_sources),
  'https://umich.edu/academics',
  'normalized on-domain citation remains attached'
);
select is(
  (select retrieved_at from public.school_dossier_sources),
  '2026-08-03T17:55:00Z'::timestamptz,
  'retrieval time remains attached'
);

select * from finish();
rollback;
